# ADR 0016 — 错误/卡顿信号：对 tool_result 的「派生化」读取（隐私红线细化）

> 状态：已接受 · 日期：2026-06-03
> · **细化** [`adr/0013-self-built-unified-parser.md`](0013-self-built-unified-parser.md) D5 与
>   [`CLAUDE.md`](../../CLAUDE.md)「隐私护栏」中的「绝不读 tool_result」
> · 沿用 [`adr/0014-claude-code-prompt-review-data-surface.md`](0014-claude-code-prompt-review-data-surface.md) /
>   [`adr/0015-standing-local-authorization-prompt-reading.md`](0015-standing-local-authorization-prompt-reading.md)
>   已确立的「瞬时读取 → 只留数值/标签、绝不存原文」模式

## 背景

原红线规定**绝不读 `tool_result`**，目的是防止把命令输出、文件内容、assistant 推理吞进分析与产物。

但用户的**报错/卡顿信息**——工具失败、网络/超时、权限、命令中断、API/限流错误——恰恰落在
`message.content[].tool_result`（`is_error` + 文本）、`toolUseResult`（`interrupted`/`stderr`）、
顶层 `isApiErrorMessage` 里。实测一台机器的 `~/.claude`（4.8 万条记录）：~1.4% 工具失败率、按工具
（Bash/Write/Edit）与按 exit code/类型可清晰归类、2 千余次 `interrupted`。这是反映「工作环境、卡在哪、
卡多久」的高价值信号；**完全不读 = 丢掉一大块分析价值**。用户明确希望把这类错误纳入分析。

把「绝不把命令输出/文件内容吞进来」误用成「连错误信号都不许派生」，是边界划得过宽。

## 决策

### D1 — 对 tool_result 开「派生化读取」口子
只读并派生**数值与白名单标签**：`is_error` 布尔、`tool_use_id → 工具名`、`toolUseResult.interrupted`
布尔、`isApiErrorMessage` 布尔；错误文本仅做**瞬时**白名单分类（`classifyError` → 固定 8 类：
`git / test / build / permission / network / timeout / not-read / other`），产出「计数 + 工具名 + 类别标签」。

### D2 — 红线**不放宽**的部分（仍绝不做）
- 绝不**存储/外发**原始 `stderr` / `stdout` / `diff` / 文件内容 / 命令全行 / 任意错误子串；
- 绝不读 assistant 文本 / `thinking` / `tool_result` 的**非错误内容**用于任何用途；
- 分类只输出固定白名单标签，匹配用的错误文本读完即弃、不落任何形态。

### D3 — 范围
只**主会话**（排除 sidechain 子代理工具）、走与用量同一套**去重**；与 `prompt_signals` 完全同构的
「瞬时读 → 只留数值/标签」模式（ADR 0014/0015 已立此模式，本 ADR 把它扩到错误信号）。

### D4 — 数据面
`ccoach --json` 新增 `error_signals`：`tool_calls / tool_errors / error_rate / interrupted / api_errors /
by_tool[] / by_category[]`；`glossary` 自描述；隐私回归测试断言输出**不含**原始错误文本 / stderr / 密钥 /
sidechain 内容（见 `test/error-signals.test.ts`、`test/privacy.test.ts`）。

### D5 — 双平台对称
Codex 侧后续以同口径从 `function_call_output` / 错误事件填充（本期 Claude Code 先行；Codex 报告该块暂为零）。

## 后果

- **收益**：拿到「卡在哪类错、多频、被中断多少次、有无 API/网络错」的环境画像，补强现在只靠 prompt 派生的
  返工信号，直接服务「为什么停滞 / 工作环境」分析。
- **代价**：`tool_result` 从「完全不读」变为「派生读」。靠**固定白名单 + 不存原文 + 隐私回归测试**守住边界；
  类别是粗粒度的（不存 exit code 明细、不存原始信息），刻意以「可用且安全」换「精确但有泄露面」。
- 后续可在同一红线下扩展：`userModified`（真实返工）、`structuredPatch` 改动量、skill 使用画像等——均走
  「派生数值/标签、不读原文」口径。
