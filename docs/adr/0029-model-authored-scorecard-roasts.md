# ADR 0029 — 成绩卡 roast 文案交给模型：fixture 作样例 + 兜底，评级/段位名仍确定性

> 状态：已接受 · 日期：2026-06-04（落地：SKILL.md 指引 + `scorecard-copy.json` `_about` 更新；渲染管线无需改）
> · 延续 [`adr/0008-gamified-shareable-scorecard.md`](0008-gamified-shareable-scorecard.md)（D3 已让模型写 personality summary）/ [`adr/0009-i18n-scorecard-copy.md`](0009-i18n-scorecard-copy.md)（人工本地化文案）
> · 与 [`adr/0026-cli-output-i18n-default-english.md`](0026-cli-output-i18n-default-english.md) 互补：CLI 出确定性事实（默认英文），skill 出声音（模型化地道梗）

## 背景

「地道梗」要不要写死，还是交给大模型？产品定位是「CLI 出数据、skill 出解读」（ADR 0004）：CLI 已英文化、是确定性
事实层、用不上 LLM。梗是**声音/人格**、属解读层；且大模型最擅长**任意语言的地道幽默**——正是 skill 该用的泛化能力。
fixture（`scorecard-copy.json`）虽安全、确定、可测，但只对**人工本地化过的语言**地道，不 scale 到多语言、且每次同一句易陈旧。

## 决策

**梗放 skill、不放 CLI；skill 内再分两层**：

1. **确定性、固定**（不变）：tier 分数由 `scorecard.mjs` 启发式算；**段位名**（如 `Vibe Summoner`/`复读机`）+ UI 标签
   来自 `scorecard-copy.json` —— 稳定、可识别、可传播的「身份」，不 run-to-run 变；缺本地化的语言回退默认语言。
   **绝不让模型决定 tier**（公平/可复现/可测，`scorecard.test.ts` 守 fixture 输出）。
2. **模型撰写**：**axis roast 文案** + personality summary 由模型按**用户语言**现写——地道、新鲜、可用真实**聚合**数字
   增色。`scorecard.json` 里的 fixture roast 是**安全默认/兜底 + 语气样例**：模型在渲染前改写 `axes[].roast`；不改写就落 fixture。

**实现极简、零渲染改动**：渲染器本就读 `scorecard.json` 的 `axes[].roast`，agent 在 step 6→7 之间改写该字段即可；
`scorecard.mjs` 仍产出 fixture roast 作离线/opt-out/测试的确定性兜底。仅改 SKILL.md 指引 + 文案表 `_about`。

## 护栏（不可违反）

- **语气**：调侃可改的**习惯**，绝不攻击人/能力（ADR 0008）。fixture roast 作为语气样例约束声音。
- **纯聚合**：roast 只能用聚合数字（成本/token/时段/段位），**绝不引用或暗示 prompt 原文**——可分享成绩卡恒「零原文」。
- **确定性兜底**：模型不可用/离线/用户 opt-out 时，渲染 fixture roast；`scorecard.mjs` 与其回归测试不受影响。
- **段位名稳定**：模型只改 roast，不改 tier 名（身份一致性）。

## 影响 / 节奏

- **扩语言不再需要人肉翻 roast**：模型运行时按任意语言出地道梗；fixture 只维护主语言 + 英文兜底 + 段位名。
- 前期（现状）：用 fixture roast（en 已润色地道、zh 在表）。下一步：agent 按本决策改写 `axes[].roast`。
- 无新增代码路径；若日后想把「改写」做成确定性可测，可另起 ADR（如让 render 合并 insights 里的 roast 覆盖）。
