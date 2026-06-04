# ADR 0024 — 报告「输入/输出 Token」展示口径：两平台输入侧对齐、构成桶互斥

> 状态：已接受 · 日期：2026-06-04（已实现：skill 层 `render_dual_platform.mjs` 展示口径修正 + glossary 更正 + 回归 `test/token-display.test.ts`）
> · 依赖统一结构 [`adr/0013-self-built-unified-parser.md`](0013-self-built-unified-parser.md)（双平台适配器 → 统一 `Tokens`）
> · 与 [`adr/0012-codex-cost-tokens-ccusage-method.md`](0012-codex-cost-tokens-ccusage-method.md) 的 token 口径一致（不改解析层、不破 ccusage 对账）

## 背景

用户在 HTML 报告里看到反常：Claude Code「输入 192K ≪ 输出 3.5M」，而 Codex「输入 34.5M ≫ 输出 153K」。
正常直觉是「输入 ≫ 输出，尤其计入 cache read」，故怀疑 Claude 侧「输入 Token」展示有问题（TODO T16）。

根因（已对抗式核验，确属 BUG、TODO 怀疑方向正确）：**两平台统一结构里 `tokens.input` 的口径本就不对称**，且是
**刻意编码**的，不是解析 bug——

- **Claude**：`tokens.input` 仅「非缓存新输入」（`message.usage.input_tokens`）。`cache_read`→`cached_input`、
  `cache_creation` 是**与之并列的独立互斥桶**，**不含在 `input` 里**；`input + cached_input + cache_creation + output = total`。
- **Codex**：`tokens.input` 已含缓存（`cached_input ⊆ input`，由 `src/parsers/codex.ts` 的钳制
  `if (delta.cached > delta.input) delta.cached = delta.input` 证明）；`reasoning_output ⊆ output`；`input + output = total`。

代码里早已为此不对称分流：`src/pricing.ts:disjointInputBuckets()` 仅对 `claude*` 返回 true、计价分两套；
`src/aggregate.ts` 用 per-platform `freshInput` 统一算 `cache_hit_rate`。**唯独展示层没跟上**：

- `render_dual_platform.mjs` 头对头 `compareMetric('输入 Token', cc.tokens.input, cx.tokens.input)` —— Claude 拿
  fresh（192K）、Codex 拿含缓存（34.5M），**苹果对橘子**，Claude 因排除 cache 而虚小。
- Codex「Token 构成」面板把 `input`(含 cached) 与 `缓存输入`(cached 子集)、`reasoning`(⊆output) 都当独立桶画，
  **份额 > 100%（双算）**；模型表「输入」列同样与「缓存输入」列重叠。
- `total` 两平台都含全部 token，故 `scripts/verify-ccusage.ts`（只校 `tokens.total`）始终绿——印证问题在**展示分桶**、不在解析层。

## 决策

**纯展示层修正**，不动解析层 / `models[].tokens` / 计价（`apply_pricing.mjs` 仍按模型族口径读 `models[].tokens`，
不受影响），故 ccusage 对账与成本计算零变更：

1. **头对头「输入 Token」改为「输入侧总量（含缓存读）」**，两平台口径统一：
   - Claude：`input + cache_read + cache_create`；Codex：`input`（已含缓存）。
   - 标签明确为「输入 Token（含缓存读）」/「Input Tokens (incl. cache read)」，匹配用户直觉（输入 ≫ 输出）。
2. **两平台「Token 构成」面板都用互斥桶、求和 == `total`**：
   - Claude：`缓存读取 / 输出 / 缓存写入 / 输入(非缓存)`（本就互斥，仅明确标签）。
   - Codex：`缓存输入 / 输入(非缓存=input−cached) / 输出`；`reasoning`(⊆output) 改为**脚注**而非独立桶。
   - 模型表 Codex「输入」列改显 `input − cached_input`（与「缓存输入」列互斥）。
3. **更正 `src/model.ts` glossary** 对 `tokens` 的旧表述「cached_input 是 input 的子集」——该说法对 Codex 成立、
   对 Claude 错误；改为按平台分别说明口径。
4. 展示口径助手 `inputSideTotal()` / `tokenComposition()` 在 `render_dual_platform.mjs` 导出，单测覆盖
   （`test/token-display.test.ts`）。

## 影响 / 边界

- 不改 `tokens.*` 字段语义、不改 `--json` 契约、不改计价与对账。
- CLI 文本 emitter（`src/emit/text.ts`）仍逐桶平铺显示（input/cached/output/reasoning/cache_creation/total），
  各桶可见、未误导，本 ADR 不改；如需也可后续按本口径补「输入侧总量」一行。
