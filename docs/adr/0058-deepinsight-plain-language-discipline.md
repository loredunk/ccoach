# ADR 0058 — deepinsight 语言纪律 v2：声明式语体引导 + 示例去污染 + 分类徽章自解释

> 状态：已接受 · 日期：2026-06-11 · 分支：`0.1.7`
> · 上承 [`adr/0029`](0029-model-authored-scorecard-roasts.md)（roast 语义属 ccoach-insight）与
>   [`adr/0051`](0051-share-card-glossary-no-percentile.md)（术语 on-page glossary）的「讲人话」路线
> · 服务 deepinsight 的 SERIOUS 定位（区别于娱乐向 ccoach-insight）

## 背景

用户报告 deepinsight HTML 里出现大量自造黑话：「人肉转发被测系统的症状」「同一个坑咬了你两次」「闸门」
「连环修错」「结构热点」「双料冠军」「tight 内容摘要」。诊断出三个具体根因：

1. **覆盖面问题，不是哲学问题**——SKILL.md 已有「Plain words, always」且映射表内的词全部执行正确
   （报告通篇「原地打转」而非 spiral）；失控的是映射表**之外**的自由发挥修辞。dark editorial 视觉风格
   天然引诱模型写社论腔俏皮标题。
2. **示例污染**——schema 里 `digest_stats` 的示例值原文就是 `"tight ~7.5K tok · RESULT_ERR 1/75 · …"`，
   模型照抄示例模板，连内部词一起带进报告。
3. **产品声线串味**——roast 人设是 ccoach-insight（娱乐向记分卡）的资产；deepinsight 的 frontmatter
   明写 SERIOUS。不需要 `--tone` 开关，需要的是把已有 plain-words 意图执行到位。

另有一个同根症状：`category: "unknown_feature"` 的徽章硬编码渲染英文 `'Unknown Feature'`，中文报告里
读起来像「不明特性/bug 兜底」——它的真实语义是「有一个官方特性你还不知道、已经能解决这个问题」（机会，
不是故障）。

## 决策

### D1 声明式语体引导 + bad case 示范（明确否决硬规则方案）

曾考虑「词汇白名单 + 每个 finding 最多一个隐喻 + 强制自检清单」式硬约束，**用户明确否决**：不做硬编码
限制，通过 skill 声明引导。落地为 SKILL.md「Plain words, always」末尾追加 **Say it plainly** 段：

- 定位声明：deepinsight 是 SERIOUS 报告，roast 声线属于 ccoach-insight；标题与 finding 应读起来像
  「冷静的资深工程师陈述事实」，第一次见 ccoach 的读者扫一眼就能懂。
- 真实坏例 → 直白改法对照（「缺一道闸门」→「编辑后缺少自动编译检查」等四例），示范优于禁令。
- 轻量自检提醒（以第一次读者视角重读 headline），非强制清单。

理由：硬规则僵硬难维护、压表达弹性；声明定位 + 坏例对照足以让模型收敛（映射表的执行记录证明 skill
声明是生效的）。

### D2 示例去污染：schema 示例值必须是用户语言

`digest_stats` 示例改为 `"compact summary ~7.5K tokens · 1 of 75 turns errored · redacted · no thinking
content"`，并在 Notes 写明：`digest_stats` 是用户可见正文，按报告语言用直白词书写，内部管线词只进
`signal` 边注。原则化：**schema 里所有示例值本身就是模型的模板，必须以最终用户该看到的样子书写**。
顺手修渲染器 en chrome `digest` 标签 → `content summary`（zh 已是「正文摘要」）。

### D3 分类徽章本地化 + 自解释文案 + legend（落地见同分支后续提交）

- `CAT` 表改 `{ en, zh }` 双语，按报告 `lang` 渲染；`unknown_feature` 改为自解释文案
  **en "Native feature available" / zh「有现成官方特性」**（其余类目同步直白化：Knowledge gap/知识盲区、
  Prompt wording/提示词写法等）。
- finding 增可选 `category_label`：模型自造 novel 分类时给出报告语言的人类标签（否则 zh 报告里
  snake_case 会渲染成 Title-Cased 英文）；渲染优先级 已知表 → `category_label` → title-case 兜底。
- 报告内 legend：渲染器收集实际出现过的已知分类，在术语区后追加彩色 chip + 一句话定义
  （unknown_feature 的定义明说「这是机会，不是故障」）。
- 同步补漏 chrome i18n：`fix`/`signal`/`conf` 标签进 CHROME 表（zh 改法/信号/置信）。

## 后果

- 模型侧（D1/D2）与渲染侧（D3）同时收口：「凡用户可见的词必须自解释、按报告语言书写」。
- 不引入任何新 CLI 字段或硬校验；`--json` 契约与渲染器对旧 JSON 的兼容不受影响（`category_label`
  为加性可选字段）。
- 语体是否真正收敛依赖模型遵循 skill 声明——后续真实报告若再现黑话，优先补 bad case 示例，而不是
  升级为硬规则（用户已定的方向）。
