# 设计 — Episode 切分层 + 绕圈检测 + 任务分型（地基切片）

> 状态：已确认（2026-06-05）· 分支 `feat/episodes`
> 范围：本切片 = **E1 Episode + E2 任务分型/类型内归一化 + E3 绕圈检测/最深的坑**。
> 这是「AI 用量教练深化」整体蓝图（E1–E9 + v2）的**地基**；E4–E9 与 v2 仅在本仓 ADR/PRD/TODO 留**蓝图占位**，本切片不实现。

---

## 0. 背景与整体蓝图

ccoach 现状只「呈现聚合数字」：解析层是**单趟流式聚合**——parser 逐条读 JSONL，立刻把信号灌进全局计数器
（`src/aggregate.ts` 的 `Aggregator`），raw 数据里的**时序结构当场被压扁丢弃**。但用户要的「教练级深度」全部建立在一个
现在不存在的抽象上：**回合（Episode）**——以每条用户指令为边界，把会话切成「用户指令 → 下一条用户指令之间的全部
agent 活动」。

用户需求拆成 9 个子项目（依赖分层），整体蓝图：

| 层 | 子项目 | 对应 ADR | 本切片? |
|---|---|---|---|
| L0 地基 | **E1 Episode 切分层** | 0032 | ✅ |
| L1 纯结构离线 | **E2 任务分型 + 类型内归一化** | 0033 | ✅ |
| | **E3 绕圈检测 + 最深的坑故事卡** | 0034 | ✅ |
| L2 持久化底座 | E4 增量缓存 + per-platform profile | 0035（提议中） | ❌ 蓝图 |
| L3 深度与对照 | E5 量化反事实基线 | 0036（提议中） | ❌ 蓝图 |
| | E6 单平台深度默认 + `compare` | 0037（提议中） | ❌ 蓝图 |
| L4 隐私门控 | E7 隐私分级 L0–L3 + 两段式 extract→analyze | 0038（提议中） | ❌ 蓝图 |
| L5 语义层 | E8 打断归因（CLI 结构 / skill 语义） | 0039（提议中） | ❌ 蓝图 |
| | E9 风格空间 / 原型人格 | 0040（提议中） | ❌ 蓝图 |
| 缺口 | Codex prompt 语义对齐 + `~/.codex/sessions` 深度优化 | 0041（提议中 · pending） | ❌ pending |

**为什么 E2 必须与 E3 同切片**：E3 的「耗时 > p90」「错误密度」是百分位信号；若不按任务类型归一化，会系统性冤枉
某些用户（算法同学挂训练两小时，在全局基线下被判 spiral/p99，但在「实验型」基线下完全正常）。因此**第一版就必须带
类型内归一化**，否则 spiral 检测从一开始就不可信。

---

## 1. 架构：episode 层挂在哪

新增 `src/episodes.ts`，核心是平台无关的 `EpisodeBuilder`（攒「当前 episode」的有序事件）+ `EpisodeAccumulator`
（收尾后的 episode 列表 + 派生）。改动最小、**不动现有信号提取路径**：

```
parser 检测边界 ──► agg.beginEpisode(session, repo, ts)      ← 平台特异（边界不同）
现有 applyTokens / applyTool / applyToolResult / applyEdit / markInterrupted
        ──► 聚合器顺带转发进「当前 episode」                   ← 平台无关（信号复用）
下一个边界 / 文件(rollout)末尾 ──► finalize 当前 episode → 派生 spiral 信号 → **丢弃有序序列**
所有文件解析完 ──► 计算 task_type、类型内基线、spiral severity、summary
```

### 1.1 边界检测（平台特异，留在 parser）

- **Claude（`src/parsers/claude-code.ts`）**：边界 = **非 sidechain 且 `userText(rec.message)` 非空**的 `type:"user"` 记录。
  纯 tool_result 投递的 user 记录 `userText` 为空 → 不是边界，自然归属当前 episode。
  `toolUseResult.interrupted === true`（出现在某条 user 记录上）标记**当前 episode 被打断**。
- **Codex（`src/parsers/codex.ts`）**：Codex rollout **没有用户消息记录**，parser 当前完全不读用户 prompt。
  边界 = **`turn_context`**（每个 turn ≈ 一次用户指令）。`function_call_output` 的 `metadata.interrupted` 标记被打断。
  - 实现时须用 fixture 核实 `turn_context` 是「每 turn 一条」而非「每会话一条」；若证伪，退化为「token 活动后出现的
    `turn_context` 视为新 episode」。风险写进 ADR 0032 开放问题。

### 1.2 累加（平台无关，留在聚合器）

聚合器持有一个可选的 `EpisodeAccumulator`（仅当需要时启用，见 §4 契约）。现有 `applyTokens/applyTool/
applyToolResult/applyEdit/markInterrupted` 在已有逻辑末尾**顺带**调用 `this.curEpisode?.addX(...)`，零回归。

### 1.3 口径

- **仅主会话**：sidechain（子代理）token 仍计入全局总量、但**不归任何 episode**。故 `Σ episode.tokens.total ≤
  report.tokens.total`（差值 = sidechain）。**保守、不虚增烧钱数**，写进 glossary。
- **时长** = episode 内 gap-capped 活跃时长，沿用 `IDLE_CAP_MS = 5min` 口径（与全局 `duration` 一致），
  不用 wall-span（避免 AFK 虚增）。
- **跨文件/rollout 不桥接 episode**：文件末尾强制 finalize 当前 episode（对齐现有 `resetActive()` 的边界处理）。

---

## 2. E1 · Episode 记录字段

新类型 `EpisodeDetail`（`src/model.ts`）。每个 episode：

| 字段 | 含义 |
|---|---|
| `session_id` / `repo` / `index` | 归属与会话内序号 |
| `start_ts` / `end_ts` | ISO-8601（本机时区）边界时间戳 |
| `duration_seconds` | gap-capped 活跃时长 |
| `tokens` | 完整 `Tokens` 桶（input/cached/output/reasoning/cache_creation/total）|
| `estimated_cost_usd` | 离线 fallback 估算（权威成本仍走 skill 层联网官方价，ADR 0019）|
| `tool_calls` | 工具调用次数 |
| `files_touched` | 触碰文件数（去重计数，**不含文件名**）|
| `max_edits_per_file` | 单文件最大编辑次数（edit_ring 用）|
| `error_count` / `error_rate` | episode 内工具错误数 / 占比 |
| `interrupted` | 是否被打断（布尔）|
| `end_type` | `natural` / `interrupted` / `corrected`（见下）|
| `task_type` / `task_type_confidence` | E2 任务类型 + 置信 |
| `spiral` | E3 结构化 spiral 对象（见 §3）|

**`end_type` 平台不对称（写进 glossary）**：

| | Claude | Codex |
|---|---|---|
| `natural` | 自然完成 | 自然完成 |
| `interrupted` | `toolUseResult.interrupted` | `metadata.interrupted` |
| `corrected` | 下一条用户 prompt 命中纠错词启发式（瞬时派生布尔，不存原文）| **不支持**（Codex 不读用户文本，见 ADR 0041 pending）|

---

## 3. E2 · 任务分型 + 类型内归一化

### 3.1 任务类型（固定白名单 + unknown）

新模块 `src/task-type.ts`：纯函数 `classifyTask(features) → { type, confidence }`。7 类 + `unknown`：

| `task_type` | 主要结构特征（便宜信号）|
|---|---|
| `explore` | 读/搜索远多于编辑（read+search ≫ edit），文件集合宽 |
| `implement` | 编辑密集，伴随测试调用（test 类别 tool_result）|
| `debug` | 错误驱动（error_rate 高），文件集合窄而深，编辑反复 |
| `refactor` | 触碰文件多、跨目录、lines_added/removed 大 |
| `experiment` | 长命令（`python train.py` / notebook / 反复 rerun），少编辑 |
| `scripting` | 新文件、无测试、episode 短命、工具少 |
| `docs` | 编辑以 `.md`/文档扩展名为主 |
| `unknown` | 低置信兜底，交给 skill 语义裁决 |

- **CLI 确定性分类**：只用 episode 已有的结构特征（读写比、文件扩展名混合、命令首 token 模式、文件集合宽度、
  编辑密度、是否触发 test 类别）。给 `confidence ∈ [0,1]`；低于阈值（草案 0.4）→ `unknown`。
- 分类信号全是**已派生的结构数据**，零新内容读取。`task_type` 是固定白名单标签（ADR 0017 合规）。

### 3.2 类型内归一化（去偏，关键）

所有百分位（`duration_seconds` / `error_rate` / `tokens.total`）**先按 `task_type` 分桶、再算窗口内百分位**。

- **最小样本回退**：某类型窗口内 episode 数 `< MIN_SAMPLES`（草案 5）→ 回退**全局（跨类型）基线**并在该 episode 的
  spiral 信号上标 `low_confidence`。避免样本太少时百分位乱跳、crying wolf。
- 本切片**只算窗口内百分位**（不依赖跨运行历史）；周环比 / 自身历史 p50·p90 留到 E5（依赖 E4 缓存）。

### 3.3 用户画像（叙事层留给 skill）

`episode_summary.task_mix` = 各 task_type 的 episode 占比分布。CLI 只出分布数字；「你像是以模型实验为主的工作」这类
自然语言画像由 skill 写（开放词表，不在 CLI 枚举工种）。

---

## 4. E3 · 绕圈检测 + 「最深的坑」

### 4.1 结构化 spiral 对象（每 episode）

`EpisodeDetail.spiral`（结构化子信号 + severity，而非单一 `is_spiral` 布尔——更灵活、契合 CLI=数据/skill=解读）：

```ts
interface SpiralSignals {
  edit_ring: boolean        // 同一文件被 edit ≥ EDIT_RING_MIN(草案3) 次；尤其 edit→test→error→edit n-gram
  error_dense: boolean      // ≥3 连续错误 tool_result，或 error_rate ≥0.5 且 ≥4 次调用，且文件集合不再扩大
  no_progress: boolean      // 连续 ≥M 次调用 / token 消耗中：新文件触碰=0 且 红转绿=0
  time_outlier: boolean     // 活跃时长 > 类型内 p90 且 > 绝对地板 TIME_FLOOR(草案 5min)
  low_confidence: boolean   // 类型内样本不足、退全局基线时为 true（§3.2）
  severity: number          // 触发子信号的加权计数（0 = 无 spiral）
}
```

- **红转绿** 由 test 类别 tool_result 的 `is_error` 翻转派生（error=true 后同 episode 内 error=false）——纯结构，
  不读测试输出内容。
- **n-gram 工具序列**：edit_ring/no_progress 需要**有序工具事件**。`EpisodeBuilder` 内瞬时保存有序
  `{kind, error, fileLocalId}`（`fileLocalId` 由文件 basename **瞬时**映射成 episode 内局部 id `f0/f1…`，
  **basename 绝不存储/输出**），finalize 时派生信号后**整段丢弃**（ADR 0017「瞬时派生即弃」）。

### 4.2 「最深的坑」

`episode_summary.deepest_pit` = `severity × token 烧量` 最高的那个 episode 的引用（session_id + index + 关键数字）。
故事卡的时间线/折算成本由 skill 渲染（折算价走 skill 层联网官方价）。CLI 只给定位 + 结构数字。

### 4.3 主报告恒定 `episode_summary`（加性、契约安全）

```ts
interface EpisodeSummary {
  episodes: number
  autonomy_rate: number         // 无打断 episode 占比（AI 自主完成率）
  interrupted_rate: number
  corrected_rate: number        // Claude only（Codex 恒 0）
  intervention_style: string    // 派生提示标签：micro-manager / balanced / free-range（由打断+纠错率派生）
  spiral_episodes: number       // severity>0 的 episode 数
  task_mix: Record<string, number>   // task_type -> 占比
  deepest_pit?: { session_id: string; index: number; severity: number; tokens: number; task_type: string }
}
```

---

## 5. `--json` 契约（不破坏现有 skill）

- 新增 `--scope episode`（与 `project`/`session` 平行）→ `report.episodes_detail: EpisodeDetail[]`（按 severity 或 token 排序、top-N 封顶防爆）。
- **主报告恒附** `report.episode_summary`（小块、加性）+ 对应 glossary 条目。
- `--scope` 类型从 `'global'|'project'|'session'` 扩成 `+'episode'`（`src/aggregate.ts` `Scope`、`src/cli.ts` 校验）。
- **默认输出对现有 consumer 完全不变**：episode_summary 是新增可选字段；episodes_detail 仅 `--scope episode` 出。
- 回归：`test/emit.test.ts` / 现有 skill merge 不受影响（新增字段，非破坏）。

---

## 6. 隐私（红线零放宽，ADR 0016/0017）

- episode 全部信号都从**已读的结构数据**派生：token / 工具名 / 工具类别 / `is_error` / `interrupted` /
  structuredPatch 行数。**不新读任何内容**。
- 瞬时即弃：有序工具序列、用于 edit_ring 的文件 basename（→ 局部 id）只在内存派生、算完丢弃，绝不存/输出。
- `task_type` / `end_type` / spiral 子信号 = 固定白名单标签 + 布尔/计数。
- `episodes_detail[]` 里**无 prompt 原文、无路径、无文件名、无 diff 文本**。
- `corrected` 用现有纠错词启发式（`src/prompt-signals.ts` 的 correction 口径）瞬时判定**下一条** user prompt，
  派生布尔、不存原文（Claude only）。
- 新增隐私回归断言：`test/privacy.test.ts` 增「`episodes_detail[]` 与 `episode_summary` 不含文本/路径/文件名/diff」。

---

## 7. 测试

- **fixtures**：扩 `test/fixtures/claude/` 与 `test/fixtures/codex/`，新增多-episode 会话，含：正常完成、被打断、
  纠错跟进、edit→test→error→edit spiral 环、长耗时实验型 episode。
- **vitest**（新 `test/episodes.test.ts` + 扩现有）：
  - 两平台 episode 边界切分正确（含纯 tool_result user 记录不切、turn_context 切）。
  - 任务分类（7 类各一例 + 低置信→unknown）。
  - 类型内百分位 + 最小样本回退（同一耗时在不同类型基线下判定不同）。
  - spiral 各子信号触发 / 不触发；severity 计算；deepest_pit 选取。
  - `episode_summary` 各字段（autonomy_rate / task_mix / intervention_style）。
  - **隐私回归**（`episodes_detail[]` 无文本/路径/文件名/diff）。
  - **契约回归**（默认输出不变、`--scope episode` 加性）。

---

## 8. 实现顺序（TDD）

1. `src/model.ts`：`EpisodeDetail` / `SpiralSignals` / `EpisodeSummary` 类型 + glossary 条目；`Scope` 加 `episode`。
2. `src/task-type.ts`：`classifyTask` 纯函数 + 单测（最独立，先做）。
3. `src/episodes.ts`：`EpisodeBuilder`（攒序列 + 派生 spiral）+ `EpisodeAccumulator`（列表 + 类型内基线 + summary）+ 单测。
4. `src/aggregate.ts`：接 `EpisodeAccumulator`，`applyTokens/applyTool/applyToolResult/applyEdit/markInterrupted` 转发；`beginEpisode`；assemble 出 `episode_summary` + `episodes_detail`。
5. parser 钩子：`claude-code.ts`（user-text 边界 + corrected 探测）、`codex.ts`（turn_context 边界）。
6. `src/cli.ts`：`--scope episode` 校验 + 帮助文案；`src/emit/text.ts` 人读 episode 概览段（i18n）。
7. fixtures + 隐私/契约回归。
8. `npm run typecheck` + `vitest` + `node tools/check_adrs.mjs` + `scripts/verify-ccusage.ts`（确保未碰 token/成本口径）。

---

## 9. 蓝图占位（E4–E9 / Codex 缺口 / v2，本切片不实现）

详见各 proposed ADR：0035 缓存+profile · 0036 反事实基线 · 0037 单平台默认+compare · 0038 隐私分级两段式 ·
0039 打断归因 · 0040 风格空间原型人格 · 0041 Codex prompt 对齐+sessions 深度优化（pending）。
每条都遵循「依赖 E1 episode 层」+「红线不放宽」+「能测的绝不问」。
</content>
</invoke>
