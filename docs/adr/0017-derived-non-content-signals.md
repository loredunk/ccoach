# ADR 0017 — 派生信号的统一口径：从工具结果/元数据派生「计数与标签」，原文绝不留

> 状态：已接受 · 日期：2026-06-03
> · **细化** [`adr/0016-error-signals-derived-tool-result-reading.md`](0016-error-signals-derived-tool-result-reading.md)
>   D2 的措辞「绝不读 tool_result 的非错误内容」
> · 沿用 0014/0015/0016 的「瞬时读 → 只留数值/标签、绝不存原文」模式

## 背景

ADR 0016 为「错误信号」开了 `tool_result` 的**派生化读取**口子，但其 D2 把范围措辞成「绝不读 tool_result 的
**非错误内容**」——过严：它把「读某个字段以**派生一个纯数值/布尔/标签**」也一并禁掉了。

本期要把更多**已记录但未利用**的信号纳入分析，它们都属于「派生非内容信号」：
- **返工/改动**：`toolUseResult.userModified`（布尔）、`structuredPatch` 的 **+/- 行数**（纯计数）；
- **skill 使用**：`attributionSkill`（skill 名，非敏感标识符）；
- **环境画像**：Claude Code `version`、`permissionMode`、`attachment` 数、sidechain 子代理消息数。

这些都不是「把内容吞进来」，而是「数个数、贴个标签」。需要把口径讲清楚，避免 0016 D2 的歧义。

## 决策

### D1 — 允许从 `tool_result` / `toolUseResult` / 记录元数据**派生**以下三类
- **布尔**：`is_error`、`interrupted`、`userModified`；
- **纯数值计数**：工具失败率、编辑次数、新增/删除行数、附件数、子代理消息数等；
- **固定/非敏感标签**：错误白名单类别、skill 名、Claude Code 版本号、权限模式名。

### D2 — 仍**绝不**做
- 绝不**存储/外发**：原始 `stderr`/`stdout`/`diff` 文本、文件内容、命令全行、prompt 原文、assistant 文本、`thinking`；
- 标签只取**固定白名单**（错误类别）或**本就非敏感的标识符**（skill/版本/权限模式名本身不含用户内容）；
- 用于派生的任何文本（错误文本、diff 行）**读完即弃**，不落任何形态。

### D3 — 范围与模式
仅**主会话**（排除 sidechain 工具内部，但 sidechain 计数本身作为「子代理强度」指标保留）、走**去重**、
隐私回归测试守门——与 0014/0015/0016 一致。

### D4 — 数据面
`ccoach --json` 新增 `rework_signals` / `skills` / `environment`；`glossary` 自描述；隐私回归断言输出
**不含** diff 文本/原始输出/密钥（见 `test/error-signals.test.ts`）。

## 后果

- 把「读字段派生**非内容**信号」与「读取**内容**」清楚分开，消除 0016 D2 过严措辞的歧义；
- 后续在同一红线下再加派生信号（如缓存未命中原因、时序停滞）无需逐个另起 ADR；
- 代价：可读字段面变宽，仍靠「白名单 + 不存原文 + 隐私回归测试」守住——核心红线（不外发内容）未动。
