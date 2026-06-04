# ADR 0020 — 成绩卡第 5 轴「编码自主度」：把手改率/自主编码倾向做成称号

> 状态：提议中 · 日期：2026-06-04
> · 扩展 [`adr/0008-gamified-shareable-scorecard.md`](0008-gamified-shareable-scorecard.md)（四轴成绩卡）
>   与 [`adr/0009-i18n-scorecard-copy.md`](0009-i18n-scorecard-copy.md)（zh/en 本地化文案）
> · 复用 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md) 已落地的 `rework_signals`，**无新采集**

## 背景

成绩卡现有四轴：Prompt 功力 / 烧钱姿势 / 工程素养 / 勤奋度（ADR 0008，算分在 `scripts/scorecard.mjs`，
文案在 `references/scorecard-copy.json`）。用户希望再加一个维度，刻画**「在多大程度上自己改代码 / 不采用 AI 的产出」**。

用户的原始描述其实横跨**两个不同信号**：
- 「大部分自己改、不咋采用 Claude 的代码」（**古法编程**）→ AI 写了，但用户大改；
- 「只问问题、不让 AI 动代码」→ AI 基本没在写代码，用户只在咨询。

所需数据**均已存在**，是 ADR 0017 落地的 `rework_signals`（`src/model.ts`）：
`edits`（AI 编辑文件次数）、`user_modified`、`user_modified_rate`（AI 编辑后用户又手动改的比例）、`lines_added/removed`。
因此本轴是**纯派生展示**，不读任何新内容、不碰隐私红线。

## 决策

### D1 — 新增轴 `autonomy`「编码自主度」

UI 标签 zh「编码自主度」/ en「Coding Autonomy」，进 `scorecard-copy.json` 的 `ui.zh/en`（`axis_autonomy`）与 `axes.autonomy`，
并补 `test/scorecard.test.ts` 的 `AXES` 集合。沿用 ADR 0009：tier 名/吐槽为**人工本地化固定文案**，非模型直译。

### D2 — 两信号组合判定（4 档）

- 信号 A「让不让 AI 写」= 编辑活跃度 `editsPerSession = edits / sessions`：极低 → 用户基本只问、不让 AI 动代码。
- 信号 B「写完改不改」= `user_modified_rate`。
- 排序：**先判信号 A**（甩手提问家），否则按信号 B 分 0/1/2 档。

| tier | zh_name | en_name | 触发（草案，待校准） | zh_roast 草案 |
|---|---|---|---|---|
| 0 | 古法编程 | Hand-Forged | `user_modified_rate ≥ ~0.5` | AI 写完你重写一遍，键盘都包浆了 |
| 1 | 人机结对 | Pair Programmer | `~0.15 ≤ umr < ~0.5` | AI 打草稿你定稿，配合默契 |
| 2 | AI 全托管 | Auto-Pilot | `umr < ~0.15` | 闭眼合并，AI 说啥是啥 |
| 3 | 甩手提问家 | Hands-Off Asker | `editsPerSession` 极低（几乎不让 AI 写） | 只动口不动手，代码我自己来 |

### D3 — 分寸（沿用 ADR 0008 D5）

本轴**中性、无绝对好坏**——古法编程与全托管都是合法风格。吐槽只损**可改变的习惯**、不褒贬能力与人格。

### D4 — 隐私

零新增读取：只消费已有的 `rework_signals` 计数/比率（布尔/纯数值，ADR 0017 D1 已覆盖）。可分享成绩卡仍纯聚合、零 prompt 原文。

## 后果

- 成绩卡从「四轴 × 称号」扩成「五轴」，覆盖一个用户明确想看的维度，且零采集成本、零隐私面扩大；
- 需同步改三处：`scorecard.mjs`（`scoreAutonomy` + `axesSpec`）、`scorecard-copy.json`（`axes.autonomy` + UI 标签）、`test/scorecard.test.ts`（`AXES`）。

## 开放问题

- OQ1 **是否计入排名**：现有 `rank_pct` 由各轴 goodness 归一化得出；中性轴无 goodness 方向。建议 `autonomy` **不计入 `rank_pct`**，仅作展示称号（或取中性 goodness 0.5）。实现时定。
- OQ2 **阈值校准**：`editsPerSession`、`user_modified_rate` 的分档阈值需用多份不同画像的真实数据验证，避免把正常风格误判。
- OQ3 **Codex 等价字段**：`user_modified` 依赖 Claude Code 的 `toolUseResult.userModified`；Codex 侧是否有等价信号待核。若无，本轴仅 Claude Code 提供，渲染降级（与现有「本窗口内无活动」一致）。
