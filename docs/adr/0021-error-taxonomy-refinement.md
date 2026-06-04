# ADR 0021 — 失败类别细化：拆 `other`、识别环境外因、外因/内因分组

> 状态：提议中 · 日期：2026-06-04
> · 演进 [`adr/0016-error-signals-derived-tool-result-reading.md`](0016-error-signals-derived-tool-result-reading.md) 的错误白名单类别集
> · 沿用 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md) 的「瞬时读 → 只留白名单标签/计数、原文绝不留」红线

## 背景

CLI「错误 / 卡顿」段的「按类别」目前是 8 个白名单类别（`not-read` / `permission` / `timeout` / `network` /
`test` / `git` / `build` / `other`，见 `src/errors.ts:18-28`）。实跑一份月报时 `other(142)` 占了失败的绝大多数——
**兜底桶太大，信息量低**。

用户的诉求有两层：
1. 把**环境/外因**类（断网、磁盘满、命令缺失、被 kill 等）从 `other` 里识别出来；
2. 据此回答一个习惯问题：**「失败到底是 AI/prompt 的问题，还是机器环境的问题」**——外因占比高，说明不该怪模型。

ADR 0016/0017 已经允许「对错误文本做**瞬时**模式匹配、只产出**固定白名单标签**」，因此**新增白名单类别与纯计数分组是合规的**，
红线（绝不存储/外发原始 stderr/stdout/命令全行）不变。

## 决策

### D1 — 扩充 `classifyError` 白名单（顺序敏感、外因优先）

在 `ErrorCategory` / `ERROR_CATEGORIES` / `classifyError` 增补（匹配关键词为草案，实现时按真实样本调整）：

| 新类别 | 归类 | 匹配关键词（草案） |
|---|---|---|
| `command-not-found` | 外因 | `command not found` / `not recognized as` / `executable file not found` / `no such file or directory`（exec 语境） |
| `disk` | 外因 | `ENOSPC` / `no space left` |
| `oom` | 外因 | `ENOMEM` / `out of memory` / `JavaScript heap out of memory` |
| `signal` | 外因 | `SIGKILL` / `SIGTERM` / `killed` / `core dumped` / `aborted` |
| `syntax` | 内因 | `SyntaxError` / `unexpected token` / `parse error` |
| （可选）`type` | 内因 | `TypeError`（须排在 `build`/`tsc` 之后，避免吞并） |

排序原则不变：更具体/更外因的类别在前（如网络/超时优先于 build）。

### D2 — 外因/内因分组（习惯洞察）

- **外因/环境** external：`network` `timeout` `permission` `disk` `oom` `command-not-found` `signal`
- **内因/代码** internal：`test` `build` `syntax` `type` `git` `not-read`
- `other` 仍兜底，**不计入任一侧**。

`error_signals` 增可选 `external_count` / `internal_count`（纯计数）；`src/emit/text.ts`「错误 / 卡顿」段在「按类别」行下
补一行「外因 X% · 内因 Y%」。

### D3 — 隐私（红线不变，沿用 0016/0017）

只产出**固定白名单标签 + 纯计数**；用于匹配的错误文本**读完即弃、不落任何形态**；绝不存储/外发
原始 stderr/stdout/diff/文件内容/命令全行。新增类别只是扩大白名单，不扩大「读到的内容」。

## 后果

- `other` 占比下降，「按类别」更可读；多出的外因/内因二分让用户区分「环境问题 vs 代码问题」，喂给 skill 可给更准的建议
  （外因高 → 修环境，别改 prompt）；
- 改动集中在 `src/errors.ts`（类别 + 分组映射）、`src/aggregate.ts`（计数）、`src/model.ts`（可选字段）、`src/emit/text.ts`（渲染），
  并补隐私回归断言（不泄原文）。

## 开放问题

- OQ1 **如何在不存原文前提下发现 `other` 的高频构成**：仅本地**一次性、瞬时**采样调试（不落盘、不外发）识别高频模式，
  再把模式固化成规则；**记录方法论，不记录样本**。
- OQ2 **模糊归属**：`not-read`（Claude Code「文件未先读就改」）算内因（用法问题）；`other` 不计入外因/内因，仅在「按类别」展示。
- OQ3 **跨平台一致性**：Codex 与 Claude Code 的错误文本格式不同，关键词命中率需各自校准。
