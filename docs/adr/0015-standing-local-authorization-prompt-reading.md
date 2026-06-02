# ADR 0015 — 本机 prompt 读取改为长期授权、默认开启

> 状态：已接受 · 日期：2026-06-02
> · **修订** [`adr/0005-tiered-analysis-and-signals.md`](0005-tiered-analysis-and-signals.md) 与
>   [`adr/0013-self-built-unified-parser.md`](0013-self-built-unified-parser.md) D5 的「需用户批准才读」
> · 相关：[`adr/0014-claude-code-prompt-review-data-surface.md`](0014-claude-code-prompt-review-data-surface.md)、
>   [`PRD.md`](../PRD.md)、[`TODO.md`](../TODO.md) T9

## 背景

ADR 0005 / 0013 D5 把「读 user prompt 原文」设为**每次都需用户显式批准**（opt-in 门）。这是从「保护用户不被
意外读取/外发」的角度出发的保守默认。

但实际使用中，数据所有者本人就是发起分析的人：在**自己的机器**上、分析**自己的 prompt**、产物**只落本地**。
每生成一次报告都要先列候选会话、再点选、再批准，纯属仪式性摩擦——用户明确表示「我不要明确，报告就默认直接读」。
把「保护用户免受他人读取」误用成「拦着用户读自己的数据」，是边界划错了位置。

## 决策

### D1 — 对「用户本人的 prompt」给予长期本机授权，默认开启

报告流程**默认**读取并评级 user prompt 原文，**不再每次弹授权门**。视为数据所有者对自己本机数据的长期授权。
`claude_session_prompts.py` 的 `--include-user-prompts` 不再强制 `--session-id`：缺省时**自动选 token 最高的单个
会话**。

### D2 — 仍然单会话，绝不批量 dump

默认只读**一个**会话（top-token 或用户指定的那个）。没有「一次导出所有会话 prompt」的路径。需要看别的会话，
用户显式换 `--session-id`。这保留了 ADR 0014 D2「prompt 审查恒为单会话」的约束。

### D3 — 不可让的红线（授权也不放宽）

长期授权**只**覆盖「读用户自己的 prompt」。以下永不触碰：

- **绝不读** assistant 回复 / thinking / tool_result 内容 / system·developer prompt / 文件内容。
- **绝不外发**：产物只落本地，零上传。
- **脱敏照旧**：密钥 / home 目录 / 绝对路径 / 邮箱 / IP / 长 token 在写入前一律打码 + 截断；skill 仍须
  **转述而非照搬**原文。
- **可分享的成绩卡仍纯聚合**：零 prompt 原文（延续 ADR 0008 / 0005 的全局层规则）。

### D4 — 范围限定与可关闭

本授权针对**本机、本人**数据。若未来支持多用户 / 团队 / 跨机汇总，须重新评估、回到显式同意。用户随时可在单次
分析中声明退出（skip prompt review）。

## 后果

- 好处：报告一条命令出全量（含内容层 prompt 评级），无仪式性摩擦；符合「分析自己数据」的真实心智模型。
- 代价：「需批准才读」这条护栏从 ADR 0005 / 0013 D5 退场——但其保护意图（防意外读取/外发他人或敏感内容）
  由 D3 红线完整承接，未削弱真正重要的部分。
- 影响：CLAUDE.md 隐私护栏措辞由「需批准才读」改为「本人 prompt 长期授权、默认读，红线见 ADR 0015 D3」；
  SKILL.md 把 Claude Code 会话 prompt 评级改为默认步骤；`claude_session_prompts.py` 守卫相应放宽。
