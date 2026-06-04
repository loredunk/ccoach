# ADR 0031 — 成绩卡 roast 必须基于真实聚合信号：描述现象即可，不得编造数据未度量的事

> 状态：已接受 · 日期：2026-06-05（已实现：`scorecard-copy.json` `_about` + 四轴 fixture roast 重写、SKILL.md roast 指引收紧）
> · 收紧 [`adr/0029-model-authored-scorecard-roasts.md`](0029-model-authored-scorecard-roasts.md)（roast 交给模型写）的 grounding 约束
> · 延续 [`adr/0008-gamified-shareable-scorecard.md`](0008-gamified-shareable-scorecard.md)（调侃可改的习惯、不攻击人/能力）

## 背景

ADR 0029 把 roast 文案交给模型按用户语言地道地写、fixture 作样例 + 兜底。实跑发现两个问题：

1. **编造数据未度量的断言**。某次报告的「工程素养」轴写了「**plan 模式只点了 13 次、测试命令一条没跑过**」——
   而 `scorecard.mjs` 的工程素养轴**根本没有「是否跑过测试」这个信号**（只看 file/shell/search 循环比与 repo 分散度）。
   用其本机数据实测：近 30 天**跑了 31 条测试命令（vitest 29 + go test 2）**——「一条没跑过」是**事实错误**。
   根因：fixture exemplar 把「测试 / plan」当成可吐槽主题（「该测的都测了」「plan 清晰」），诱导模型为凑梗编造数据里不存在的数字。
2. **逢轴必补一句毒舌**。每条都强行加「钱包：在场，但选择装睡」「架构都在脑子里，验证全靠信仰」式的尾巴，过冲、且更易滑向编造。

## 决策

roast 的底线从「调侃习惯」升级为「调侃习惯 **+ 必须落在真实聚合数字上 + 不得断言数据未度量的事**」：

- **D1（grounding 铁律）**：每条 roast 必须描述一个**合并 JSON 里有具体数字支撑**的现象（cost / tokens / 缓存重放 /
  深夜占比 / plan 模式计数 / 活跃天数…）。**只描述现象就够**，毒舌是**可选的轻点、不是逢轴必补的尾巴**。
- **D2（禁止编造未度量项）**：ccoach 只度量工具/命令的**类别与计数、非意图**。**绝不断言**「没跑过测试 / 没做 review /
  本该用 plan 模式」——没有「测试执行 / review / plan-必要性」这类信号，编一个出来是 correctness bug，不是玩笑。
- **D3（落地）**：① `scorecard-copy.json` `_about` 写入 grounding rule，四轴 fixture roast 改为「描述现象、轻点到为止」，
  工程素养轴改用其真实信号（loop 比 / repo 分散）、移除「测试 / plan 执行」主题；② SKILL.md step 6 + 「Shareable scorecard」
  段同步收紧（去掉「one punchy line per axis」、明令不得断言未度量项）。段位名 / 评级仍确定性（ADR 0029 不变）。

## 影响

- roast 不再编造事实、不再逢轴毒舌；既保留成绩卡「可炫可自嘲」，又不踩「说错用户行为」的雷。
- 模型仍可按语言写地道梗，但梗必须挂在真实数字上、且克制。

## 开放问题

- 是否给合并 JSON 增加一个「可安全引用的聚合字段白名单」，让模型只从中取数，进一步压缩编造空间。
