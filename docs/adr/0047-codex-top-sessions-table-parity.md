# ADR 0047 — Codex Top Sessions table parity (skill render)

> 状态：已接受 · 日期：2026-06-06
> · 兑现 [`adr/0011`](0011-multi-platform-usage-sources.md)「Codex 与 Claude Code 对称、一等数据源」的一个具体缺口
> · 落地 [`adr/0041`](0041-codex-prompt-parity-sessions-deep-dive.md)（pending）范围内的「`~/.codex/sessions` 接进报告」一片
> · 沿用 [`adr/0042`](0042-skill-host-platform-default.md) 单平台宿主默认；隐私沿用 [`adr/0018`](0018-cli-absorbs-collection-prompt-preview.md)（sessions 列表数值only、零 prompt 原文）

## 背景

HTML 报告里 Claude 面板有「Top Sessions（按项目）」表（Project / Tokens / Model），数据来自
`ccoach sessions --platform claude-code --top N`，经 `merge_dual_platform.mjs --cc-sessions` →
`render_dual_platform.mjs` 的 Claude 面板渲染。**Codex 面板从来没有这张表**——`merge` 只有
`--cc-sessions`、`render` 的 top-sessions 表只在 Claude 面板里画 `cc.top_sessions`。

排查确认这**不是决策、也不是取舍，是未完成的对称**：

- `repos`（项目维度）本就是平台无关的公共字段（[0023](0023-platform-specific-analysis-sections.md)），
  Codex parser 从 `session_meta.cwd` 派生 repo、CLI 的 `--json`/text 两口径都给 Codex 项目。
- 用户曾观察「Codex 报告没项目」多为**默认窗口=today 命中无活动日**（[0022](0022-billing-mode-plan-split-relay-guardrail.md) D5 已澄清，`--since`/`--days` 即正常），与本表缺失是两件事。
- `ccoach sessions --platform codex --top N` 早已能出 per-session 数（repo/tokens/model/last_seen），只是没接进 HTML。

## 决策

把 Codex 接进同一张表，与 Claude 对称：

- `merge_dual_platform.mjs`：新增 `--codex-sessions` 输入 + `topCodexSessions()`（适配 Codex 会话形状：
  `tokens.total` 对象、`model` 单串、`last_seen`），归一到与 `topClaudeSessions()` 相同的
  `{project,last,tokens,models}`；`buildCodex(report, sessions, lang)` 挂 `top_sessions`。
- `render_dual_platform.mjs`：Codex 面板在模型表后渲染同款 Top Sessions 表（仅在有数据时）。
- `SKILL.md`：第 3 步泛化为「宿主平台 top sessions」，Codex 默认流加
  `ccoach sessions --platform codex --top 5` 并把 `--codex-sessions` 传给 merge。
- 隐私不变：数值only（repo basename / token / model 名），**无 `--include-user-prompts`、零 prompt 原文**。

## 影响

- Codex 报告获得与 Claude 对等的「高 token 项目/会话钻取」表，兑现 0011 对称承诺的一片。
- `--json` 契约不变；缺 `--codex-sessions` 时表为空、不崩（与 Claude 侧一致）。
- 回归测试：`merge-single-platform`（`--codex-sessions` → `top_sessions` 形状）+ `render-single-platform`
  （Codex 面板出现 Top Sessions 表）。
