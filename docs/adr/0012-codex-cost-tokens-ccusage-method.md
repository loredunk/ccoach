# ADR 0012 — Codex token 消耗与成本计算对齐 ccusage

> 状态：已接受（已实现） · 日期：2026-06-02
> · 相关：[`PRD.md`](../PRD.md) §2、[`adr/0010-cli-rewrite-node-ccusage.md`](0010-cli-rewrite-node-ccusage.md)
> · 代码：`internal/codexreport/parse.go`、`internal/codexreport/pricing.go`

## 背景

ccoach 原先的 Codex 用量/成本计算有一个**会显著低估**的 bug，且定价口径与 ccusage 不一致。

**Token 消耗（bug）**：原实现读 `token_count` 事件的 `info.total_token_usage`（累计值），
把**第一条样本当作 baseline 丢弃**，只累加之后样本的增量（`cur - baseline`）。后果：

- 每个会话**漏掉第一轮**的 token；
- **单轮会话**（只有一条 token_count 事件）被算成 **0**，完全不计入用量与成本。

**成本（口径）**：定价表是手写「估算价」，且缺少 `codex-mini` 系列的正确映射
（如 `gpt-5.1-codex-mini` 会落到家族默认价而被高估，`codex-mini-latest` 直接无价、成本算 0）。

ccusage（`@ccusage/codex`，现已并入 ccusage 主仓的 Rust 实现）有成熟且正确的做法，应对齐。

## 决策

### D1 — Token 增量优先用 Codex 自带的 `last_token_usage`

按 ccusage 的方法读每条 `token_count` 事件：

- 优先取 `info.last_token_usage`（Codex 记录的**每轮**用量），直接累加；
- 仅当缺失时，才回退为对 `info.total_token_usage` 求增量——且**基线从 0 开始**
  （第一轮被计入，不再丢弃），逐字段 `saturating_sub`（compaction/回滚导致累计下降时按 0 处理，不产生负数）；
- `info==null`（仅刷新 rate-limit）仍跳过；重复的累计样本增量为 0、自动跳过；
- `cached_input` 钳制为不超过 `input`（它是 input 的子集）。

效果：会话总量等于最终累计总量，**单轮会话也被正确计入**。

### D2 — 成本公式与定价对齐 ccusage / LiteLLM

- **公式**（本就一致，明确固化）：`非缓存输入×输入价 + 缓存输入×缓存读取价 + 输出×输出价`；
  输出**已含 reasoning**（Codex 把 `reasoning_output_tokens` 计入 `output_tokens`），不再单独计费。
- **参考价**镜像 ccusage 所用的 **LiteLLM**（`model_prices_and_context_window.json`）的
  `input_cost_per_token` / `output_cost_per_token` / `cache_read_input_token_cost`，2026-06-02 同步。
- **缺缓存读取价时**，缓存输入按**输入价**计（与 ccusage 一致）。
- 修正 `codex-mini` 系列映射：`gpt-5.1-codex-mini` 用 mini 价；`codex-mini-latest` 归一到 `codex-mini` 并入表。

### D3 — 保持只读 / 离线，参考价内置

仍**不联网**取价（尊重 PRD §3.8 离线友好）：参考价以内置表形式维护、随 LiteLLM 同步。
成本始终是**估算值**，口径写进 glossary（`estimated_cost_usd` / `tokens` 字段说明已更新）。

> 注：这是对**当前 Go 实现**的修正。CLI 迁移到 Node 后（[ADR 0010](0010-cli-rewrite-node-ccusage.md)）
> 将直接复用 ccusage 的取价与计算，本 ADR 的内置表随之退役。

## 后果

- 好处：Codex token 与成本不再系统性低估；单轮会话不再被吞；定价口径与 ccusage 一致、可解释。
- 影响：历史报告数字会**变大**（补回被漏掉的首轮/单轮用量），属修正而非回归；
  受影响测试（`parse_test.go`）已更新为新口径（会话总量 = 最终累计总量）。
- 兼容：`--json` 字段结构不变，仅数值更准；glossary 文案更新。

## 待定（Open Questions）

- **OQ1**：无法识别模型时是否如 ccusage 回退到 `gpt-5`。当前仍标记为 unpriced（更透明），暂不跟随。
- **OQ2**：内置参考价的同步频率/方式（手动随 LiteLLM 更新 vs 迁移 Node 后交给 ccusage）。
