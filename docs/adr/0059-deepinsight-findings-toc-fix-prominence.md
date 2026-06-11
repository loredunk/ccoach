# ADR 0059 — deepinsight 报告导航：渲染器生成可点击发现清单 + 卡片锚点 + FIX 最高视觉权重

> 状态：已接受 · 日期：2026-06-11 · 分支：`0.1.7`
> · 与 [`adr/0058`](0058-deepinsight-plain-language-discipline.md)（语言纪律 v2）同批，针对同一轮用户反馈
> · 渲染器：`skills/ccoach-deepinsight/scripts/render_deepinsight.mjs`（单脚本、平台无关，Claude Code/Codex 同时受益）

## 背景

用户反馈 deepinsight HTML 的开头是一整段连续长文（`tldr`），每句话对应一个不同的发现、彼此意思割裂，
读者无法扫读，也没有任何跳转手段——卡片只有 `data-i` 属性，无 id 锚点、无目录。同时每个 finding 里
真正可执行的部分（fix 修复建议）视觉权重低于 root_cause 正文（只有虚线分隔 + 小金标签），用户要求
「fix 醒目一点、越容易跟着操作越好」。

## 决策

### D1 目录是渲染层职责，模型不输出目录

新增 `tocSection()`：渲染器从 `passes[].findings[]` **自动生成**可点击发现清单（分类彩色 chip +
finding 标题 + `href='#f-<pass>-<i>'`），渲染在 tldr 之后、术语区之前；多个 pass 有 findings 时按
pass 分组小标题；零 findings 整段省略。报告 JSON **不携带**目录字段——避免模型手写目录与正文漂移，
也少一个能写错黑话的字段。

### D2 纯静态锚点导航，零 JS

卡片加 `id='f-<passIdx>-<i>'`、pass 区块加 `id='pass-<idx>'`；`html{scroll-behavior:smooth}` +
卡片 `scroll-margin-top` 让跳转落点不顶死页首。报告保持纯静态 HTML（本地打开、可分享，无脚本依赖）。

### D3 tldr 收缩为 1-2 句结论

schema 指引从 "one-paragraph verdict" 改为「1-2 句结论 + 不要在 tldr 里枚举发现（清单由渲染器自动生成）」。
长段落的本职（逐条结论）由 TOC 接管，tldr 回归「一眼总判」。

### D4 FIX 升级为卡片内最高视觉权重

`.fix` 从「虚线上边线 + 描边小标签」升级为高亮块：金色渐变底 + 3px 金色左边线 + 圆角；`fix` 标签改实底
金底深字 tag（与 feature 药丸同视觉语言）；正文 16px 高对比。HTML 结构不变——纯 CSS + chrome 文案改动，
旧报告 JSON 直接受益。

## 后果

- 报告开头变成「短结论 + 可扫读可跳转的发现清单」，与用户的阅读动线（先看缺什么、点进去看怎么改）一致。
- 模型侧唯一变化是 tldr 写短一点；渲染器对旧 JSON 完全兼容（长 tldr 也照常渲染，只是不再被期待）。
- anchor id 以 pass 下标 + finding 下标构造，重渲染稳定可引用（外部笔记可链到具体发现）。
