# ADR 0046 — `ccoach sessions` drilldown applies the same human-prompt gate

> 状态：已接受 · 日期：2026-06-06
> · 补全 [`adr/0043`](0043-prompt-episode-counting-excludes-injected-records.md)（同一决策漏改了钻取路径）
> · 不放宽 [`adr/0015`](0015-standing-local-authorization-prompt-reading.md) 隐私红线（反而收紧预览）

## 背景

ADR 0043 给主解析器（`parsers/claude-code.ts`）加了 `isHumanPrompt()` 谓词，挡掉机器注入的
`type:user` 记录（`isMeta` 系统提醒 / `<command-name>` 命令桩 / `[Request interrupted by user]`
中断哨兵），让 prompt / episode 计数回归「真人指令数」。

但 `ccoach sessions` 钻取命令（`sessions.ts`）有一条**独立的** prompt 收集逻辑，当时只挡了
sidechain + 空文本，**没跟着加这个门**。结果两条路径对同一份数据给出不同口径：实测某 ilevelup
会话主报告报 6 条 prompt，`ccoach sessions` 仍报 **1515**（252× 虚高，全部信号比例随之被压低）。
更严重的是 `--include-user-prompts` 单会话预览会把 isMeta 系统提醒等机器注入文本当成「你的 prompt」
吐出来——既错又踩 ADR 0015「只产出 redacted **HUMAN** prompts」红线。

测试缺口是 bug 能存活的原因：`test/sessions.test.ts` 只喂干净 fixture（且硬断言
`constraint_ratio===1`），`claude-noise` fixture 从没经过 `listClaudeSessions`。

## 决策

`isHumanPrompt()` + `COMMAND_STUB_RE` / `INTERRUPT_RE` 抽到 **`src/human-prompt.ts`** 作单一真相源，
主解析器与 `ccoach sessions`（Claude 计数 + 预览 push）共用同一谓词；Codex 提取处也加同一守卫
（现有 rollout 无此类注入记录、对现状是 no-op，纯防御性对称，ADR 0011）。

- 不动 token/用量聚合（`verify:ccusage` 不受影响）；仅「是否算一条 prompt / 是否进预览」。
- `--include-user-prompts` 预览随计数门一并收紧：机器注入文本不再进入 redacted preview。
- 新增回归测试：`claude-noise` 过 `listClaudeSessions` 断言只算 1 条 + 预览不含注入标签；
  并加「主报告 prompts === sessions 命令 prompts 之和」的**跨路径一致性**不变量，防止再次分叉。
- `--json` 字段结构不变，仅数值更准（不破坏契约，ADR 0004/0010）。

## 影响

- `ccoach sessions` 的 `prompts` / `avg_len` / 四项信号比例 / 单会话预览全部回归真人口径，
  与主报告一致；skill 的 Claude 会话复盘（`SKILL.md` opt-in 预览）不再被机器注入文本污染。
- 凡新增「数一条 user prompt」的代码路径，都必须 `import { isHumanPrompt } from './human-prompt.js'`。
