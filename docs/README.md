# ccoach 文档

> **ccoach** = 本机用量与习惯分析工具（macOS / Linux / Windows）：只读分析你在 Claude Code / Codex 上的用量与习惯。

本目录收录 ccoach 的产品与工程文档。约定如下：

- **PRD（产品需求文档）** — 描述「要做什么、为什么做、做到什么程度」。见 [`PRD.md`](PRD.md)。
- **ADR（架构决策记录）** — 记录「关键技术决策及其取舍」，一次决策一篇、只增不改。见 [`adr/`](adr/)。
- **TODO（待办清单）** — 跟踪「接下来要落地的事项」，按优先级与状态滚动维护。见 [`TODO.md`](TODO.md)。

## 文档地图

| 文档 | 作用 | 何时读 / 何时写 |
| --- | --- | --- |
| [`PRD.md`](PRD.md) | 功能的目标、用户故事、范围与验收标准 | 立项 / 改需求时写；动手前读 |
| [`adr/`](adr/) | 不可逆或影响面大的技术选型 | 做关键决策时新增一篇 |
| [`TODO.md`](TODO.md) | 可执行的任务拆解与进度 | 每次推进后更新勾选 |
| [`scorecard-copy.md`](scorecard-copy.md) | 成绩卡固定文案的中英文案表（i18n） | 设计 / 调整段位文案时维护 |

## 当前主线

ccoach = 本机用量与习惯分析工具，产品分两块交付，在同一仓库内明确分开：

1. **CLI** — 产出只读、语义化的用量数据（默认命令 `ccoach`，即原 `report`；`--json` 为 agent 友好输出）。
2. **skills** — 教 Claude Code / Codex 如何解读 CLI 产物，给出**对人有用的建议**，并渲染
   **可分享成绩卡**。

skill 侧已上线 `skills/ccoach-insight/`：**会话 / 项目 / 全局三层分析**、建议**优先映射到产品
原生特性**、一张**可截图的游戏化成绩卡**均已落地。分发统一成「一切皆 npx」
（`npx @loredunk/ccoach` / `npm i -g @loredunk/ccoach`）。

> **架构方向（已落地）**：CLI 核心已从 Go **迁移到 Node/TypeScript**
> （[ADR 0010](adr/0010-cli-rewrite-node-ccusage.md)），自建**统一解析层**一个 pass 出「用量 + prompt +
> 习惯」全量数据——**向 ccusage 学解析方法、仅作交叉验证、不作运行时依赖**
> （[ADR 0013](adr/0013-self-built-unified-parser.md)，取代 0010 D2）；分平台适配器对外吐统一结构，
> 把 **Codex 与 Claude Code 作为对称的一等数据源**（[ADR 0011](adr/0011-multi-platform-usage-sources.md)），
> 未来扩展到 OpenClaw / Harness 等其它 Agent CLI。**已去 Go**（原 `cmd/`、`internal/` 退役删除）、
> **已去 Python**（渲染/计算层改写为 skill 内 `.mjs`、校验转 TS、采集并入 ccoach，
> [ADR 0018](adr/0018-cli-absorbs-collection-prompt-preview.md)）；成本定价改为
> **skill 层联网查官方价 + CLI 出离线 fallback**（[ADR 0019](adr/0019-pricing-online-official-at-skill-layer.md)）。
> 全程保持 `--json` 契约不变。

- 需求细节见 [`PRD.md`](PRD.md)：§3「AI 用量分析」（含 §3.9 三层分析、§3.10 特性优先建议、§3.11 可分享成绩卡）、§5「分发与安装」。
- 决策背景见下表 ADR。
- 落地拆解与进度见 [`TODO.md`](TODO.md)。

## ADR 索引

| 编号 | 标题 | 状态 |
| --- | --- | --- |
| [0001](adr/0001-record-architecture-decisions.md) | 采用架构决策记录（ADR） | 已接受 |
| [0002](adr/0002-ai-analyzed-usage-report.md) | AI 用量分析报告：脚本采集 + 本机模型分析 | 部分被 0004 取代 |
| [0003](adr/0003-npm-distribution.md) | 通过 npm 分发，仓库内 CLI 与 skills 分开 | 提议中（npm 分发保留；其「Go 二进制平台子包」实现已被 0010 取代为普通 Node 包） |
| [0004](adr/0004-skills-based-analysis.md) | skills 化分析：CLI 产出数据，skill 教 agent 给建议 | 已接受（已实现） |
| [0005](adr/0005-tiered-analysis-and-signals.md) | 分层分析（会话/项目/全局）与信号选择 | 已接受（已实现） |
| [0006](adr/0006-feature-first-recommendations.md) | 建议优先映射到产品特性（feature-first） | 已接受（已实现） |
| [0007](adr/0007-drop-keepalive-rebrand-ccoach.md) | 剥离保活，聚焦用量分析与建议，更名为 ccoach | 已接受 |
| [0008](adr/0008-gamified-shareable-scorecard.md) | 游戏化等级与可分享成绩卡（病毒传播） | 已接受（已实现） |
| [0009](adr/0009-i18n-scorecard-copy.md) | 成绩卡固定文案的 i18n（人工本地化，zh/en） | 已接受（已实现） |
| [0010](adr/0010-cli-rewrite-node-ccusage.md) | CLI 从 Go 迁移到 Node/TS（D2 已被 0013 取代） | 已接受（**已实现**，去 Go 完成，取代 0003 的二进制分发） |
| [0011](adr/0011-multi-platform-usage-sources.md) | 多平台用量分析：Codex + Claude Code，未来扩展 | 已接受（**已实现**，双平台对称） |
| [0012](adr/0012-codex-cost-tokens-ccusage-method.md) | Codex token/成本计算对齐 ccusage（修正首轮/单轮低估） | 已接受（已实现；定价口径被 0019 取代） |
| [0013](adr/0013-self-built-unified-parser.md) | 自建统一解析层（学 ccusage 方法、仅交叉验证），取代 0010 D2 | 已接受（**已实现**） |
| [0014](adr/0014-claude-code-prompt-review-data-surface.md) | Claude Code 会话级 prompt 评级数据面（skill 侧，opt-in） | 已接受（已实现） |
| [0015](adr/0015-standing-local-authorization-prompt-reading.md) | 本机 prompt 读取改为长期授权、默认开启 | 已接受（已实现） |
| [0016](adr/0016-error-signals-derived-tool-result-reading.md) | 错误/卡顿信号：对 tool_result 的「派生化」读取 | 已接受（已实现） |
| [0017](adr/0017-derived-non-content-signals.md) | 派生信号统一口径：从工具结果/元数据派生计数与标签 | 已接受（已实现） |
| [0018](adr/0018-cli-absorbs-collection-prompt-preview.md) | CLI 接管采集层：scope / 会话钻取 / opt-in prompt 预览 | 已接受（已实现，去 Python 完成） |
| [0019](adr/0019-pricing-online-official-at-skill-layer.md) | 成本定价改为 skill 层联网官方价 + CLI 离线 fallback；默认窗口 today | 已接受（已实现，取代 0012 定价口径） |
| [0020](adr/0020-coding-autonomy-scorecard-axis.md) | 成绩卡第 5 轴「编码自主度」（手改率/自主编码倾向称号） | 提议中（规划，未实现） |
| [0021](adr/0021-error-taxonomy-refinement.md) | 失败类别细化：拆 `other`、识别环境外因、外因/内因分组 | 提议中（规划，未实现） |
| [0022](adr/0022-billing-mode-plan-split-relay-guardrail.md) | 计费维度拆分：Codex 订阅 plan tier 可拆、Claude 不可拆 + 中转(relay)检测护栏 | 已接受（已实现） |
| [0023](adr/0023-platform-specific-analysis-sections.md) | 平台特色分析板块：Codex 执行画像 + Claude 差异化（端点/计费/执行画像卡片） | 已接受（已实现） |
| [0024](adr/0024-report-input-token-display-parity.md) | 报告「输入/输出 Token」展示口径：两平台输入侧对齐、构成桶互斥 | 已接受（已实现） |
| [0025](adr/0025-report-skeleton-i18n-default-english.md) | 报告骨架 i18n：抽到文案表、可扩展 locale、默认英文 | 已接受（已实现） |
| [0026](adr/0026-cli-output-i18n-default-english.md) | CLI 输出 i18n：默认英文 + 保留 `--lang zh` | 已接受（已实现） |
| [0027](adr/0027-rename-skill-ccoach-insight.md) | skill 更名：`ai-usage-html-report` → `ccoach-insight` | 已接受（已实现） |
| [0028](adr/0028-distribution-npx-skills.md) | skill 分发：主推 `npx skills add`（Vercel Labs skills CLI） | 已接受（已实现） |
| [0029](adr/0029-model-authored-scorecard-roasts.md) | 成绩卡 roast 交给模型：fixture 作样例 + 兜底，评级/段位名仍确定性 | 已接受（已实现） |
| [0030](adr/0030-skill-drops-ccusage-runtime.md) | skill 运行时去 ccusage：Claude per-model 改用 ccoach `model_tokens`；ccusage 降为 dev/CI 验证 | 已接受（已实现，取代 0019 D4/D6 运行时部分） |
| [0031](adr/0031-roast-grounded-in-real-signals.md) | 成绩卡 roast 必须基于真实聚合信号、不得编造数据未度量的事 | 已接受（已实现，收紧 0029） |
