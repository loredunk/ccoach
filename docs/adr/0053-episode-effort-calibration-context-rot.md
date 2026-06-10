# ADR 0053 — 回合级 effort 证据 + effort 校准曲线 + 上下文衰减曲线

> 状态：已接受 · 日期：2026-06-10 · 分支：`autoresearch`
> · 扩展 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md) /
> [`adr/0034-spiral-detection-deepest-pit-story.md`](0034-spiral-detection-deepest-pit-story.md) 的回合模型
> · 落地 [`adr/0050-codex-deepinsight-parity.md`](0050-codex-deepinsight-parity.md) 预告的「per-turn effort 作为更丰富维度」
> · 隐私口径沿用 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md)（白名单标签/布尔/纯计数）

## 背景

两个高价值分析维度一直缺数据支撑：

1. **Effort 弹性**：Codex `turn_context.effort` 本来就是 per-turn 的，但 CLI 只把它聚成 session 级分布
   （`codex_specific.effort`，`applyCodexLabel`），没法回答「同类任务里 high 相比 medium 到底降低了多少
   churn、多花了多少 reasoning token」。大多数人要么全程 high（烧钱）要么全程默认（该想的没想）。
   Claude Code 侧没有 effort 滑杆，但有对称证据：**模型梯度**（opus/sonnet/haiku）与 **prompt 显式思考指令**
   （ultrathink / think harder…）。
2. **上下文衰减（context rot）**：episode 自带会话内 `index`，但没有「回合序号 × 打转率」的曲线。
   「你个人的上下文保质期是 N 回合」是极 sticky 的指标，直接对应原生动作（/clear 时机、开新会话、把探索丢给
   subagent 隔离污染）。

另一个结构性问题：`episodes_detail` 按 severity 截断 top 200，直接在其上做弹性/曲线分析会**偏置**——
必须在全量回合上聚合。

## 决策

### D1 回合级 effort 证据字段（加性、可选）

`EpisodeDetail` 新增四个可选字段，全部白名单标签/布尔、无内容：

- `effort?: string` — Codex：该回合 `turn_context.effort` 标签（high/medium/…）。session 级分布保留不变。
- `model?: string` — 回合内 token 占比最高的模型（normalize 后）；两平台通用。Claude 侧的 effort 梯度证据。
- `thinking_directive?: boolean` — Claude：本人 prompt 命中思考强度关键词（`ultrathink|megathink|think hard(er)/deeply/intensely/longer`）。
  瞬时正则派生布尔，绝不存原文（prompt 本人长期授权，ADR 0015）。
- `compacted?: boolean` — Codex：该回合内发生过上下文压缩事件（`markCodexCompaction` 顺带标记当前回合）。

### D2 `episode_summary.effort_calibration`（全量、不偏置）

按 `(dial, value, task_type)` 分组**全部**回合（非截断的 `episodes_detail`）出聚合行：
`episodes / spiral_rate / corrected_rate / avg_duration_seconds / avg_total_tokens / avg_reasoning_tokens / low_confidence`。

- `dial='effort'`：Codex turn 档；`dial='model'`：模型梯度（两平台）；`dial='thinking'`：Claude 思考指令
  on/off——**仅限 claude 模型回合**，避免把 Codex 回合混进 off 组。
- `low_confidence = episodes < MIN_SAMPLES(5)`。**政策类结论（如「默认 medium、edit_ring 触发后升 high」）
  必须在同 task_type 内比较、且两侧均非 low_confidence**；样本不足只可描述不可建议——这条同步进 skill 的
  honesty rules（ADR 0055）。

### D3 `episode_summary.context_rot`（上下文衰减曲线）

按会话内回合序号分固定桶（0–4 / 5–9 / 10–14 / 15–19 / 20+），每桶出
`episodes / spiral_rate / corrected_rate / rot_rate / avg_error_rate`，其中
`rot_rate = spiral(severity>0) 或 corrected 的回合占比`（曲线主指标）。

- `baseline_rot_rate` = 首个足样本（≥MIN_SAMPLES）桶的 rot_rate；
- `inflection_index` = 其后首个足样本桶满足 `rot_rate ≥ max(2×baseline, baseline+0.15)` 的起始序号
  （即「上下文保质期 ≈ N 回合」的 N）；未观测到 → null；
- `low_confidence` = 足样本桶 < 2：曲线只可参考、不可下结论。
- 阈值为草案（同 ADR 0034 OQ1 的待校准口径），真实数据校准后另行调整。

### D4 契约与隐私

- 全部加性可选字段，`--json` 契约不破坏（skill 无感）；glossary 同步补字段说明（含「必须同 task_type 比较」
  「low_confidence 不可下结论」的使用约束，agent 直接可读）。
- 隐私零新增暴露：effort/approval 等标签本就输出（session 级），本决策只是把已有白名单标签挂到回合粒度；
  thinking_directive 为本人 prompt 的瞬时正则布尔；不读任何新内容。

## 后果

- deepinsight / autoresearch 可做 **effort 校准曲线**（per task_type 的 high vs medium 弹性）与
  **context rot 曲线**（「你的上下文保质期 ≈ N 回合」），产出直接映射官方原生动作
  （Codex effort 档位、Claude 模型选择/思考指令、/clear、新会话、subagent 隔离）。
- 已知限制：Claude 的 thinking token 在 usage 里不单列（`reasoning_output` 恒 0），thinking 档弹性只能
  以 spiral/时长/总 token 为因变量；Codex `reasoning_output` 完整可用。
