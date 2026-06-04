# CLAUDE.md

本文件为 Claude Code / Codex 等 agent 在本仓库工作时的向导。先读这里，细节进 [`docs/`](docs/)。

## 项目是什么

**ccoach** = 本机 AI 用量教练（macOS / Linux）。只读分析你在 **Claude Code / Codex** 上的用量，
告诉你**花在哪、哪里浪费、怎么用得更好**，并把结果做成**可分享的成绩卡**。

产品分两块、同仓库内明确分开：

1. **CLI** — 产出只读、语义化的用量数据（默认命令 `ccoach`，即原 `report`；`--json` 为 agent 友好输出）。
2. **skills** — 教 agent 解读 CLI 产物、给**对人有用的建议**、渲染**可分享成绩卡**
   （已上线 `skills/ccoach-insight/`）。

两者通过 **`--json` 契约**解耦：CLI 出数据，skill 出解读。改 CLI 不应破坏该契约（见 ADR 0004 / 0010）。

## 架构方向（Phase 1 已落地：CLI 核心已是 TypeScript；已去 Go）

下面两条是已定方向。**Phase 1 已实现**：CLI 核心已用 TypeScript 重写为 `@loredunk/ccoach`（统一解析层 +
双平台适配器 + ccusage 对账，见 `src/` 与 `docs/superpowers/`）；原 Go 版（`cmd/`、`internal/`）已交叉验证后
**退役删除（去 Go 完成）**。**Phase 2 已完成（去 Python）**：确定性渲染/计算层（merge / scorecard / render×2）已改写为 skill 内的 `.mjs`，
`tools/` 校验转 TS（scorecard 回归进 vitest、`check_adrs.mjs` 跑 docs lint）；采集层**并入 ccoach**
（[ADR 0018](docs/adr/0018-cli-absorbs-collection-prompt-preview.md)：`ccoach report` 行为字段 + `--scope` 分层桶 + `ccoach sessions` opt-in 单会话 redacted 预览）。
**全仓库零 Python、零 Go。** 动手前读对应 ADR。

### 1. CLI 迁移到 Node/TypeScript + 自建统一解析层

详见 [ADR 0010](docs/adr/0010-cli-rewrite-node-ccusage.md)（Node 迁移）与
[ADR 0013](docs/adr/0013-self-built-unified-parser.md)（自建解析，取代 0010 D2「中等偏轻/依赖 ccusage」）。要点：

- 整条产品线都在 Node 生态（skills 走 npx、用户是 Claude Code/Codex、ccusage 是 TS）。
  CLI 也用 **TypeScript** 写，分发统一成「一切皆 npx」，省掉为 Go 二进制套 npm 封装的不便。
- **自建统一解析层**：ccoach 还要从同一批 JSONL 抓 **user prompt + 习惯指标**（ccusage 数据的超集），
  所以**向 ccusage 学解析方法、不复制其代码（MIT）、不作运行时依赖**，一个 pass 出
  「用量 + prompt + 习惯」。差异化价值在**习惯分析 / prompt 评级 / 人格化吐槽 / feature-first 建议**。
- 分平台适配器 `claude-code` / `codex` → **统一数据结构**；上层评级/HTML 只认统一结构，加新平台只写一个适配器。
- **ccusage 仅作交叉验证**（对答案）：token/成本跟 `npx ccusage` 对一下，用它验证、不依赖它运行。
- 抓 prompt 严守隐私边界（本人 prompt 默认读、长期授权，红线见 ADR 0015；不读 system/assistant，见下「隐私护栏」）。
- 选型：`cac`/`citty`（轻量 CLI）、`tsdown`/`unbuild`（小 bundle）。Node 天然跨平台，无需二进制矩阵。
- **保持 `ccoach --json` 契约不变**，skill 侧无感切换；原 Go 版已交叉验证后退役删除（去 Go 完成）。

### 2. 多平台分析：Codex + Claude Code 对称，未来扩展

详见 [ADR 0011](docs/adr/0011-multi-platform-usage-sources.md)。要点：

- ccoach **不是只给 Codex 用的**——Codex 与 Claude Code 是对称的一等数据源，措辞勿写成「只读 `~/.codex`」。
- 架构分「平台数据源适配器」+「平台无关的分析层」；新增平台只补一个适配器。
- 未来扩展到 **OpenClaw、Harness** 等其它 Agent CLI（规划，不在本期，仅预留架构位）。

## 仓库布局

- `src/` — **TS CLI（Phase 1，当前实现）**：`cli.ts`（cac）/ `index.ts`（`buildReport` + 平台合并）/
  `parsers/{claude-code,codex}.ts`（双平台适配器）/ `aggregate.ts`（平台无关聚合）/ `model.ts`（统一结构 + glossary）/
  `pricing.ts`（双平台**离线 fallback** 价表，非权威；权威价走 skill 层联网官方价，ADR 0019）/ `habits.ts` / `prompt-signals.ts` / `text.ts` / `window.ts` / `emit/{json,text}.ts`。
- `test/` — vitest 单测 + 两平台 JSONL fixture（含 `test/fixtures/scorecard/`）；`test/scorecard.test.ts` 成绩卡回归
  （取代 `tools/test_scorecard.py`）；`scripts/verify-ccusage.ts` — 与 ccusage 对账（接入 CI）。
- `skills/ccoach-insight/` — 已上线的分析 skill（三层 scope、feature-first、成绩卡）；脚本全部 `.mjs`（merge / `apply_pricing`（联网官方价计成本，ADR 0019）/ scorecard / render×2）+ 采集并入 ccoach，**skill 内无 `.py`**。
- `tools/` — 校验脚本（`check_adrs.mjs`，原 `check_adrs.py`；scorecard 回归已并入 vitest）。
- `docs/` — PRD / ADR / TODO（含 `superpowers/` 设计与实现计划），见下。
- `README.md`（英文，默认）/ `README_CN.md`（中文）。

## 文档约定（docs/）

- [`docs/PRD.md`](docs/PRD.md) — 要做什么、为什么、做到什么程度。
- [`docs/adr/`](docs/adr/) — 关键技术决策，一次决策一篇、只增不改（新决策另起一篇）。
- [`docs/TODO.md`](docs/TODO.md) — 可执行任务与进度。
- 改需求 / 做关键决策时**同步更新文档**；ADR 编号递增，用 `tools/check_adrs.mjs` 校验。

## 隐私护栏（不可违反）

- 全程**只读**、默认不外发；分析只基于 **user prompt + permission + tool 调用**，**绝不读 assistant 回复**。
- **本人 prompt 长期授权、默认读**（ADR 0015）：报告默认读取并评级用户自己的 prompt，不再每次弹授权门；
  但**红线不放宽**——绝不读 assistant/thinking/system·developer prompt/文件内容、绝不外发、写入前一律脱敏+截断。
- **工具结果/元数据的「派生信号」是受控例外（ADR 0016/0017）**：`error_signals` / `rework_signals` / `skills` /
  `environment` 只从 tool_result/toolUseResult/记录元数据派生**布尔、纯计数、固定白名单或非敏感标签**——
  `is_error`/`interrupted`/`userModified`、失败率/编辑次数/±行数/附件/子代理数、错误类别/skill名/版本/权限模式；
  内容（stderr/stdout/diff/文件/命令全行）只**瞬时用于派生即弃、绝不存储/外发**，也绝不读非错误正文做内容用途。
  仅主会话、走去重。
- user prompt 仅在会话 / 项目层、**转述 + 脱敏**后使用；全局层 / 可分享成绩卡纯聚合、零 prompt 原文。
- **不输出配额百分比**（CLI 下 `rate_limits` 恒 null，配额是账号级 / 跨机器）；成本为**估算值**，非实际账单。
  CLI 只出 token/模型（离线权威）+ 一个离线 fallback 估算；**权威成本由 skill 层按实际模型名联网查官方定价**后计算（[ADR 0019](docs/adr/0019-pricing-online-official-at-skill-layer.md)），不用写死价表。
- 只反映**本机**，不跨机器汇总。
