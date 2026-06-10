# ADR 0057 — Codex 特性采用信号：$CODEX_HOME 本机文件/索引库白名单计数

> 状态：已接受 · 日期：2026-06-11 · 分支：`codex-ccoach-optimization`
> · 落地 `docs/superpowers/codex-data-goldmines.md` §4 的 P0「codex_feature_adoption」
> · 与 [`adr/0056-feature-adoption-signals-claude-json.md`](0056-feature-adoption-signals-claude-json.md)（Claude 侧）对称
> · 隐私口径沿用 [`adr/0016`](0016-error-signals-derived-tool-result-reading.md)/[`adr/0017`](0017-derived-non-content-signals.md)（布尔/纯计数/白名单标签；内容瞬时即弃）
> · 服务 [`adr/0006-feature-first-recommendations.md`](0006-feature-first-recommendations.md)：给 Codex 侧 unknown_feature 建议提供官方级证据

## 背景

Codex 报告里 `feature_adoption` 恒空——Claude 有 ADR 0056（`~/.claude.json` 计数器），Codex 没有对称物。
而 `$CODEX_HOME` 之下、rollout JSONL **之外**有一整层 CLI 从未读过的本机数据（金矿盘点
`docs/superpowers/codex-data-goldmines.md`，各源均已对官方文档验证）：

1. **`config.toml`** — 配置**意图**：`personality` / `model_reasoning_effort` / `plan_mode_reasoning_effort`、
   `[projects]` trust_level、`[plugins]`、`[features]`（官方 Config Reference 文档化字段）。
2. **`rules/default.rules`** — Smart approvals 升权时提议、用户接受后写入的 `prefix_rule()` 行
   （官方 Rules 文档）——已接受行数 = 审批自治采用度。
3. **`state_5.sqlite`** — 官方会话索引库：`threads`（计数/归档）、`thread_spawn_edges`（**精确**子代理边，
   对照 rollout 内启发式）、`stage1_outputs`（记忆管线产出条数）。
4. **`sqlite/codex-dev.db`** — Codex App automations / runs / inbox 计数（官方 Automations 文档）。
5. **`.codex-global-state.json`** — Codex App Electron 状态（**非文档化**，字段随版本漂移）：
   fast-mode 自报节省时长估算、cloud access 等枚举。
6. **`skills/`（user vs `.system`）、`memories/`、`ambient-suggestions/`、`version.json`、
   全局 `AGENTS.md`（存在/空/有内容）** — 各特性 adoption 痕迹。

## 决策

### D1 `report.codex_feature_adoption`（仅 Codex，机器级当前快照）

`src/codex-feature-adoption.ts`，`buildReport` 在 `wantCodex` 时从 `cxHome` 派生（与会话数据同根，
fixture 传自定义 `codexHome` 时读的就是 fixture 自己的文件，天然可重现）。结构：`config`（意图标签 +
trusted **计数** + `broad_trust` 布尔）/ `approvals.prefix_rules` / `skills{user,system}` /
`sessions_db{threads,archived}` / `multi_agent{spawn_edges,parent_threads}` /
`memories{memory_files,stage1_rollouts,enabled_threads}` / `automations{automations,runs,inbox_items}` /
`app{present,fast_mode_saved_ms,fast_mode_rollouts,cloud_access}` / `version` / `ambient` /
`guides{global_agents_md: missing|empty|present, bytes}` / `unadopted[]` / `caveats[]`。

### D2 证据纪律（沿用 0056）

- **`unadopted` 仅由无歧义 0 计数判定**：automations=0、spawn_edges=0、prefix_rules=0、user skills=0、
  ambient suggestions=0、memories（enabled 但零产出，**仅在 sqlite 可读时**判——空 `memories/` 目录
  单独算弱证据，不判）。
- **null 子块 = 源不可读 ≠ 0**：sqlite 不可用（node:sqlite 为实验特性，Node 22.5+）或库损坏时对应块
  为 null/缺省，skill 绝不能据 null 断言「没用过」。
- `caveats[]` 固定标签随数据携带：索引库与 rollout 可能漂移（官方已知 issue）、App 状态字段非文档化
  随版本漂移、`fast_mode_saved_ms` 是 **App 自报估算**（引用必须如此署名）、记忆管线需较新 CLI 版本。

### D3 隐私与工程

- 只产出**布尔/纯计数/白名单枚举标签**。trusted 项目路径仅瞬时用于计数与 `broad_trust` 判定、绝不存储；
  规则内容、prompt 文本不读不存；`stage1_outputs` 的 `raw_memory`/`rollout_summary` 为 **assistant 蒸馏
  内容（红线）**——SQL 只 `COUNT`，正文列绝不 SELECT。回归测试断言序列化产物不含路径/规则内容。
- sqlite 经 `node:sqlite` 动态加载（require 瞬间屏蔽其 ExperimentalWarning，避免污染 stderr），
  只读模式、只跑聚合查询，任何失败静默降级 null。
- 加性可选字段，`--json` 契约不破坏；glossary 写明各源口径与告诫。

### D4 skill 用法（deepinsight「Magic Time」）

- `unadopted` = Codex 侧 unknown_feature 推荐位（automations / memories / multi-agent…）；
  「config 意图 vs rollout 实际」差值（如 config medium、实际多 high）是本块独有的发现形状。
- deepinsight HTML 新增可选 `magic_time` 高光条（schema + 渲染器已落地）：**只允许平台自报数字
  （fast-mode 节省时长，须署名 App 估算）与本机精确计数（规则数/子代理边/线程数）**，禁止任何
  自造换算系数；每张卡 `basis` 必填注明出处。

## 后果

- Codex 侧 unknown_feature 建议获得与 Claude 侧同级的官方证据背书；双平台 feature adoption 对称补齐。
- 金矿盘点其余项留待后续：threads 表作 `ccoach sessions` 快路径（P0 另立 ADR，需处理索引漂移容错）、
  `history.jsonl` 接入 prompt-signals（P1，ADR 0015 口径）、App `prompt-history`（P2）。
