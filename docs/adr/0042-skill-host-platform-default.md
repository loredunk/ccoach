# ADR 0042 — ccoach-insight 默认出宿主平台报告，双平台对比转 opt-in

> 状态：已接受 · 日期：2026-06-06
> · 收敛 [`adr/0011-multi-platform-usage-sources.md`](0011-multi-platform-usage-sources.md) 的「Codex 与 Claude Code 对称、一等数据源」——对称不等于每次都并排
> · 沿用 [`adr/0025-report-skeleton-i18n-default-english.md`](0025-report-skeleton-i18n-default-english.md) 的报告骨架 i18n（默认英文、逐键回退）
> · 不放宽 [`adr/0016-error-signals-derived-tool-result-reading.md`](0016-error-signals-derived-tool-result-reading.md) / [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md) 的隐私红线

## 背景

`ccoach-insight` 的默认工作流一直**同时**生成 Claude Code + Codex 双平台报告。双平台对比曾作卖点，
但 Codex 与 Claude Code 的模型/harness 风格差异大，强行并排信息过载；多数用户只用其中一个平台，
双栏反而稀释了「当前平台」的信号。

## 决策

1. **默认出「宿主平台」单报告**：skill 被调用时，按优先级解析目标平台——
   (1) 用户显式点名平台/对比 → 照办；
   (2) 否则探测宿主：`CLAUDECODE` 环境变量在 → `claude-code`，不在 → `codex`；
   (3) 宿主无法判定 → 向用户提问（① Claude Code ② Codex ③ 双平台对比）。
2. **双平台对比转 opt-in**：仅当用户显式要求「对比 / both / dual」时，才生成两平台并渲染 head-to-head 对比。
3. **实现走「N 面板」泛化**（不新增渲染器）：`merge_dual_platform.mjs` 接受单个 `--cc-report` 或
   `--codex-report`（≥1）；`render_dual_platform.mjs` 按 `platforms{}` 在场平台渲染、单平台隐藏对比区 +
   缺席面板；`scorecard.mjs` 评宿主平台（`claude_code ?? codex`，dual 时仍取 Claude，行为不变）。
4. **品牌化标题**：报告 H1 统一为 `ccoach Insight Report` / `ccoach 洞察报告`，平台范围走副标题
   （`Claude Code` / `Codex` / `Claude Code + Codex`）。

## 隐私

探测仅读取一个布尔型环境变量（`CLAUDECODE` 是否存在），不读取任何内容，不外发。
ADR 0015/0016/0017 的全部红线不变（绝不读 assistant/thinking/system·developer prompt/文件内容；
派生信号仍只留数值/白名单标签；写入前脱敏截断）。

## 影响

- CLI 零改动（`--platform claude-code|codex|all` 已足够）。
- `apply_pricing.mjs` 已按 `Object.values(platforms)` 遍历，天然容忍单平台。
- `render_enriched_codex_report.mjs` 保留为既有 Codex-only 深度 fallback；本期不退役（要退役另起一篇）。
