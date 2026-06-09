# ADR 0051 — 分享卡边界化 + 去百分位 + 术语 on-page glossary

> 状态：已接受 · 日期：2026-06-08 · 分支：`feat/share-card-glossary-redesign`
> · 修正 [`adr/0044-scorecard-title-render-order-guard.md`](0044-scorecard-title-render-order-guard.md)（成绩卡 short/long roast + render-guard 扩展）
> · 衔接 [`adr/0025-report-skeleton-i18n-default-english.md`](0025-report-skeleton-i18n-default-english.md) / [`adr/0026-cli-output-i18n-default-english.md`](0026-cli-output-i18n-default-english.md)（术语本地化、en 报告保持纯英文）
> · 触及 [`adr/0034-spiral-detection-deepest-pit-story.md`](0034-spiral-detection-deepest-pit-story.md)（spiral/severity 的用户可读措辞）

## 背景

为 ccoach 项目自身生成中文 Insight / DeepInsight 报告后，数据所有者的真实反馈暴露三处问题：

1. **术语黑话**：`spiral` / `severity` / `episode` 直接出现在面向用户的报告里，普通中文读者无法理解，报告不自解释。
2. **百分位失真**：成绩卡的「超过了 X% 的用户」是一个由四轴段位反推的**本地估算**（`goodness` 平均 → clamp[3,97]），没有任何真实对照群体，却长得像 benchmark，易误导。
3. **分享卡没有边界**：成绩卡（称号 + 四轴）下方直接流进端点、执行摘要等十几个 section，没有「到此为止、这块就是给你截图」的界限；且头部的合计成本 / Token / 活跃天数是三个独立 stat 框，数字与人设标题割裂，单屏分享时缺一个完整的 share unit。

## 决策

### D1 去掉百分位（计算 + 渲染 + 文案 + 测试）

`scorecard.mjs` 删除 `goodness[]` / `rankPct` 计算与 `rank_pct` / `rank_label` / `rank_is_estimate` / `estimate_note` 输出；`scorecard-copy.json` 删 `beats_pct` / `estimate_note`；`render_dual_platform.mjs` 删 `.sc-rank`。成绩卡只保留**确定性的段位 + 称号**，不再输出任何相对排名。渲染层新增 `RANK_RE` 回归断言，保证「超过了 X%/beats X%」不再出现。

### D2 成绩卡边界化为单屏 share unit + 数字带入卡

成绩卡做成**一张自包含、单屏可截的深色金 hero 卡**，承载全部信息：左上角 `● ccoach` 品牌 + 右上角运行/平台 meta（窗口 + `Claude Code · Max 订阅`）→ 人设称号 → **数字带**（一个 hero `$cost` 块「N 天烧掉（按 API 价折算）」+ 一个两格网格：总 TOKEN `5.81亿` / 缓存撑起 `96.2%`，关键数字金色突出）→ 四轴（段位药丸 + 完整 roast）→ 金点脚注。数字用等宽字（JetBrains Mono + 系统等宽兜底，离线不依赖联网字体）。`cachePct` 复用 `tokenComposition()` 口径，保证与正文 token 构成条一致；`active_days` 在双平台取**并集**（日历日重叠，非相加）；订阅档（`Max 订阅`）仅在 `endpoint=official` 且非中转时显示。单平台报告因数字带已承载头部数字而移除独立 metrics 区；`--scorecard` 缺省时回退旧 metrics 块。金点脚注文案为「称号为本地估算，仅供娱乐」（颜色不变）。

### D3 完整 roast 直接上卡（不拆分、无独立详解区）

每轴只有一个 `roast`（完整、有数字支撑的句子），**直接渲染在卡上**——不再有 short/long 拆分、也没有独立的「成绩卡详解」区，卡片本身就是 share unit。模型可选地在 roast 里用 `**…**` 包住**一处**关键短语，渲染器转成金色高亮（如「真贵的是那 387 万输出——**量最小，单价最横**」）。render-guard（ADR 0044）只对 `roast_is_fixture` 告警（回退早前一版引入的 `roast_short`）。隐私脚注从「全部分析在你本地完成，prompt 内容不离开你的机器」改为「全部 logs 解析在你本地完成」——ccoach 只在本地解析 logs、不新增外发，但 prompt 本就在跑会话时已发往模型方，旧措辞会误导。

### D4 术语 on-page glossary + 本地化

术语统一为 **episode→回合、severity→严重程度、spiral→卡壳**，并在两份报告 HTML 上各加一条「术语」条，给出大白话定义（severity 用其真实公式：`edit_ring×2 + error_dense×2 + no_progress + time_outlier`，0–6）。**单一来源切分**：on-page glossary 由各渲染器内置的 `GLOSSARY` 常量提供（`.mjs` 无法 import TS）；CLI / 文本路径仍由 `src/i18n.ts` 提供（`tx_spiral_note` 等）。en 报告的术语条与 CSS 注释保持**纯英文**（不夹中文），满足 ADR 0025 的 en 骨架零 CJK 闸门。

### D5 DeepInsight TL;DR 重设计

`.tldr` 从超大斜体 display serif（clamp 24–38px / 30ch 窄列）改为可读导语（body serif / clamp 18–22px / line-height 1.62 / 62ch / 左金线），长文不再被拉成又高又窄的长条。

## 影响

- 对外产物只描述行为与承诺，**不含 ADR 号 / 内部记号**（CLAUDE.md 对外产物约定）；唯一的内部标记是 HTML 注释 `<!-- ccoach:* -->`，与 ADR 0044 既有的 fixture 标记一致。
- `--json` 数据契约不变；成绩卡 JSON 仅去 rank 字段、加 roast_short 字段，向后兼容（render 对缺省字段回退）。
- SKILL（ccoach-insight）writeback 步骤更新为同时写 short + long roast 并清两个 flag。
