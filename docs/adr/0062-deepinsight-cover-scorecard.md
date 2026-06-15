# ADR 0062 — deepinsight 顶部引入与 insight 一致的封面成绩卡（经独立输入喂入）

> 状态：已接受 · 日期：2026-06-15 · 分支：`0.1.7`
> · 复用 [`adr/0019`](0019-pricing-online-official-at-skill-layer.md)（权威成本走 skill 层联网官方价）
> · 沿袭 [`adr/0028`](0028-distribution-npx-skills.md)（技能各自独立分发，自包含）
> · 隐私边界沿用 [`adr/0015`](0015-standing-local-authorization-prompt-reading.md) / [`adr/0016`](0016-error-signals-derived-tool-result-reading.md)（卡片为聚合、零标识符）

## 背景

用户希望 ccoach-insight 报告顶部那张「封面成绩卡」（dark+gold hero 卡：品牌条 + 人物称号 +
成本/token/cache 统计条 + 四轴评分与吐槽）也出现在 ccoach-deepinsight 报告里，置顶、**内容与 insight
完全一致**，设计沿用现有卡片（用户认为最好看）。

技术现实：卡片视觉是自包含的（`.scorecard*` CSS 仅依赖硬编码金色与 `--mono`，deepinsight 已定义），可直接
照搬；但卡片是**数据驱动**的——统计条来自合并后的 `ai-usage.json`，称号 + 四轴来自 `scorecard.json`
（确定性 `scorecard.mjs` + 模型改写人物称号与吐槽）。deepinsight 现有管线（`passes` / `magic_time` /
`project_health`）两样都不产出。三项产品决策已与用户确认：① deepinsight 自己生成这张卡；② 口吻与 insight
完全一致；③ 放在 `Deep Insight` masthead 正下方、TL;DR 之前。

## 决策

### D1 渲染器：可选 `--usage` + `--scorecard`，置顶渲染封面卡

`render_deepinsight.mjs` 新增 `renderDeepinsight(data, scorecard, usage)` 与 CLI 的 `--usage` / `--scorecard`
两个**可选**参数。两者都给时，从合并用量 JSON 构建统计条（`scStats`，与 insight 的 render 同口径：cache% 走
`tokenComposition` 累加、active-days 取日历并集、token 走 `compactTokens`），调用移植来的 `scorecardHtml`，
注入到 `</header>` 之后、`tldr` 之前。**两者缺一即不渲染卡片**——默认 dossier 字节级不变（向后兼容）。

移植自 `render_dual_platform.mjs` 的纯函数（`pct` / `compactTokens` / `tokenComposition` / `roastHtml` /
`scorecardHtml`）与 `.scorecard*` CSS 整块照搬；唯一改动是 `tr('sc_kicker')` → deepinsight 的 `L.sc_kicker`，
卡片用到的 8 个 `sc_*` / `m_total_tokens` 文案照抄进 `CHROME.en` / `CHROME.zh`。卡片外层 margin 由
`8px auto 34px` 调成 `0 auto 44px` 以贴合 deepinsight 的 44px 区块节奏（卡片本体视觉不变）。

### D2 确定性脚本随 deepinsight 自带（自包含分发）

把 `merge_dual_platform.mjs`、`apply_pricing.mjs`、`scorecard.mjs` 与 `references/scorecard-copy.json` **复制**
进 deepinsight（均仅依赖 node 内置、离线确定性）。理由：技能经 `npx skills add` 各自独立分发，跨技能
`${CLAUDE_SKILL_DIR}` 路径在安装后不互通——这与渲染器里 GLOSSARY 表「在 deepinsight 另存一份副本，keep in
sync」的既有做法同源。四个文件逐字复制以利「保持同步」。

### D3 成本走权威联网官方价（沿用 0019）

卡片 hero 统计条的副标题明确写「按官方 API 价计 / At official API prices」，故 deepinsight 工作流在 merge 后
**必须**跑 `apply_pricing.mjs`（agent 联网查每个模型官方价、写 `/tmp/pricing.json`），否则副标题与离线
fallback 数字自相矛盾。这是把 0019 的成本纪律同样套到 deepinsight 的卡片上。

### D4 口吻与隐私边界

卡片**刻意保留** insight 的人物/吐槽口吻（它是可分享的 share unit），而 dossier 正文仍是冷静、讲人话的
根因分析——两种口吻不混。卡片数据**纯聚合、零标识符**（无 prompt 原文、无 repo/项目名），是整份本地
dossier 中天然 share-safe 的一块；段位名固定不改、roast 只描述有具体数字支撑的现象、绝不断言 ccoach 不
测量的行为（测试是否跑过 / 是否 review / 是否该用 plan mode）。SKILL.md 与 schema 文档同步说明卡片经
`--usage` / `--scorecard` 独立输入喂入，不进 `report.json`。

## 后果

- deepinsight 报告默认可在顶部展示与 insight 完全一致的成绩卡（同输入逐字一致，仅单引号实体编码
  `&#x27;`↔`&#39;` 因两边各自的 `esc` 而不同，浏览器等价）；不给两个参数则报告与从前完全一致。
- deepinsight 工作流变长：需额外跑整机 `ccoach --json` + merge + 联网定价 + scorecard + 模型改写称号/吐槽。
- 四个确定性脚本与 copy 表在两个技能里各存一份，须保持同步（同 GLOSSARY 副本的既有约定）。
- 新增 `test/deepinsight-scorecard.test.ts` 回归：断言卡片置于 masthead 之下/TL;DR 之上、无参数时不渲染、
  与 insight 渲染结果内容一致、且不泄配额% / 百分位 / 密钥样式串。
