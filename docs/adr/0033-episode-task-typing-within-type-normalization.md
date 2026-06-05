# ADR 0033 — Episode 任务分型 + 类型内归一化（去偏）

> 状态：已接受 · 日期：2026-06-05
> · 建立在 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md)（episode 抽象层 + `episode_summary`）之上
> · 服务 [`adr/0034-spiral-detection-deepest-pit-story.md`](0034-spiral-detection-deepest-pit-story.md)（spiral 判定的去偏基线）与 [`adr/0040-style-space-archetype-personas.md`](0040-style-space-archetype-personas.md)（风格空间/原型人格）
> · 沿用 [`adr/0005-tiered-analysis-and-signals.md`](0005-tiered-analysis-and-signals.md)（分层分析与信号）的 scope 分层与 [`adr/0006-feature-first-recommendations.md`](0006-feature-first-recommendations.md)（feature-first 建议）的叙事分工
> · 复用 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md)（派生非内容信号）的白名单标签红线，**无新内容读取**
> · 受 [`adr/0041-codex-prompt-parity-sessions-deep-dive.md`](0041-codex-prompt-parity-sessions-deep-dive.md)（Codex prompt 对齐，pending）约束分类质量

## 背景

ADR 0032 已把零散事件聚成 episode，并产出 `episode_summary`（含 `duration_seconds`、`error_rate`、
`tokens.total` 等度量）。下游要在此之上做两件事：spiral / 卡坑判定（ADR 0034）与风格推断（ADR 0040）。
这两件事都依赖**「这个 episode 相对正常基线是不是异常」**——但只要基线是**全局（跨任务类型）**的，就会**系统性冤枉某些用户**。

典型反例：算法同学一个 episode 挂着 `python train.py` 跑两小时、几乎不编辑代码。

- 在**全局基线**下：`duration_seconds` 落到 p99、`error_rate` 偶发非零、`edits` 极低 → 被判成 spiral / 异常长尾。
- 在**「实验型任务」基线**下：两小时训练完全是这类任务的中位数，毫无异常。

工种（job role）**既不该问也不该枚举**：

- 问头衔不可靠（隐私、且头衔与实际行为脱节）；
- 维护一张「后端 / 前端 / 算法 / SRE…」的工种枚举，是产品永远追不完的长尾，且与 ADR 0006「CLI 出数据、
  skill 出叙事」的分工冲突。

真正稳健的信号是：**用户的任务类型混合分布本身就是答案**——一个人大多数 episode 是 `experiment` 还是
`implement`，比他自报的职位更真实、更新鲜、且天然本机派生。本 ADR 据此引入**任务分型**，并把所有百分位
**按任务类型分桶后再算**，作为 ADR 0034 / 0040 的去偏地基。

## 决策

### D1 任务分型 `classifyTask(features) → { type, confidence }`

新增 `src/task-type.ts`，导出**纯函数** `classifyTask(features) → { type, confidence }`。无 I/O、无状态、可单测。

类型为**固定白名单 7 类 + `unknown` 兜底**：

- `explore` — 读/搜索远多于编辑、文件集合宽（广度优先浏览代码）。
- `implement` — 编辑密集 + 测试循环（写功能并反复跑测）。
- `debug` — 错误驱动、文件窄而深、反复编辑同一处（围着一个 bug 打转）。
- `refactor` — 触碰文件多、跨目录、增删行数都大（结构性改动）。
- `experiment` — 长命令（如 `python train.py`）、notebook、反复 rerun、编辑很少（实验/训练为主）。
- `scripting` — 新建文件、无测试、命短（一次性脚本）。
- `docs` — 以 `.md` 等文档扩展名为主（写文档）。
- `unknown` — 低置信兜底，交 skill 语义裁决。

分类**只用便宜的结构特征**（均可由 ADR 0032 的 episode 度量与工具/命令元数据派生，不读任何内容）：

- 读写比（读取类 vs 编辑类工具调用占比）；
- 文件扩展名混合（如是否以 `.md` 为主）；
- 命令首 token 模式（`pytest` vs `python train.py`，只看首 token / 已知模式，不存命令全行）；
- 文件集合宽度（涉及文件数 / 跨目录数）；
- 编辑密度（单位时间 / 单位事件的编辑次数）；
- 是否触发 `test` 错误类别（与 ADR 0021 的 `test` 类别一致）。

`confidence ∈ [0, 1]`。低于阈值（草案 `0.4`）一律落到 `unknown`，宁可不分型也不误分型。

### D2 类型内归一化（关键去偏）

所有百分位——`duration_seconds`、`error_rate`、`tokens.total`——**先按 `task_type` 分桶、再算窗口内百分位**。
即「某 episode 的 `duration_seconds` 落在它**所属任务类型**的窗口分布里的哪个分位」，而非落在全体混合分布里。

**最小样本回退**：若某 `task_type` 在窗口内的 episode 数 `< MIN_SAMPLES`（草案 `5`），则该类型样本太少、
分位会乱跳，回退到**全局（跨类型）基线**计算，并在该 episode 的 spiral 信号上标 `low_confidence`，让下游
（ADR 0034）知道这次去偏没生效、需保守对待。

**范围限定**：本切片**只算窗口内百分位**（不依赖跨运行历史）。周环比 / 自身历史 `p50`·`p90` 等纵向对比
属于 E5 范畴，留到 ADR 0036，本 ADR 不涉及。

### D3 用户画像 = `task_mix` 分布

把**任务类型混合分布** `task_mix`（各 `task_type` 的占比 / 计数）写进 `episode_summary`（聚合到窗口层）。
这是 CLI 侧对「你是干什么的」的**纯结构化回答**。

**叙事归 skill**：自然语言工种画像（例如「你像是以模型实验为主、偶尔写工程化代码的工作」）由 skill
用**开放词表**自由生成（遵循 ADR 0006 的 feature-first / 叙事分工）。CLI **不枚举工种、不维护工种枚举**，
只出 `task_mix` 这组数。

### D4 隐私

`task_type` 是**固定白名单标签**，与 ADR 0017 完全一致：从已有 episode 度量 + 工具/命令元数据**派生**白名单
枚举值，**零新内容读取**，命令只看首 token / 已知模式、即用即弃，不存储 / 不外发命令全行、不读 assistant /
文件内容。`task_mix` 是纯聚合计数。本 ADR 不放宽任何隐私红线。

## 后果

- **吸收工种混淆因子**：百分位按任务类型归一后，「算法同学跑两小时训练」不再被全局基线误判为 spiral；
  下游 ADR 0034 的 spiral 判定与 ADR 0040 的风格推断都更准。
- **新增个性化与传播点**：skill 能「看出你是干什么的」（基于 `task_mix`），这是高个性化、易分享的成绩卡素材。
- **新增表面积**：`src/task-type.ts` + `episode_summary` 多 `task_type` / `task_mix` 字段；分桶后每类型样本量下降，
  靠 D2 的 `MIN_SAMPLES` 回退 + `low_confidence` 标记兜底。
- **契约影响可控**：新增字段是向后兼容的扩展（`--json` 既有字段不变），skill 侧渐进消费。
- **分类是启发式**：`unknown` 桶与 `confidence` 阈值的存在意味着一部分 episode 不会被分型；这是有意的保守，
  把语义边界交给 skill，而非让 CLI 强行硬分。

## 开放问题

### OQ1 阈值与权重需真实数据校准
分类的 `confidence` 阈值（草案 `0.4`）、`MIN_SAMPLES`（草案 `5`）与各结构特征的权重，必须用**多份不同画像的
真实数据**（算法 / 后端 / 文档为主 / 混合型用户）校准，避免在单一画像上过拟合。校准前一律视为草案。

### OQ2 一个 episode 跨多类型
单个 episode 中途从 `debug` 转 `implement`、或 `explore` 后 `refactor` 时如何归类？本 ADR 草案取**主导类型**
（占比 / 权重最高的一类）。是否需要在 episode 内再切分、或引入「混合」标记，待 OQ1 校准数据观察后决定。

### OQ3 Codex 无 prompt 信号
Codex 平台缺 user prompt（见 ADR 0041，pending），分类只能依赖工具调用 / 命令模式 / 文件特征，缺少 prompt
语义佐证，分型质量受限、`unknown` 占比可能偏高。Codex 侧的分类质量与是否需要平台特定阈值，随 ADR 0041 的
prompt 对齐进展再评估。
