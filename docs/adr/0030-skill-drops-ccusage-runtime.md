# ADR 0030 — skill 运行时不再用 ccusage：Claude per-model token 改用 ccoach 自己的 `model_tokens[]`；ccusage 降为纯 dev/CI 交叉验证

> 状态：已接受 · 日期：2026-06-05（已实现：`merge_dual_platform.mjs` `buildClaude` 改吃 `ccoach report`、`render_dual_platform.mjs` + `report-copy.json` 同步、SKILL.md/README×2 重写、回归 `test/merge-extras.test.ts`）
> · **取代/supersede** [`adr/0019-pricing-online-official-at-skill-layer.md`](0019-pricing-online-official-at-skill-layer.md) 的 **D4「Claude 显示 token 走 ccusage 逐行归属」**与 **D6 把 ccusage 当 skill 运行时数据源**的部分
> · 延续 [`adr/0013-self-built-unified-parser.md`](0013-self-built-unified-parser.md)（ccusage 仅交叉验证、非运行时依赖）/ [`adr/0011-multi-platform-usage-sources.md`](0011-multi-platform-usage-sources.md)（两平台对称）

## 背景

`ccoach-insight` skill 实跑时，普通用户（非开发者）会被要求**额外跑 ccusage**——`merge_dual_platform.mjs` 的 `buildClaude`
当时把 Claude Code 面板的 **token 总量、每日序列、top sessions、per-model 拆分全部取自 ccusage**（`ccusage claude daily --breakdown` /
`ccusage claude session`），ccoach 只供 behavior。这违背产品定位（「用户调 ccoach 查一次就够」），也让 skill 多挂一个运行时依赖。

为什么当初这么做？[ADR 0019 D4](0019-pricing-online-official-at-skill-layer.md) 记录：对账发现 ccoach 与 ccusage 的 Claude
**per-model** token 归属差约 20%（ccusage 逐行读、ccoach 去重），故让显示 token 走 ccusage。

但该 20% 是 **2026-06-03 测的**，而 ccoach 的「流式分片取最终(最大) usage」对齐修复是 **2026-06-04** 才提交的
（`src/parsers/claude-code.ts` 的 `maxUsageByKey` 预扫描，按 `message.id:requestId` 取最大 usage，正是 ccusage 的口径）。
**修复后重新实测**（宽窗口覆盖全历史）：ccoach 与 ccusage 的 Claude per-model token **总量差 0.01%、单模型最大差 0.04%**——
D4 的 20% 已过时，移除 ccusage 零精度损失。

## 决策

**skill 运行时不再调用 ccusage**，两平台数据全部来自 ccoach 自己的离线解析：

- **D1（Claude 数据全部来自 `ccoach report --platform claude-code --json`）**：`buildClaude(report, sessions, lang)` 改吃 ccoach 报告——
  token（`tokens`，与 ccusage 总量严格相等）、per-model（`model_tokens[]`，与 ccusage 差 ≤0.04%）、每日序列
  （`models_timeline` → `dailyFromTimeline`，与 Codex 同法）、behavior / prompt_signals / claude_specific / endpoint。
  与 Codex 完全对称（统一 `unifyModelTokens`，删去 ccusage-shape 的 `aggregateCcModels` / `unifyClaudeModels`）。
- **D2（top sessions 改吃 `ccoach sessions --platform claude-code --top N`）**：纯数值（repo/tokens/models），
  **无 prompt 原文、无 per-session 成本**（成本已是 per-model 联网官方价，会话级离线成本不再可靠地拿得到）。
  渲染表由「Top Sessions（按成本）」改为「按 Token」、去掉 cost 列。`--cc-sessions` 可选，缺省则该表渲染空。
- **D3（Codex 也彻底去 ccusage）**：`buildCodex(report, lang)` 去掉 `--codex-ccusage`（每日序列统一用 `models_timeline` 兜底）。
  merge 脚本内零 ccusage 运行时调用。
- **D4（ccusage 降为纯 dev/CI 交叉验证）**：仅 `scripts/verify-ccusage.ts`（`npm run verify:ccusage`，接入 CI）
  用 ccusage 对账 token/成本——**验证、不运行**。skill `allowed-tools` 去掉 `Bash(ccusage *)`；SKILL.md / 渲染产物
  （`report-copy.json` 出处说明）/ README 用户面零 ccusage 运行时措辞。

## 影响

- 用户调一次 ccoach 就够，不再被要求装/跑 ccusage。
- 两平台数据路径对称、可维护性更好（加平台只写一个适配器，无需再为 Claude 特设 ccusage 路径）。
- 代价：宽窗口（>31 天）的每日 **sparkline 形状**受 `models_timeline` 展示封顶影响（days[] 留最近 ~31 天、模型取 top 10），
  两平台一致。但 **`active_days` / `date_range` 用真实全量值不受此影响**——`active_days` 来自 CLI 新增的真实活跃天数字段
  （`src/aggregate.ts` 按 byModelDay 天并集、未封顶）、`date_range` 来自 `models_timeline` 的 `first_day` / `last_day`（亦未封顶）。
  sparkline 改画**每日 token**（而非成本，因成本已是 per-model 联网价、无每日成本）。会话级成本列移除（更诚实——成本本就是 per-model 估算）。

## 开放问题

- 若未来要恢复会话级成本展示，需在 `ccoach sessions` 输出按 per-model 分桶 + 离线 fallback 估算。
