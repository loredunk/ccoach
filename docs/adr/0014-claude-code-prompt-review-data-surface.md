# ADR 0014 — Claude Code 会话级 prompt 评级数据面（skill 侧，opt-in）

> 状态：已接受 · 日期：2026-06-02
> · 相关：[`adr/0005-tiered-analysis-and-signals.md`](0005-tiered-analysis-and-signals.md)（分层信号）、
>   [`adr/0013-self-built-unified-parser.md`](0013-self-built-unified-parser.md)（统一解析层，prompt 评级的最终归宿）、
>   [`TODO.md`](../TODO.md) T9、[`PRD.md`](../PRD.md)

## 背景

prompt 质量此前只有**全局数值聚合**（`collect_claude_behavior.py` 的 `prompt_signals`：长度 / 结构化 / 文件引用 /
约束 / 纠错率），驱动成绩卡的「Prompt 功力」轴。它能给一个总体评级，但**说不出"哪条 prompt 写得差、怎么改"**——
也就是 CLAUDE.md 里列为差异化价值的「prompt 评级 / 改写建议」内容层。

Codex 侧已有 `session_drilldown.py --include-user-prompts` 走会话级、opt-in 的 prompt 审查；Claude Code 侧缺这条
对称通路。该能力的**最终归宿**是 ADR 0013 的统一解析层（T9，规划中），但在 Node/TS 迁移落地前，先在 skill 侧补一个
对称实现，让两平台现在就能做内容层评级。

另外发现一个口径 bug：`file_ref_ratio` 旧正则只认 `@`-mention，而许多用户从不打 `@`、直接贴裸路径
（`src/main.go`）或文件名（`README.md`），导致文件引用率被系统性低估、Prompt 评级偏低。

## 决策

### D1 — 新增 `claude_session_prompts.py`，对称 Codex 的 `session_drilldown.py`

skill 侧新脚本，纯 stdlib、离线。默认列候选会话（token / 工具调用 / 时长 / 模型 / 逐会话 `prompt_signals`，**零 prompt 原文**）；
仅当显式 `--session-id X --include-user-prompts` 时，输出**单个**会话的 prompt（逐条 `signals` + 脱敏 `preview`），供 skill
写入 insights 的 `session_reviews`。这是 ADR 0013 D5 在 skill 侧的提前落地，统一解析层就绪后该逻辑上移到解析层。

### D2 — opt-in 隐私边界硬约束（延续 ADR 0005 / 0013 D5）

- `--include-user-prompts` 没有 `--session-id` 直接报错——**绝不批量 dump**，prompt 审查恒为单会话、需用户点选。
- 即便 opt-in，`preview` 仍经脱敏（密钥 / home 目录 / 邮箱 / IP / 深层绝对路径）+ 截断；skill 仍须**转述而非照搬**。
- 绝不读 assistant 回复 / thinking / tool_result / 文件内容。全局层维持零原文。

### D3 — 信号词表单一来源

`claude_session_prompts.py` **import** `collect_claude_behavior.py` 复用 `user_text` 与结构化 / 文件引用 / 约束 / 纠错的
判定词表，保证「什么算一条好 prompt」在全局聚合与会话钻取间永不漂移。

### D4 — 修正 `file_ref_ratio` 口径

`FILE_REF_RE` 从「只认 `@`」扩展为「`@引用` + 裸路径 + `文件名.后缀`」，以扩展名白名单锚定裸匹配防 prose 误命中，并收紧
`@` 模式以排除 `ccusage@latest` 这类 npm 标签。实测本机 7 天窗口 `file_ref_ratio` 由 `0.0` 修正到 `~0.066`，与真实裸路径
引用率吻合。该指标在 Prompt 评级里占 0.20 权重，修正后评级更公允。

## 后果

- 好处：两平台**对称**做内容层 prompt 评级；隐私边界与 Codex 侧一致、可审计；`file_ref` 评级不再系统性偏低。
- 代价：skill 侧暂存一份会话解析逻辑，与未来统一解析层（T9）有重叠——属过渡态，T9 落地后回收。
- 影响：SKILL.md 增「Session prompt review (Claude Code)」步骤；TODO T9 标注 prompt 评级数据面已先在 skill 侧落地。
