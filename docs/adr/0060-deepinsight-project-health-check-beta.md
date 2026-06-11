# ADR 0060 — deepinsight 项目体检（Beta）：四维常识性建设评估 + 重构阈值

> 状态：已接受 · 日期：2026-06-11 · 分支：`0.1.7`
> · 与 [`adr/0058`](0058-deepinsight-plain-language-discipline.md) / [`adr/0059`](0059-deepinsight-findings-toc-fix-prominence.md) 同批
> · 诚实规则继承 deepinsight 既有 honesty rules；隐私边界沿用
>   [`adr/0054`](0054-project-file-churn-concentration.md)（文件名最多 basename、可分享产物零文件名）

## 背景

很多 vibe coding 用户不知道自己的项目缺什么常识性建设——鉴权是不是真的成形、密钥有没有硬编码、
有没有测试和验证门、代码到什么程度该重构。用户要求：以「进度」的形式可视化这些维度，让 unknowns
变成 knows；离线（agent 读项目代码）就能评估；给出「到这个程度就该重构」的阈值判断；Beta 标注；
Claude Code / Codex 对称。落点：deepinsight 的项目 pass（agent 在 Pass 1 本来就打开了 repo）。

## 决策

### D1 schema：顶层可选 `project_health`，score 缺省 = 未评估

四个固定维度 `security_data | stability_resources | verification_testing | architecture_layering`
（非标准 id 须自带报告语言 `label`，中性色渲染）。每维：`score`（0-4 整数）+ `status` + `evidence` +
`advice` + 可选 `threshold`。关键语义：**省略 `score` = 未评估**——这是诚实规则的结构化表达，渲染为
灰色虚线空条 + 「未评估」，绝不渲染成 0 分；档位词（缺失/薄弱/有缺口/良好/扎实）由渲染器从 score
派生，模型不另给 level 字段（少一个能写错的字段）。

### D2 评估纪律（honesty 继承）

- score 只能来自 Pass 1 **真实打开过的文件**；没读到就省略 score 并在 `status` 写明未评估及原因；
  绝不从项目类型臆测。
- `evidence` 必须说读了什么（标识脱敏 `<…>`、文件名最多 basename）。
- 发现硬编码密钥：报告这个发现，**密钥值绝不写进任何字段**。
- `threshold`（主用于 architecture）必须锚定该 repo 的真实数字（「~1,400 行、被 5 个模块引用」），
  不是通用教条。
- 评分量纲（每维 0-4 锚点 + 检查清单）放 `references/deepinsight-method.md`，SKILL.md 保持薄。

### D3 渲染：进度条可视化 + Beta 徽章 + 本地限定

渲染器新增 `healthSection()`（passes 之后、honesty 之前，`id='project-health'`，发现清单末行可点击
跳转）：每维 4 段进度条（≥3 绿 / 2 amber / ≤1 新增 `--c-risk` 柔和警示色 / 未评估灰虚线），advice
复用高亮 fix 块（建议即 fix，视觉语言统一），threshold 独立标记行。区块头带 dashed **Beta** 徽章
（title 注明「评估口径还在校准，先当第一印象看」）+ 副题「只基于真实读到的代码 · 本地报告，不进可
分享成绩卡」。

### D4 边界

- **本地 HTML 限定**：`project_health` 绝不进可分享成绩卡 / 任何 shareable 产物（schema、SKILL.md
  双处声明）。
- CLI 零改动——体检由 skill 层 agent 读 repo 完成，不新增 `--json` 字段；平台对称免费获得
  （单渲染器 + Pass 1 双平台同构）。
- **Beta 状态**：量纲锚点未经真实项目批量校准，分数定位是「第一印象」而非评级；校准后再去 Beta
  （TODO 跟踪）。

## 后果

- vibe coder 在同一份 deepinsight 报告里同时看到「怎么用 agent」与「项目缺什么」，且每条都接着一个
  可执行 advice。
- 评估质量依赖 agent 的快速探针（grep 凭据模式、看 manifest/CI、读热点文件），覆盖面受 Pass 1 预算
  限制——这正是「未评估」语义存在的原因，宁可空也不编。
- 回归基线：`test/fixtures/deepinsight/report-health.json` + vitest 断言（Beta 徽章、点亮段数、
  未评估渲染、threshold、注入转义、缺省省略）。
