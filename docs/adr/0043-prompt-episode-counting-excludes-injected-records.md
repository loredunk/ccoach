# ADR 0043 — Prompt/Episode counting excludes machine-injected user records

> 状态：已接受 · 日期：2026-06-06
> · 收紧 [`adr/0032`](0032-episode-abstraction-layer.md) D2「用户 prompt = 回合边界」的口径
> · 不放宽 [`adr/0015`](0015-standing-local-authorization-prompt-reading.md) / [`adr/0016`](0016-error-signals-derived-tool-result-reading.md) / [`adr/0017`](0017-derived-non-content-signals.md) 的隐私红线

## 背景

Claude Code 把多种**非真人指令**也记成 `type:user` 字符串记录：`isMeta:true` 的系统提醒 / caveat /
命令输出注入、slash 命令桩（`<command-name>` 等）、中断哨兵 `[Request interrupted by user]`。
旧实现（`claude-code.ts`）只挡了 sidechain 子代理，未挡这些——结构扫描显示某机器上 6330 条 `type:user`
里 1810 条是 `isMeta`，全被计为「一条 prompt / 一个 episode」，导致报告出现「追问 1515 轮」这类
**误导性口径**（虚高的「回合 / 提问数」）。

## 决策

「一条用户 prompt / 一个 episode 边界」**仅指真人下达的指令**。新增 `isHumanPrompt()` 谓词，排除：
`isMeta===true`、命令桩（`COMMAND_STUB_RE`）、中断哨兵（`INTERRUPT_RE`）。这是对 ADR 0032 D2
「用户 prompt = 回合边界」的口径收紧。

- 仅瞬时用 text 做布尔匹配即弃，**不存储 / 不外发原文**（守 ADR 0015/0016/0017 红线）。
- 与派生信号解耦：中断仍由 `toolUseResult.interrupted` 计入 interrupted 信号；本过滤只影响「是否算一条
  prompt / episode」，不动 token/用量聚合（`verify:ccusage` 不受影响）。
- 双平台对称（ADR 0011）：Codex rollout 无此类机器注入 user 记录，`turn_context` 本身即真实回合边界，
  无需对称过滤（见 `codex.ts` 注释）。

## 影响

- prompts / episodes 计数回归「真人指令数」；skill 报告随之改话术（禁用「追问 N 轮」，见 SKILL.md）。
- `--json` 字段结构不变，仅数值更准（不破坏契约，ADR 0004/0010）。
