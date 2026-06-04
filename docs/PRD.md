# PRD — ccoach

> 状态：草拟中 · 最近更新：2026-06-04

本 PRD 覆盖 ccoach 的整体定位，并重点展开 **AI 用量分析与建议** 能力，以及 **可分享成绩卡**。

---

## 1. 产品定位

ccoach 是一个跨平台（macOS / Linux）的 **本机 AI 用量教练**：只读分析你在 **Claude Code / Codex**
上的用量，告诉你**花在哪、哪里浪费、怎么用得更好**，并以**可分享的成绩卡**把结果变成社交货币。

> **双平台对称、可扩展**：Codex 与 Claude Code 是**对称的一等数据源**（不是只给 Codex 用的工具），
> 未来扩展到 **OpenClaw / Harness** 等其它 Agent CLI。架构上分「平台数据源适配器 + 平台无关的分析层」，
> 见 [ADR 0011](adr/0011-multi-platform-usage-sources.md)。
>
> **主打英文市场**：CLI 与报告**默认英文输出**（信号/窗口/glossary/骨架文案全英文），`--lang zh` 切中文、
> 结构可扩任意 locale（缺失回退默认语言）；成绩卡 roast 人工本地化、不机翻。见
> [ADR 0026](adr/0026-cli-output-i18n-default-english.md)（CLI）/ [0025](adr/0025-report-skeleton-i18n-default-english.md)（报告骨架）。

1. **用量分析（已上线）**：只读本机记录，输出 Token、成本、工具调用、仓库 / 时段 / 语言 /
   git 习惯 / 配置扫描等。
2. **使用建议（核心）**：由 skill 教 agent 做**分会话 / 项目 / 全局三层**的语义分析，给出
   **特性优先**的建议（凡能用产品原生特性解决的就点名特性去解决）。
3. **可分享成绩卡（传播）**：把用量 / 习惯 / prompt 评成多轴段位，做一张可截图、能炫能自嘲的
   成绩卡（见 §3.11、[ADR 0008](adr/0008-gamified-shareable-scorecard.md)）。

目标用户：重度使用 Claude Code / Codex 的个人开发者，希望「花得值、用在刀刃上」，并乐于分享战绩。

---

## 2. 现状（基线能力）

| 能力 | 命令 | 说明 |
| --- | --- | --- |
| 本机用量报告（默认命令） | `ccoach [--json --days N --since … --date … --by-repo]` | 只读 `~/.codex` rollout，输出 Token / 成本 / 工具 / 仓库 / 时段 / 来源 / 语言 / git 习惯 / 配置扫描；裸命令即出报告，`ccoach report …` 亦可 |
| 双平台 AI 使用报告 skill | `skills/ccoach-insight/` | 已上线：用 `ccoach report --json` 数据（两平台离线解析），产出 Claude Code + Codex 双平台 HTML 报告、行为画像，并支持 Codex 高耗会话钻取 |

`ccoach --json` 已经是「脚本友好」的结构化输出（见
[`src/model.ts`](../src/model.ts) 的 `Report` 结构，
已含 `repos / hours / sources / languages / git_habits / project_management` 等行为维度，由
[`src/aggregate.ts`](../src/aggregate.ts) / [`src/habits.ts`](../src/habits.ts) /
[`src/language.ts`](../src/language.ts) 产出），是 AI 分析能力的天然数据底座。
本次增强是在**已上线的 `ccoach-insight` skill** 之上演进，而非从零新建。

> **技术栈（Phase 1 已落地 · 已去 Go）**：CLI 已从 Go **迁移到 Node/TypeScript**
> （`@loredunk/ccoach`，[ADR 0010](adr/0010-cli-rewrite-node-ccusage.md)），并自建**统一解析层**——因 ccoach 还要从同一批
> JSONL 抓 **user prompt 与习惯指标**（ccusage 数据的超集），**向 ccusage 学解析方法、仅作交叉
> 验证、不作运行时依赖**，一个 pass 出「用量 + prompt + 习惯」（[ADR 0013](adr/0013-self-built-unified-parser.md)，
> 取代 0010 D2）。分平台适配器对外吐统一结构，**Codex 与 Claude Code 在 CLI 内对称成为一等
> 数据源**（[ADR 0011](adr/0011-multi-platform-usage-sources.md)）。迁移**保持 `--json` 契约不变**，
> skill 侧无感切换；原 Go 实现（`cmd/`、`internal/`）已交叉验证后**退役删除**。

### 现状边界（PRD 需尊重的约束）

- 报告**只反映本机**：同账号多机登录时 rollout 按机器隔离，不跨机器汇总。
- 不输出任何**配额百分比**（CLI 下 `rate_limits` 恒为 null，且配额是账号级、跨机器的）。
- 成本为**估算值**，不等于实际账单。Codex 的 token 累加与成本计算**对齐 ccusage**：按每轮
  `last_token_usage` 累加（无该字段时回退对 `total_token_usage` 求增量），成本 = 非缓存输入×输入价 +
  缓存输入×缓存读取价 + 输出×输出价（输出已含 reasoning）；单价由 skill 层按实际模型联网查**官方价**计算、CLI 仅出离线 fallback 估算（[ADR 0019](adr/0019-pricing-online-official-at-skill-layer.md)，取代 [0012](adr/0012-codex-cost-tokens-ccusage-method.md) 的内置镜像价口径）。

---

## 3. 新需求：AI 用量分析报告

### 3.1 一句话需求

> 用脚本采集 Claude Code / Codex 的**全局用量统计**，把结果以**语义化结构**喂给大模型，
> 让模型分析并给出一份**可执行的建议报告**。

### 3.2 问题陈述

`report` 当前只「呈现数字」，用户仍需自行解读：缓存命中率是否偏低？reasoning 占比是否过高？
某仓库是否在烧钱？最活跃的时段在哪、值不值？这一步「从数字到结论」的解读，
正是大模型擅长、且对用户价值最高的部分。

### 3.3 用户故事

- 作为重度用户，我想运行一条命令就得到「**本周我的 Token 都花在哪、哪里浪费、怎么省**」的结论，而不只是表格。
- 作为多工具用户，我想同时看到 **Claude Code 与 Codex** 两侧的统计被放在一起对比与点评。
- 作为注重隐私的用户，我想**自己决定**把哪些数据发给模型，并能先**预览将要发送的内容**。

### 3.4 方案概述（skills 化）

> 方案已调整：不再由 CLI 自己调模型，而是 **CLI 出数据 + skill 教 agent 解读**。
> 决策见 [`adr/0004-skills-based-analysis.md`](adr/0004-skills-based-analysis.md)
> （取代 [ADR 0002](adr/0002-ai-analyzed-usage-report.md) 的「二进制内调模型 / `advise` 子命令」）。

职责切分如下：

```
CLI（产出料）                         skill（产出解读）
report --json / --digest   ──喂──►   agent(Claude Code / Codex) 按 skill 指引解读 ──► 对人有用的建议
自描述、语义化、稳定的数据             触发场景 + 操作步骤 + 解读阈值 + 输出模板 + 口径护栏
```

1. **CLI**：把全局统计输出成**自描述、语义化、稳定**的结构化数据——每个指标自带口径说明
   （如 `cache_hit_rate=缓存输入/总输入，越高越省钱`），让 agent 无需额外上下文即可读懂。
   Codex 侧复用现有聚合；Claude Code 侧数据源待调研（TODO T1.1）。
2. **skill**：用自然语言教 agent——何时运行哪条命令、如何解读各指标、输出怎样的建议。
   skill 是产品的第二部分交付物，**在已上线的 `ccoach-insight` skill 上演进**
   （非新建），独立打包为 `@ccoach/skills`（见 §5、ADR 0003）。
3. **使用**：用户在自己常用的 Claude Code / Codex 里直接问「我的用量怎么样、怎么省」，
   agent 运行 CLI、按 skill 给出结论。分析所用模型天然就是用户当前 agent。

> 本节方案进一步细化为 §3.9「三层分析与信号模型」与 §3.10「特性优先建议」。

### 3.5 skill 内容草案（待实现细化）

每个 skill 至少包含：

- **触发场景**：用户询问用量 / 花销 / 如何省额度 / 怎么用得更好。
- **操作步骤**：建议运行的命令，如 `ccoach report --json --days 7`。
- **解读指南**：各指标含义与经验阈值（缓存命中率偏低 → 提示复用上下文；reasoning 占比过高 → 提示精简任务）。
- **输出模板**：结论 / 依据 / 行动项 / 风险与不确定性。
- **口径护栏**：强制声明「仅本机数据 / 成本为估算 / **不得编造配额百分比**」。

### 3.6 范围

**In scope（本期）**
- 增强 CLI 数据：让 `report --json`（及可能的 `--digest`）成为 agent 可直接消费的语义化数据。
- 演进 `ccoach-insight` skill：新增**会话 / 项目 / 全局三个 scope**（§3.9、ADR 0005）。
- **特性优先建议**：诊断结果优先映射到 Claude Code / Codex 原生特性（§3.10、ADR 0006）。
- **会话 / 项目层可读 user prompt**（转述 + 脱敏）以诊断提示质量；全局层保持纯聚合。
- 隐私护栏写进 skill 指令（仅本机、估算成本、禁配额幻觉、绝不读 assistant 回复）。

**Out of scope（本期不做）**
- 在二进制内调用 LLM / `advise` 子命令（已被 ADR 0004 取消）。
- **读取 / 导出 assistant 回复文本**（任一 scope 都不读，见 §3.9 信号选择）。
- 跨机器汇总用量（受 rollout 机器隔离约束）。
- 真实账单 / 配额百分比（口径限制，见 §2 边界）。
- skill 自动改配置（先只给建议，执行由人确认）。

### 3.7 验收标准

- [ ] `report --json`（及 `--digest`，若引入）字段自描述、口径清晰，agent 无需额外上下文即可解读。
- [ ] skill 能引导 agent 产出「结论 / 依据 / 行动项」的建议。
- [ ] skill 支持**按 scope 切换**（会话 / 项目 / 全局），各 scope 数据定位正确（ADR 0005）。
- [ ] 建议**含具体产品特性项**（如 CLAUDE.md / hooks / permission 设置 / effort 档位），而非仅泛泛说教（ADR 0006）。
- [ ] **任一 scope 都不读取 / 不导出 assistant 回复**；**全局层不出现 user prompt 原文**；
      会话 / 项目层若涉及 user prompt，均为转述 + 脱敏。
- [ ] skill 中固化口径护栏，agent 不会输出配额百分比等越界结论。
- [ ] 无用量数据时，skill 指引 agent 给出明确空态提示而非编造。
- [ ] 数据/口径稳定：字段含义不随版本静默漂移（破坏性变更需版本标注）。

### 3.8 非功能性要求

- **隐私优先**：CLI 默认只读、不外发；分析只基于 user prompt / permission / tool 调用，
  **绝不读 assistant 回复**；user prompt 仅在会话 / 项目层、转述 + 脱敏后使用，全局层纯聚合（§3.9、ADR 0005）。
- **离线友好**：CLI 不为分析目的引入网络依赖；分析发生在用户已在用的 agent 侧。
- **可测试**：CLI 的采集 / digest 逻辑与任何模型解耦，可在无模型环境下单测（沿用 `Build()`/`Run()` 分离）。

### 3.9 三层分析与信号模型（已实现）

> 决策见 [`adr/0005-tiered-analysis-and-signals.md`](adr/0005-tiered-analysis-and-signals.md)。

三个 scope 作为 `ccoach-insight` skill 的模式：

| scope | 视角 | 数据定位 |
| --- | --- | --- |
| **会话级 session** | 当前这次会话 | 在会话中插入 skill 即时分析；agent 已持有当前会话上下文 |
| **项目级 project** | 单个项目跨会话 | Claude Code：`~/.claude/projects/<cwd 编码目录>/`；Codex：按 repo/cwd 过滤 rollout |
| **全局级 global** | 跨所有项目 / 时间窗口 | `ccoach report --json`（采集已并入 CLI，见 ADR 0018；`--scope project/session` 出分层桶，`ccoach sessions` 做会话钻取）|

**信号选择**：分析只基于 **user prompt + permission + tool 调用**，**不读取 assistant 回复**
（回复体量大、对「人如何驱动工具」诊断价值低，去掉后上下文显著变小，会话级「插入即分析」才可行）。

**prompt 读取边界**：会话 / 项目层可读 user prompt（仅本机、用户发起、转述 + 脱敏、不逐字成片堆叠），
复用 `references/session-prompt-review.md` 框架；全局层保持纯聚合（零 prompt 文本）。

> **规划中（pending）**：拟**细化失败类别**——把 `other` 兜底里的环境/外因（断网、磁盘、命令缺失、被 kill 等）
> 识别出来，并按**外因/内因**分组，回答「失败是 AI/prompt 的问题还是机器环境的问题」。仅扩白名单标签 + 纯计数，
> 红线不变。见 [`adr/0021-error-taxonomy-refinement.md`](adr/0021-error-taxonomy-refinement.md)（提议中）、TODO T14。

### 3.10 特性优先建议（已实现）

> 决策见 [`adr/0006-feature-first-recommendations.md`](adr/0006-feature-first-recommendations.md)。

产品目的是帮用户**用好 Claude Code / Codex 的特性**，因此建议先映射到原生特性，再补习惯 / 提示类做法。
代表性映射（非穷举，详见 ADR 0006）：

- 重复加载 / 低缓存、长上下文 → CLAUDE.md / AGENTS.md、`@文件`引用、`/compact`、memory。
- 工具循环 / 探索漂移 → plan mode、subagents、提前给路径 / 验收标准。
- 改完不验证 → hooks 自动跑测试、AGENTS.md 固化测试命令。
- 权限打断多 → `settings.json` 权限 allowlist / permission 模式；Codex `approval_policy` / `sandbox_mode`。
- reasoning 占比高 / 贵 → Codex `model_reasoning_effort` / `model_verbosity`、简单任务换小模型、按需 extended thinking。

给配置建议前须**联网核对最新官方文档**；skill 只建议、不自动改配置。

**时间感知护栏（必须）**：用量是历史数据，任何「模型版本」类结论都必须考虑**模型可用时间**。
不得把「新模型发布前用了旧模型」当成浪费或错误，也不得据此建议「回溯固定到新模型」。判断方式：
看 per-day per-model 时间线（`ccoach report --json` 已产出 `models_timeline`：每模型 `first_day`/`last_day`
+ 每日 token），若新模型只在窗口末尾才出现（`first_day` 很晚）或尚未出现，则旧模型花费属发布时机所致、
是预期行为；仅当新模型在窗口内确实可用时，才建议**今后**默认用更新的模型（须先联网核对发布日期）。
对已开始切换到新模型的用户，应肯定其前瞻行为、无需纠偏。（落地见 `skills/ccoach-insight/`
的 SKILL.md「Analysis Guidance」与 `references/insight-patterns.md`「Model Version Distribution」。）

### 3.11 可分享成绩卡（病毒传播）（已实现）

> 决策见 [`adr/0008-gamified-shareable-scorecard.md`](adr/0008-gamified-shareable-scorecard.md)。

既然用 HTML 呈现，就顺势提供**情绪价值 + 社交传播**：把用量评成**多轴独立段位**，做一张可截图的
成绩卡。对标 ccusage 靠「成本计分卡」病毒传播，ccoach 多了**习惯与 prompt** 两个维度，可以玩得更深。

- **多轴独立评级（不做单一总分）**，让每个人在某条轴上都能拿到「能炫或能笑」的标签：
  - **Prompt 功力**（核心、独有）：大师级 / 老练 / 学徒 / 复读机 / 玄学召唤师。
  - **烧钱姿势**（成本 + 值不值）：性价比刺客 / 理性消费 / 富哥随意 / Opus 锤钉子。
  - **工程素养**（git/session 习惯）：架构师 / 工程师 / 莽夫 / 考古学家。
  - **勤奋度**（频率，纯娱乐）：劳模 / 996 战士 / 养生程序员 / 周末才想起来。
- **封面成绩卡**：竖版、适配手机截图、信息密度适中，置于 HTML 顶部；详细分析在下方。
- **人格总结由模型生成**：把几轴合成一句又准又毒的称号（沿用 skills 化，模型在 agent 侧写）。
- **对比钩子**：「超过了 73% 的用户」相对排名；早期用本地估算、标注、后期校准。
- **分寸**：损但不伤人——只吐槽可改变的行为习惯，不攻击能力 / 人格。
- **隐私即卖点**：prompt 全程本地处理、不上传，并在 README / UI 写明（沿用 §3.8 / ADR 0005）。

> **规划中（pending）**：拟加**第 5 轴「编码自主度」**，把「用户多大程度自己改代码 / 不采用 AI 产出」
> （古法编程 / 人机结对 / AI 全托管 / 甩手提问家）做成称号，复用已有 `rework_signals`、无新采集。
> 见 [`adr/0020-coding-autonomy-scorecard-axis.md`](adr/0020-coding-autonomy-scorecard-axis.md)（提议中）、TODO T13。

---

## 4. 度量

- 采纳率：用户看到建议后是否调整了使用习惯 / 配置（可由后续变更间接观察）。
- 可信度：建议中是否出现与口径冲突的表述（如声称配额百分比）——目标为 0。

---

## 5. 分发与安装

> 决策见 [`adr/0003-npm-distribution.md`](adr/0003-npm-distribution.md)。

### 5.1 需求

让用户能用最顺手的方式安装：`npx ccoach` 试用、`npm i -g ccoach` 全局安装；
同时把产品的两块交付物——**CLI** 与 **skills**——在同一仓库内清晰分开、各自独立发布。

> 包名：CLI 包 `ccoach`、skills 包 `@ccoach/skills`（[ADR 0003](adr/0003-npm-distribution.md) 写于更名前，包名以此处为准）。

### 5.2 方案

> 随 [ADR 0010](adr/0010-cli-rewrite-node-ccusage.md)（CLI 迁移到 Node/TS）调整：CLI 是**普通
> Node 包**，不再是「包装 Go 二进制」。ADR 0003 D2 的「平台专属 optionalDependencies 二进制矩阵」
> **作废**——Node 包天然跨平台，分发大幅简化。

- **CLI 走普通 npm 发布**：`npx @loredunk/ccoach` 即用，无预编译二进制矩阵、无 postinstall 联网下载。
- **skills 走 `npx skills add`**（Vercel Labs `skills` CLI，**取代**自建 `@ccoach/skills` 包 + `ccoach skills install`，
  见 [ADR 0028](adr/0028-distribution-npx-skills.md)）：`npx skills add loredunk/ccoach`
  （交互选 agent/scope；非交互可加 `-a claude-code -a codex -g -y`），装到 Claude symlink `~/.claude/skills`、
  Codex universal `~/.agents/skills`；仓库无需清单、自动发现 `skills/*/SKILL.md`。已实测本地与远端均可装出 `ccoach-insight`。

### 5.3 验收标准

- [ ] `npx @loredunk/ccoach` 可在不预装的情况下直接跑通（跨平台，普通 Node 包）。
- [ ] `npm i -g @loredunk/ccoach` 后全局可用 `ccoach`。
- [x] skill 可经 `npx skills add loredunk/ccoach`（交互选 agent/scope）装到双端（ADR 0028，已实测）。
- [x] README / README_CN 写明安装命令（CLI `npx @loredunk/ccoach` + skill `npx skills add`）。
