# ADR 0041 — Codex prompt 语义对齐 + ~/.codex/sessions 深度独有优化

> 状态：提议中（pending） · 日期：2026-06-05
> · 兑现 [`adr/0011-multi-platform-usage-sources.md`](0011-multi-platform-usage-sources.md) 的「Codex 与 Claude Code 对称、一等数据源」承诺
> · 沿用 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md) 的「瞬时读 → 只留数值/白名单标签、原文绝不留」红线
> · 补齐 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md) 的 episode 抽象层在 Codex 侧缺失的 prompt 输入
> · 补齐 [`adr/0033-episode-task-typing-within-type-normalization.md`](0033-episode-task-typing-within-type-normalization.md) 任务分型在 Codex 侧缺失的 prompt 语义证据
> · 被 [`adr/0039-interruption-attribution-cli-structure-skill-semantics.md`](0039-interruption-attribution-cli-structure-skill-semantics.md) 依赖（打断归因需 Codex 侧「打断后用户的下一条消息」）
> · 受 [`adr/0038-privacy-levels-two-stage-extract-analyze.md`](0038-privacy-levels-two-stage-extract-analyze.md) 的隐私分级 + 两段式 extract/analyze 门控约束

## 背景

**现状缺口：Codex 侧完全不读用户 prompt，Codex 与 Claude Code 的「prompt 语义对齐」根本没做到。**

`src/parsers/claude-code.ts` 在遇到 `rec.type === 'user'` 时会取出用户文本并 `agg.applyPrompt(text)`，
喂进 `src/prompt-signals.ts` 派生 `prompt_signals`。而 `src/parsers/codex.ts` 的 `response_item` 分支只处理
`function_call` / `function_call_output` / `local_shell_call` / `web_search_call` 等**工具事件**，**从不读用户消息、
从不调用 `agg.applyPrompt`**。结果是 Codex 侧 `prompt_signals` 恒为空——两平台的 prompt 语义对齐是个空洞。

这个缺口向上游污染了多条已规划的能力：

- **无 `prompt_signals`**：Codex 用户拿不到 prompt 评级 / 习惯洞察（与 Claude 侧不对称，违背 ADR 0011）。
- **无 corrected `end_type`（ADR 0032）**：episode 的收尾语义缺少「用户下一条消息」这一关键证据。
- **任务分型（ADR 0033）只能靠工具/命令模式**：缺 prompt 文本就只能从 `exec_command`、`web_search_call`
  等工具痕迹反推 `task_type`，分型质量天然弱于 Claude 侧。
- **打断归因（ADR 0039）缺料**：Codex 侧拿不到「打断后用户的下一条消息」，无法判断打断意图——ADR 0039 已显式
  把本 ADR 列为依赖。

**但缺口的另一面是机会。** `~/.codex/sessions` 下的 `rollout-*.jsonl` 里有**大量详细聊天记录**
（`turn_context`、执行画像、逐回合消息等），其细粒度甚至超过当前从 Claude transcript 取到的信息——这是
**Codex 独有的深度优化空间**。

本 ADR 为 **pending**：只负责把「现状缺口 + 待办方向」钉死，**不混进 E1–E3 地基切片**，也不在本期实现。
动手前须先有真实 / fixture 数据核对记录形态（见开放问题）。

## 决策

### D1（草案）— 把 Codex prompt 读取对齐到 Claude 口径

调研 Codex rollout 里**用户输入的真实记录形态**——候选是 `response_item` 的 `type === "message"` +
`role === "user"`，也可能落在某种 `event_msg` 变体里（待核，见 OQ1）。确认形态后，在 `src/parsers/codex.ts`
的 `response_item`（及/或 `event_msg`）分支新增「用户消息」处理，取出文本调用 `agg.applyPrompt(...)`，
让 Codex 与 Claude **走同一条 prompt 信号管线、产出同构的 `prompt_signals`**。

红线与 Claude 侧完全一致、不放宽：

- **只派生数值信号**进 `prompt_signals`（长度 / 计数 / 比率类），**瞬时读、派生即弃**，绝不存 prompt 原文。
- **绝不读 assistant 回复**、不读 thinking / system·developer prompt / 文件内容（ADR 0017 红线照搬）。
- 沿用 Claude 侧对 sidechain（子代理）的处理：子代理 rollout 的 user 文本是 agent 生成的任务描述、
  **非人类本人输入，排除**（`isSubagentRollout` 已识别）。

### D2（草案）— Codex 独有的深度优化：`~/.codex/sessions` 细节深挖

在对齐口径之外，`~/.codex/sessions` 的额外细节按需深挖，做 **Codex 专属分析板块**（而非强行塞进
Claude/Codex 共用结构）：

- `turn_context` 已被消费的执行画像（`effort` / `approval_policy` / `sandbox` / `collaboration_mode` /
  `personality`，见 `src/parsers/codex.ts`）可进一步与逐回合用户消息**关联**，刻画 Codex 用户的
  执行风格画像。
- 逐回合消息 + token 增量 + 工具序列组合出的「执行节奏」是 Codex rollout 独有的细粒度，可作为 Codex
  专属洞察（不要求 Claude 侧有等价物，降级渲染即可，与 ADR 0023 平台专属段一致）。

D2 的所有新增读取**同样受 D1 红线约束**：派生数值/白名单标签、瞬时即弃、绝不存原文、绝不读 assistant。

### D3（草案）— 优先级与隐私门控

- **优先级：pending**，明确排在 **E1–E3 地基切片**与 **E7 隐私门控（ADR 0038）之后**。在隐私分级 + 两段式
  extract/analyze 落地前不动 Codex prompt 读取。
- Codex 侧 prompt 读取须**套用与 Claude 侧同一套 L1 审批 / 隐私分级**（ADR 0038 的 extract/analyze 门控）——
  不能因为是「新平台」就绕开门控或另起一套审批。

## 后果

- 兑现 ADR 0011 的对称承诺：Codex 从「无 prompt 信号」补到与 Claude 同构的 `prompt_signals`，
  下游 episode（0032）/ 任务分型（0033）/ 打断归因（0039）在 Codex 侧同时受益、不再降级。
- ADR 0039 的 Codex 路径被解锁（其依赖项落地）；在本 ADR 实现前，0039 的 Codex 侧打断归因仍只能用结构信号、
  缺「打断后用户文本」语义。
- `src/parsers/codex.ts` 需新增用户消息分支并接入 `agg.applyPrompt(...)`；`src/prompt-signals.ts` 复用、不必改。
- 隐私面**不扩大但需复核**：新增的是「用户本人 prompt 的瞬时数值派生」，落在已有红线内，但 Codex 形态不同，
  须确认不会误读 assistant / developer instructions。
- pending 不阻塞地基：本 ADR 与 E1–E3 解耦，地基切片可独立推进，Codex prompt 对齐随后补。

## 开放问题

### OQ1 — Codex 用户消息的真实记录形态待核

沙箱内**无真实 `~/.codex` 数据**，当前 `src/parsers/codex.ts` 的输出形状本就是「推断」（注释已标注）。
用户输入到底落在 `response_item`（`type === "message"` / `role === "user"`）还是某种 `event_msg` 变体、
文本字段名为何，**须用 fixture 或真机实测核对**后才能写 D1。

### OQ2 — `turn_context` 与用户消息记录的关系

`turn_context` 是回合级配置上下文，用户消息是回合级输入。两者在 rollout 里的**时序 / 归属关系**
（一个 `turn_context` 对应几条用户消息？是否一一对应？）需核实，否则 D2 的「执行画像 × 用户消息」关联会错位。

### OQ3 — E7 隐私分级如何套用到 Codex 侧 prompt

ADR 0038 的隐私分级 + 两段式 extract/analyze 门控是按 Claude 形态设计的。Codex 的 prompt 记录形态不同，
**分级粒度（会话 / 项目 / 全局）与 extract/analyze 切分点在 Codex 侧如何精确对应**需在 D1 实现时定，
不能想当然照搬 Claude 的字段映射。
