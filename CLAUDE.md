# CLAUDE.md

本文件为 Claude Code / Codex 等 agent 在本仓库工作时的向导。先读这里，细节进 [`docs/`](docs/)。

## 项目是什么

**ccoach** = 本机 AI 用量教练（macOS / Linux）。只读分析你在 **Claude Code / Codex** 上的用量，
告诉你**花在哪、哪里浪费、怎么用得更好**，并把结果做成**可分享的成绩卡**。

> 原名 **autofresh**（Codex/Claude 保活工具），已剥离保活、聚焦用量分析与建议，更名为 ccoach
> （见 [ADR 0007](docs/adr/0007-drop-keepalive-rebrand-ccoach.md)）。

产品分两块、同仓库内明确分开：

1. **CLI** — 产出只读、语义化的用量数据（默认命令 `ccoach`，即原 `report`；`--json` 为 agent 友好输出）。
2. **skills** — 教 agent 解读 CLI 产物、给**对人有用的建议**、渲染**可分享成绩卡**
   （已上线 `skills/ai-usage-html-report/`）。

两者通过 **`--json` 契约**解耦：CLI 出数据，skill 出解读。改 CLI 不应破坏该契约（见 ADR 0004 / 0010）。

## 架构方向（重要，规划中、尚未实施）

下面两条是已定的方向，**当前代码仍是 Go**，迁移分步进行、不要一次性重写。动手前读对应 ADR。

### 1. CLI 从 Go 迁移到 Node/TypeScript，衔接 ccusage（中等偏轻）

详见 [ADR 0010](docs/adr/0010-cli-rewrite-node-ccusage.md)。要点：

- 整条产品线都在 Node 生态（skills 走 npx、用户是 Claude Code/Codex、ccusage 是 TS）。
  CLI 也用 **TypeScript** 写，分发统一成「一切皆 npx」，省掉为 Go 二进制套 npm 封装的不便。
- **构建在 ccusage 之上（中等偏轻）**：ccusage 作为 npm 依赖（`ccusage` + `@ccusage/codex`）
  拿结构化用量数据，ccoach 只叠加**习惯分析 / prompt 评级 / 人格化吐槽 / feature-first 建议**——
  这些才是差异化价值；**不要重复造 JSONL 解析轮子**。ccusage 没覆盖的边角可子进程兜底。
- 选型：`cac`/`citty`（轻量 CLI）、`tsdown`/`unbuild`（小 bundle）。Node 天然跨平台，
  不再需要多平台预编译二进制矩阵。
- **保持 `ccoach --json` 契约不变**，skill 侧无感切换。
- **渐进迁移**：先在 Node 里跑通核心数据流并对齐 Go 版 `--json`、交叉验证一致，再叠分析层；
  Go 版留作参考实现，稳定后退役。

### 2. 多平台分析：Codex + Claude Code 对称，未来扩展

详见 [ADR 0011](docs/adr/0011-multi-platform-usage-sources.md)。要点：

- ccoach **不是只给 Codex 用的**——Codex 与 Claude Code 是对称的一等数据源，措辞勿写成「只读 `~/.codex`」。
- 架构分「平台数据源适配器」+「平台无关的分析层」；新增平台只补一个适配器。
- 未来扩展到 **OpenClaw、Harness** 等其它 Agent CLI（规划，不在本期，仅预留架构位）。

## 仓库布局

- `cmd/ccoach/` — CLI 入口（当前 Go，将迁移到 TS）。
- `internal/codexreport/` — 用量聚合（`report.go` / `habits.go` / `language.go` / `configscan.go`），迁移参考实现。
- `skills/ai-usage-html-report/` — 已上线的分析 skill（三层 scope、feature-first、成绩卡）。
- `tools/` — 校验脚本（`check_adrs.py`、`test_scorecard.py`）。
- `docs/` — PRD / ADR / TODO，见下。
- `README.md`（英文，默认）/ `README_CN.md`（中文）。

## 文档约定（docs/）

- [`docs/PRD.md`](docs/PRD.md) — 要做什么、为什么、做到什么程度。
- [`docs/adr/`](docs/adr/) — 关键技术决策，一次决策一篇、只增不改（新决策另起一篇）。
- [`docs/TODO.md`](docs/TODO.md) — 可执行任务与进度。
- 改需求 / 做关键决策时**同步更新文档**；ADR 编号递增，用 `tools/check_adrs.py` 校验。

## 隐私护栏（不可违反）

- 全程**只读**、默认不外发；分析只基于 **user prompt + permission + tool 调用**，**绝不读 assistant 回复**。
- user prompt 仅在会话 / 项目层、**转述 + 脱敏**后使用；全局层纯聚合、零 prompt 原文。
- **不输出配额百分比**（CLI 下 `rate_limits` 恒 null，配额是账号级 / 跨机器）；成本为**估算值**，非实际账单。
- 只反映**本机**，不跨机器汇总。
