# ADR 0039 — 打断归因：CLI 抽事件包结构 / skill 做语义分类

> 状态：提议中 · 日期：2026-06-05
> · 依赖 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md) 的 E1 episode 抽象层（事件包挂在 episode 上）
> · 受 [`adr/0038-privacy-levels-two-stage-extract-analyze.md`](0038-privacy-levels-two-stage-extract-analyze.md) 的 E7 隐私分级 + 两段式 extract/analyze 门控
> · 依赖 [`adr/0041-codex-prompt-parity-sessions-deep-dive.md`](0041-codex-prompt-parity-sessions-deep-dive.md) 先对齐 Codex 侧 prompt（否则 Codex 缺打断后的用户文本）
> · 与 [`adr/0034-spiral-detection-deepest-pit-story.md`](0034-spiral-detection-deepest-pit-story.md) 的螺旋/深坑叙事互补（打断是螺旋的一种触发信号）

## 背景

**打断检测本身不难。** Claude Code 的 transcript 里，打断以两种文本出现：`[Request interrupted by user]`
（用户在 agent 思考/回复中途打断）与 `[Request interrupted by user for tool use]`（用户在工具执行前/中途打断）。
Codex 侧则是记录元数据上的 `metadata.interrupted` 布尔。两者都是**结构化、可正则/字段直取**的硬信号，
归到「派生非内容信号」无争议（沿用 ADR 0017 红线）。

**难的是归因——「为什么打断」。** 打断的语义五花八门：用户发现 agent 理解错了需求、改了不该改的文件、
在读一堆无关文件兜圈子、想补一句一开始没说清的上下文，或者只是误触。**这是语义判断，正则做不了**：
同一句 `[Request interrupted by user]` 背后可能是任意一种动机，必须看打断前 agent 在干什么、打断后用户说了什么、
agent 随后有没有「重来」。

这正好契合本仓库 **CLI = 数据 / skill = 解读** 的既定分工（ADR 0004 / 0010 的 `--json` 契约）：
CLI 负责把「一次打断」周围的上下文**结构化封箱**（事件包），skill 负责对每个事件包做**语义归因**。

**本切片是蓝图占位、本期不实现**：它依赖 E1 episode 抽象（[ADR 0032](0032-episode-abstraction-layer.md)，
事件包需挂在 episode 边界上才有「打断后是否重做同一任务」的判定面）与 E7 隐私通道
（[ADR 0038](0038-privacy-levels-two-stage-extract-analyze.md)，事件包内容必须走分级门控）。
此处先把数据结构与分工定下来，待依赖落地后再实现。

## 决策

### D1 — CLI 侧抽「打断事件包」（结构化 JSON，草案）

CLI 在解析层识别每个打断点，向上输出一个**结构化事件包**（interruption envelope）。每个事件包包含、且仅包含
派生/转述后的结构（不含任何全文）：

- **打断前的 N 个 assistant turn**：每个 turn 只留**工具名 + 参数摘要**（如 `Read(path=…)` / `Edit(file=…)` /
  `Bash(cmd 摘要)`），**不含工具全文输出、不含 assistant 自然语言/思考**（红线，ADR 0016/0017）。
- **打断时正在执行的工具**：打断瞬间挂起的那个 tool call 的名称与参数摘要（区分 `for tool use` 与普通打断）。
- **打断后用户的下一条消息**：用户紧接着发的 prompt，**转述 + 脱敏**后给出（属本人 prompt，ADR 0015 长期授权可读；
  仍按写入前脱敏 + 截断）。
- **打断后 agent 是否重做了同样的文件/任务**：一个**结构判定**的布尔/计数信号——打断后 agent 是否又
  Edit/Write 了打断前正在碰的同一批文件，或在同一 episode 边界内重启了等价的工具序列（判定细节见 OQ2）。

输出是平台无关的统一结构（与现有 `--json` 契约同源），字段名草案：`interruptions[]`，每项含
`pre_turns[]`（`{tool, args_summary}`）、`interrupted_tool`、`next_user_message`（转述脱敏）、`redo_same_target`（布尔/计数）、
`episode_ref`（关联 E1 episode）。**CLI 只出结构，不做归因分类。**

### D2 — skill 侧 LLM 对事件包做语义归因（固定分类法）

skill 层把每个事件包喂给 LLM，要求按**固定归因分类法**输出标签（封闭集合，不让模型自由发挥；沿用 ADR 0031
「吐槽须落在真实信号上」的 grounding 原则——分类必须由事件包字段支撑）：

1. **方向纠错**（理解错需求）——agent 走错了方向，用户打断纠偏。
2. **范围控制**（改多了 / 碰了不该碰的）——agent 越界，动了不该动的文件/范围。
3. **冗余探索**（读太多无关文件）——agent 在兜圈子、读一堆与任务无关的东西。
4. **用户补充上下文**（信息一开始没给够）——并非 agent 出错，是用户要补一句关键信息。
5. **误触 / 无效打断**——无明确语义，或用户随即让其继续。

skill 据此做聚合洞察（如「你 60% 的打断是范围控制 → 试试在 prompt 里先圈定改动范围」），并接入成绩卡/建议。

### D3 — 隐私：CLI 提结构、skill 做语义，内容受 E7 门控 + 脱敏

事件包里唯一的「内容」是 `next_user_message`（本人 prompt）与 `args_summary`（工具参数摘要）。两者：

- 受 **E7 隐私分级（[ADR 0038](0038-privacy-levels-two-stage-extract-analyze.md)）门控**：按用户选定的隐私级别决定
  是否抽取、抽取到何种粒度；两段式 extract/analyze 中，CLI 处于 extract 段、只产出受控结构，skill 处于 analyze 段。
- **写入前一律脱敏 + 截断**（ADR 0015 红线）；`args_summary` 绝不含命令全行/文件内容/diff（ADR 0016/0017）。
- **绝不读 assistant/thinking/system·developer prompt 正文**：`pre_turns` 只取工具名 + 参数摘要这类派生标签，
  不读 assistant 自然语言。
- 全局层 / 可分享成绩卡**纯聚合**（仅归因分类的计数/占比），**零 prompt 原文、零事件包内容**。

## 后果

- 打断从「一个孤立的硬计数」升级为「带归因的习惯洞察」，能直接回答「我为什么老打断 agent、怎么少打断」——
  这是用户视角高价值的解读，且天然落在 CLI/skill 分工的接缝上。
- CLI 多一个 `interruptions[]` 结构与对应解析路径（识别两类打断文本 + Codex `metadata.interrupted`、回溯 N 个 turn、
  关联 episode、做 `redo_same_target` 结构判定），需补隐私回归断言（事件包不泄全文）。
- 归因质量取决于 LLM 与事件包信息量；固定分类法 + grounding 约束（ADR 0031）控制其不跑偏，但仍是**概率性解读**，
  报告措辞应表达为「推测的打断原因分布」而非定论。
- 强依赖 E1（[0032](0032-episode-abstraction-layer.md)）与 E7（[0038](0038-privacy-levels-two-stage-extract-analyze.md)）；
  Codex 侧还卡在 [0041](0041-codex-prompt-parity-sessions-deep-dive.md)（缺打断后的用户文本，事件包会降级为「仅结构、无 `next_user_message`」）。
  本期仅占位，不实现。

## 开放问题

### OQ1 — N 窗口大小与事件包封顶

`pre_turns` 回溯几个 assistant turn 才够归因、又不至于把事件包撑爆？N 太小丢上下文、太大增隐私面与体积。
需用真实 transcript 校准一个默认值（草案 N=3～5），并对单个事件包的字段长度/数量设硬上限（截断优先于丢弃，沿用 ADR 0015）。

### OQ2 — 「打断后是否重做同样文件/任务」的结构判定

`redo_same_target` 怎么在不读内容的前提下判定？候选：比对打断前后被 Edit/Write 的**文件路径集合**是否相交、
是否在同一 E1 episode 边界内重启了等价工具序列。「同一任务」比「同一文件」更模糊——是否需要、能否纯结构判定，
还是降级为「同一文件」即可，待 E1 episode 边界定义稳定后实现时定。

### OQ3 — Codex 侧无打断后的用户文本

Codex 的 `metadata.interrupted` 能给出「打断发生了」，但 Codex 侧 prompt 对齐未完成
（[ADR 0041](0041-codex-prompt-parity-sessions-deep-dive.md)），拿不到可靠的 `next_user_message`。
在 0041 落地前，Codex 事件包**降级**为「仅 `pre_turns` + `interrupted_tool` + `redo_same_target`、无打断后用户消息」，
归因只能基于 agent 行为侧推断，分类准确率会低于 Claude Code，渲染需标注该降级（与现有「本窗口内无活动」降级一致）。

### OQ4 — 归因分类法是否需要再拆/合并

五类是否覆盖真实分布、是否有高频「其它」需要再拆（参照 ADR 0021 拆 `other` 的方法论：本地一次性瞬时采样发现高频构成、
固化成规则、记录方法论不记录样本）？分类法应在真实数据上验证后再冻结，避免兜底桶过大或类别重叠。
