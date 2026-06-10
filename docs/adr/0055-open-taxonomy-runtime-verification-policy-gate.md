# ADR 0055 — skill 层：开放 taxonomy + 运行时求证为主体 + 政策建议门槛

> 状态：已接受 · 日期：2026-06-10 · 分支：`autoresearch`
> · 演进 [`adr/0048-deepinsight-two-pass-grounding-gate.md`](0048-deepinsight-two-pass-grounding-gate.md) 的根因分类与 honesty rules
> · 演进 [`adr/0006-feature-first-recommendations.md`](0006-feature-first-recommendations.md) 的 feature 映射机制
> · 消费 [`adr/0053-episode-effort-calibration-context-rot.md`](0053-episode-effort-calibration-context-rot.md) /
> [`adr/0054-project-file-churn-concentration.md`](0054-project-file-churn-concentration.md) 的新 CLI 信号

## 背景

skill 层有三处「把今天的认知写死成天花板」的问题：

1. **封闭枚举 taxonomy**：deepinsight 的五类根因（cognitive_gap/prompt_issue/code_structure/workflow/
   unknown_feature）是封闭枚举——证据支持一个不在列的类别时，分析者只能硬塞最近的桶。分类本应是脚手架，
   不是天花板。
2. **硬编码知识表**：`feature-mapping-deep.md` 的「根因→官方特性」表与 `insight-patterns.md` 的
   recommended wording 把"今天写的话术"固化成知识库——未来更强的分析模型在背诵今天的措辞，harness 出
   新特性的那天表就过期。SKILL.md 里"Verify against current docs before recommending"已有雏形，但它是
   对硬编码表的补丁；应当反转主从。
3. **政策建议无样本门槛**：honesty rules 有假阳性条款，但缺「样本不足时不许下政策结论」——这正是
   三臂对照实验（ADR 0048）证明的「指标自信瞎编」失败模式，新维度（effort 校准、context rot）都是
   政策类产出，不加门槛会把护城河丢掉。

## 决策

### D1 开放 taxonomy（封闭枚举 → 开放枚举）

- 已知五类保留为**脚手架**；证据支持不在列的根因时**创建新类别**（snake_case、人话可懂），finding 标
  `novel_category: true`，渲染器以字面 label + "novel" 角标呈现（不再坍缩到 other）。
- **每份报告必须至少尝试一条 taxonomy 之外的发现**；过不了证据关就诚实写一行「本期无新类别」，不硬造。
- 跨报告反复出现的新类别是晋升进已知列表的候选。

### D2 运行时求证为主体、知识表降级为 few-shot

- 主体规则（写进 SKILL.md 正文）：**给出任何特性/配置建议前，WebFetch/WebSearch 当前官方 docs/changelog**，
  确认 (1) 特性现状与描述一致、(2) 是否有**更新的原生特性更贴合此根因**。
- `feature-mapping-deep.md` / `insight-patterns.md`（含 recommended wording）降级为 few-shot 示例，
  显式标注 **illustrative, not exhaustive**——示范"signature → 官方特性"的映射形状，不当知识库背。
  harness 出新特性时 skill 自动变强，一行不用改。

### D3 政策建议门槛（honesty rules 新条款）

所有**政策类建议**（effort 默认档、模型选择、/clear 时机、「以后都 X」）必须：
1. **同 task_type 内比较**（跨类型比较无意义——debug 和 docs 的 churn 基线不同）；
2. **过最小样本门槛**——CLI 在 `effort_calibration` 行与 `context_rot` 上标了 `low_confidence`，必须 honor；
3. 样本不足时**显式标注 low_confidence、只描述不建议**，绝不硬给结论。

### D4 新维度的使用指引（消费 ADR 0053/0054）

SKILL.md Pass 1 新增三个分析维度的指引：file churn 集中度（与 git 热点交叉验证，区分"真结构热点"与
"提交前重写循环"）、effort 校准曲线（同 task_type 的 high vs medium 弹性，产出如「debug 默认 medium、
edit_ring 触发后升 high」）、context rot 曲线（「上下文保质期 ≈ N 回合」→ /clear / 新会话 / subagent 隔离）。

## 后果

- skill 的特性知识从「随发版冻结」变成「随官方文档活」；taxonomy 从天花板变成脚手架。
- 对外产物约定不变：skill 文件内不出现 ADR/内部记号（本篇只在 docs/ 侧引用）。
- `insight-patterns.md` 属 ccoach-insight，与 deepinsight 同批对齐（同一决策、两处落地）。
