# ADR 0049 — `ccoach digest`：opt-in、token 受控的 redacted 正文摘要

> 状态：已接受 · 日期：2026-06-07
> · 延伸 [`adr/0018-cli-absorbs-collection-prompt-preview.md`](0018-cli-absorbs-collection-prompt-preview.md)（opt-in 单会话 redacted prompt 预览）
> · 落地 [`adr/0038-privacy-levels-two-stage-extract-analyze.md`](0038-privacy-levels-two-stage-extract-analyze.md)（隐私分级 / 两段式）
> · 配套 [`adr/0048-deepinsight-two-pass-grounding-gate.md`](0048-deepinsight-two-pass-grounding-gate.md)

## 背景

deep-insight 的"防幻觉验证闸"（ADR 0048 D3）需要读会话**正文**才能证伪"纯指标编造的根因"。
实验测得：单会话完整正文约 18.9 万 token（不可控）；**逐项截断 + 总量封顶**的摘要 tight ~7.5K /
rich ~30K token 即拿到约 9 成价值。

## 决策

### D1 新增 `ccoach digest` 命令（opt-in）

按时间序产出**单个具名会话**的 **assistant 文本回复 + 工具输入 + tool_result 正文**摘要，
**逐项截断 + 总量封顶**、复用 `redact()` 脱敏。**绝不含 thinking / system·developer prompt /
文件内容做内容用途**。命令本身即显式 opt-in，且**必须 `--id` 指定单会话**（不自动全量）。

### D2 token 预算

`--budget tight`（200 字/项、30KB 封顶，~7.5K token，默认）/ `rich`（600 字/项、120KB，~30K token）；
`--per-item` / `--max-total` 可覆盖。**无 full 档**。

### D3 隐私

原始正文**瞬时派生即弃**（只落截断+脱敏后的摘要）、纯本地、绝不外发；**绝不进默认报告/成绩卡路径**；
仅 Claude Code（v1）。沿用 ADR 0016/0017 的"派生即弃"与 0018 的"opt-in 单会话 redacted 预览"边界，
仅把"可读对象"从 user prompt 扩到 assistant 回复 + tool_result（仍不碰 thinking/系统 prompt/文件内容）。

## 后果

- CLI 出现首个"读 assistant/tool_result 正文"的能力，但严格 opt-in + 受控 + 脱敏 + 即弃，红线其余不变。
- 复用既有 `redact()`，无新脱敏面。

## 开放问题

- OQ1 Codex 对称（读 rollout 正文）留后。
- OQ2 预算阈值随真实数据微调。
