# ADR 0034 — 绕圈检测（纯结构信号）+「最深的坑」故事卡

> 状态：已接受 · 日期：2026-06-05
> · 相关：[`adr/0008-gamified-shareable-scorecard.md`](0008-gamified-shareable-scorecard.md)
> · [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md)
> · [`adr/0019-pricing-online-official-at-skill-layer.md`](0019-pricing-online-official-at-skill-layer.md)
> · [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md)
> · [`adr/0033-episode-task-typing-within-type-normalization.md`](0033-episode-task-typing-within-type-normalization.md)
> · [`adr/0036-quantified-counterfactual-baselines.md`](0036-quantified-counterfactual-baselines.md)

## 背景

「你打断太多了」是废话——它没有可执行价值，用户既不知道代价，也不知道下一步该怎么改。
真正像教练的是：「本周 **32% 的 token** 花在最终被你打断的回合上、约 **¥X**，其中**六成**可
靠一句 plan mode 省掉」。差距在于把模糊体感换成**带定位、带代价、带反事实**的具体事实。

好消息是：识别「绕圈」（spiral，指 AI 在一个 episode 里反复改同一处、连续踩错、原地打转而无
实质进展）**可以完全在 CLI 离线、纯结构地算出来**——只看工具调用序列、`tool_result` 的
`is_error` 翻转、文件触碰集合、token/时长这些**结构信号**，**不碰任何 prompt / 内容**。隐私
故事因此完全不变：沿用 [ADR 0017](0017-derived-non-content-signals.md) 的「派生非内容信号」边界，
只产出布尔/计数/标签，内容瞬时派生即弃。

绕圈检测以 [ADR 0032](0032-episode-abstraction-layer.md) 的 episode 抽象层为载体、复用
[ADR 0033](0033-episode-task-typing-within-type-normalization.md) 的 `task_type`（用于「类型内」阈值
归一），并把结果做成 [ADR 0008](0008-gamified-shareable-scorecard.md) 谱系下新的可分享维度。

## 决策

### D1 每 episode 一个结构化 `SpiralSignals`

每个 episode 产出一个**结构化** `SpiralSignals` 对象，而**非单一 `is_spiral` 布尔**。理由：单布尔
丢失了「为什么绕圈、绕得多深」的信息，既不利于 skill 层做差异化解读，也违背
**CLI = 出数据 / skill = 出解读**的分工。结构如下：

- `edit_ring`（布尔）— 反复改同一处。
- `error_dense`（布尔）— 连续踩错 / 高错误率且原地打转。
- `no_progress`（布尔）— 持续消耗但无新进展。
- `time_outlier`（布尔）— 活跃时长异常偏长。
- `low_confidence`（布尔）— 信号弱、判定不确定（供 skill 层降权或不渲染）。
- `severity`（数值）— 触发子信号的**加权计数**；`0` 表示无 spiral，数值越大代表绕得越深。

子信号布尔 + 一个数值 `severity` 的组合，让 skill 层既能解释「绕在哪个维度」，又能用单一可比的
数值排序、选「最深的坑」（见 D4）。`severity` 权重见 OQ2。

### D2 各子信号判定规则

全部判定**只读结构**，不读测试输出 / stderr / diff 等任何正文：

- **`edit_ring`** = 同一文件在该 episode 内被 `edit` ≥ `EDIT_RING_MIN`（草案 `3`）次；尤其命中
  `edit → run test → error → edit` 的**工具序列 n-gram 模式**时强信号。需要有序工具序列，
  实现见 D3。
- **`error_dense`** = 满足任一：① ≥ `3` 个**连续**错误 `tool_result`；② `error_rate ≥ 0.5` 且
  调用次数 ≥ `4`，**且文件触碰集合不再扩大**（原地打转，而非正常铺开新工作面）。
- **`no_progress`** = 连续 ≥ `M` 次调用 / 一段 token 消耗内，**「新文件触碰数 = 0」且「红转绿 = 0」**。
  「红转绿」由 **test 类别 `tool_result` 的 `is_error` 翻转**派生：同一 episode 内某 test 先
  `is_error = true`、其后再次出现 `is_error = false`，记一次红转绿——**纯结构，不读测试输出文本**。
- **`time_outlier`** = 活跃时长 **>** 该 `task_type`（ADR 0033）**类型内 p90**，**且** > 绝对地板
  `TIME_FLOOR`（草案 `5min`，避免冤枉本就很短的小 episode）。两个条件须同时满足。

各阈值（`EDIT_RING_MIN` / 连续错误数 / `M` / `TIME_FLOOR` / p90）均为草案，须用真实数据校准（见 OQ1）。

### D3 隐私：有序工具序列瞬时保存、`finalize` 后即弃

`edit_ring` 与 `no_progress` 需要**有序**的工具序列才能判定。`EpisodeBuilder` 在构建过程中**瞬时**
保存一个有序的轻量序列，每项形如 `{ kind, error, fileLocalId }`：

- `kind` — 工具类别（如 edit / run-test，固定白名单标签）。
- `error` — 该步是否出错（布尔，来自 `tool_result.is_error`）。
- `fileLocalId` — 由**文件 basename 瞬时映射**成的 **episode 内局部 id**（如 `f1`、`f2`）；
  **basename 本身绝不存储、绝不输出**，只用于在本 episode 内判断「是不是同一个文件」。

`EpisodeBuilder.finalize()` 派生出 `SpiralSignals` 后，**整段有序序列连同 `fileLocalId` 映射一并丢弃**。
这完全沿用 [ADR 0017](0017-derived-non-content-signals.md) 的「瞬时派生即弃」契约：内容只在内存中
活到派生结束，落盘 / 外发的只有布尔、计数与 `severity`。

### D4 「最深的坑」：`deepest_pit`

`episode_summary.deepest_pit` = 在所有 episode 中 **`severity × token 烧量` 最高**的那个 episode 的
**引用**，包含 `session_id` + `index` + 关键数字（如该 episode 的 token、错误次数、edit 次数、活跃时长、
命中的子信号）。

CLI **只给定位 + 结构数字**，**不渲染故事、不折算成本**：故事卡的时间线叙事、以及把 token 折算成
具体金额，全部由 **skill 层**完成——其中折算价走
[ADR 0019](0019-pricing-online-official-at-skill-layer.md) 的「skill 层联网官方价」，CLI 不写死价表。

### D5 传播维度：主报告恒附 `episode_summary`

主报告（默认命令输出）**恒附** `episode_summary`，作为 [ADR 0008](0008-gamified-shareable-scorecard.md)
谱系下的**新可分享维度**，至少含：

- `episodes` — episode 总数。
- `autonomy_rate` — 无打断 episode 占比，即**AI 自主完成率**。
- `interrupted_rate` — 被打断 episode 占比。
- `corrected_rate` — 被纠错 episode 占比（**Claude only**，依赖 `userModified` 等平台信号）。
- `intervention_style` — **派生标签** `micro-manager | balanced | free-range`，由打断率 + 纠错率派生。
- `spiral_episodes` — `severity > 0` 的 episode 数。
- `task_mix` — 各 `task_type`（ADR 0033）的分布。
- `deepest_pit` — D4 的引用。

带叙事的「最深的坑」故事卡，比抽象的四轴评分**更易被截图分享**，是这套维度的传播抓手。

## 后果

- **纯结构、见效快、可独立发版**：绕圈检测不依赖联网定价、不触碰 prompt/内容，可在 episode 抽象层
  （ADR 0032）落地后独立交付一版，无需等 skill 侧故事卡渲染完成。
- **隐私边界零放宽**：所有判定走 ADR 0017 的派生非内容信号 + 瞬时即弃（D3），落盘/外发只有布尔/计数/标签；
  隐私护栏与对外承诺无需改动。
- **新增可分享维度与故事卡**：`episode_summary`（D5）扩充了 scorecard（ADR 0008）的内容，`deepest_pit`
  故事卡（D4）提供带代价、带定位的叙事，配合 ADR 0036 的反事实基线可进一步量化「能省多少」。
- **CLI/skill 契约扩展但分工不破**：CLI 新增 `SpiralSignals` 与 `episode_summary` 字段（数据），渲染/折算
  仍在 skill（解读 + 联网官方价，ADR 0019）；`--json` 契约向后兼容地增量扩展。
- **校准成本前置**：阈值若不校准，存在 crying wolf 风险（误报正常的反复迭代为绕圈），见 OQ1。

## 开放问题

### OQ1 阈值校准（防 crying wolf）

`EDIT_RING_MIN` / 连续错误数 / `no_progress` 的 `M` / `TIME_FLOOR` / 类型内 p90 等阈值均为草案，
**必须用真实用量数据校准**，避免把正常的「反复迭代 / TDD 红绿循环 / 大改一处」误判为绕圈。校准前
`SpiralSignals.low_confidence` 应在弱信号场景置位，供 skill 层降权或不渲染。

### OQ2 `severity` 子信号权重

`severity` 作为子信号的**加权计数**，各子信号（`edit_ring` / `error_dense` / `no_progress` /
`time_outlier`）的权重如何设定、是否随 `task_type` 调整，待定，同样依赖真实数据。

### OQ3 更多 episode 维度后置

「脱困速度」（从绕圈开始到打断的平均时长）等更多派生维度暂不在本期，留待 E5 / E9
（见 [ADR 0036](0036-quantified-counterfactual-baselines.md) 及 ADR 0040）。
