# ADR 0036 — 量化反事实基线：finding 三件套 + 类型内历史百分位

> 状态：提议中 · 日期：2026-06-05
> · 复用 [`adr/0006-feature-first-recommendations.md`](0006-feature-first-recommendations.md) 的「finding → 产品原生特性」feature-first 映射
> · 成本口径走 [`adr/0019-pricing-online-official-at-skill-layer.md`](0019-pricing-online-official-at-skill-layer.md)（skill 层联网官方价 + CLI 离线 fallback）
> · 依赖 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md)（episode 抽象层）与 [`adr/0033-episode-task-typing-within-type-normalization.md`](0033-episode-task-typing-within-type-normalization.md)（类型内归一化）
> · 历史基线依赖 [`adr/0035-incremental-cache-per-platform-profile.md`](0035-incremental-cache-per-platform-profile.md)（按平台/profile 增量缓存历史）

## 背景

ccoach 的建议要「深刻」，关键不在于多列几条「你应该……」，而在于**量化反事实**：把一个观察到的浪费，
落到「这事发生了多少次」「折算下来烧了多少钱」「原生 feature 怎么一招解决」三件可量化、可对照的事实上。
没有量化，建议就是泛泛而谈；有了量化，用户才能判断这条建议值不值得照做。

量化的前提是有**基线**——「比什么算多、比什么算贵」。本 ADR 明确：**基线一律取自用户自己的历史数据**
（周环比、自身 p50/p90 百分位），**不需要、也不引入跨用户数据**——既守住隐私红线（只反映本机、不跨机器汇总），
又让对照对用户本人有意义（每个人的工作量级不同，跨用户均值反而误导）。

基线要落地依赖两块尚未实现的能力：episode 抽象层（[ADR 0032](0032-episode-abstraction-layer.md)，把原始 JSONL
聚成「一次任务」粒度，才谈得上「一次任务花多少」）与历史缓存（[ADR 0035](0035-incremental-cache-per-platform-profile.md)，
按平台/profile 增量缓存，才谈得上「周环比 / 历史百分位」）。**本切片只确立结构与口径，不实现采集与计算，留蓝图占位。**

## 决策

### D1 finding 三件套结构

每条 finding 尽量带三件套字段，构成 `finding` 的量化骨架：

```
finding = {
  frequency,    // 发生频次：在统计窗口内该问题出现的次数（纯计数）
  cost_usd,     // 折算成本：该问题对应的估算花费（USD，估算值）
  feature_fix,  // 原生 feature 解法：指向产品原生特性的修复建议（feature-first）
}
```

- `frequency` 为纯计数（沿用派生信号红线：只出计数，不留原文）。
- `cost_usd` 为**估算值**，口径与标注见 D3。
- `feature_fix` 为指向**产品原生特性**的可执行修复，映射规则复用 D4。
- 三件套是「尽量带」而非「强制带」：某条 finding 若确实算不出折算成本（如纯习惯类），`cost_usd` 可为 null
  并在文案降级，不因缺一件而丢掉整条 finding。

### D2 基线源：类型内历史百分位 + 周环比，冷启动降级

基线一律取自**用户自身历史**，分两路：

- **类型内历史百分位**：按 [ADR 0033](0033-episode-task-typing-within-type-normalization.md) 的任务类型
  （`task_type`）分桶，在**同类型**内算用户自身的 p50 / p90，作为「正常 / 偏高」的对照线——
  避免拿「写文档」的成本去比「跑大重构」。
- **周环比**：依赖 [ADR 0035](0035-incremental-cache-per-platform-profile.md) 缓存的历史，比较本周与上周同口径指标，
  给出「在变好还是变差」的方向感。
- **冷启动降级**：无历史缓存（首次运行 / 缓存被清）时，**降级为「当前窗口内百分位」**——即只在本次分析窗口内
  算同类型 p50/p90，**并在文案显式标注「基于本次窗口、无历史对照」**，待历史积累后自动升级到跨周基线。

### D3 折算成本口径：skill 层联网官方价，CLI 出离线 fallback，标注估算

`cost_usd` 的计算复用 [ADR 0019](0019-pricing-online-official-at-skill-layer.md) 的成本分层：

- **权威成本**由 **skill 层按实际模型名联网查官方定价**后计算；
- **CLI** 只出**离线 fallback** 估算（离线价表非权威）；
- 无论哪一层，`cost_usd` 都是**估算值**，渲染时**必须带「估算 / estimate」标注**，不得呈现为实际账单
  （沿用「不输出配额、成本为估算」的护栏）。

### D4 feature-first 映射：复用 ADR 0006

`feature_fix` 字段的「finding → 原生 feature」映射**直接复用** [ADR 0006](0006-feature-first-recommendations.md)
已确立的 feature-first 建议机制：建议优先指向产品**原生特性**（而非外部 hack / 自造流程），三件套只是给这套
映射补上 `frequency` 与 `cost_usd` 两个量化维度，让「该用哪个 feature」变成「这个 feature 一年能帮你省下 X」。

## 后果

- **正面**：建议从「定性劝告」升级为「带频次 + 折算成本 + 对照线 + 原生解法」的量化反事实，深度与说服力显著提升；
  基线全部来自本机历史，零跨用户数据、不破隐私红线；三件套是结构契约，CLI/skill 两层可分别填权威/估算成本而互不阻塞。
- **结构契约**：`finding` 的 `{frequency, cost_usd, feature_fix}` 一旦定型，即成为 CLI `--json` 与 skill 解读的
  新契约面，后续平台适配器与渲染层都按此对齐；任何新平台只要能聚出 episode 与成本，就能复用同一三件套。
- **依赖未就位**：本切片不实现，强依赖 [ADR 0032](0032-episode-abstraction-layer.md) /
  [ADR 0033](0033-episode-task-typing-within-type-normalization.md) /
  [ADR 0035](0035-incremental-cache-per-platform-profile.md) 落地；在这三者就绪前，三件套只能跑冷启动降级路径
  （窗口内百分位、无周环比），属预期内的能力缺口而非缺陷。
- **成本标注负担**：所有 `cost_usd` 出口都要带估算标注与口径说明（离线 fallback / 联网官方价），文案与 i18n
  需相应扩字段；漏标会让用户误以为是真实账单，是必须守住的红线。
- **冷启动观感**：首次运行只有窗口内百分位、没有周环比，量化深度天然弱于积累若干周之后；需在文案上把「正在积累历史」
  讲清楚，避免用户误判为「功能没用」。

## 开放问题

### OQ1 历史窗口长度

周环比与历史百分位取多长的历史窗口？固定（如近 4 周 / 近 8 周）还是随缓存量自适应？窗口太短噪声大、太长又稀释近期变化，
需结合 [ADR 0035](0035-incremental-cache-per-platform-profile.md) 的缓存粒度定。

### OQ2 冷启动体验

冷启动降级（窗口内百分位、无周环比）如何在 CLI/skill 两层一致呈现？标注措辞、是否给出「再用 N 周即可解锁周环比」的
预期管理文案？降级到正式基线的切换是否要对用户可见。

### OQ3 成本估算口径与标注

CLI 离线 fallback 与 skill 联网官方价两套口径并存时，`cost_usd` 的标注如何区分二者、避免用户混淆？折算是否要带置信区间
或「按某模型价估算」的前提说明，标注粒度到字段级还是段级。

### OQ4 「最深的坑」与三件套的统一

报告里「最深的坑」（最该改的那一条）如何折算并与三件套统一表达？是直接复用 `cost_usd` 排序选 top-1，还是另设一个
跨 finding 的聚合口径（如「这一类问题全年合计省 X」）？需保证「最深的坑」与逐条 finding 的成本口径一致、可加总、不重复计。
