# 设计 — 让成绩卡与报告「看得清、说人话、称号副实」

> 状态：已确认（2026-06-06）
> 范围：五块独立工作流 A–E，由一次真实报告反思驱动（用户分析 ilevelup 报告发现的问题）。
> 北极星对齐：本切片直接服务 **Make the harness legible** —— 把「1515 轮」这种误导口径、名不副实的称号、
> 无人话解释的术语，全部修成「用户更看得清、更少被误导」。

---

## 0. 背景：一次报告反思暴露的四类问题

用户用最新 CLI + skill 分析了一份报告（ilevelup），发现：

1. **「一口气追问了 1515 轮」口径错误** —— 把机器注入的 `user` 角色记录当成了「用户的提问/回合」。
2. **「复读机」称号名不副实** —— 它的判定公式根本没测「句子重复」，却用「复读机」+「同一需求改写好几轮」
   的 roast 谎称重复（**还踩了 scorecard-copy.json 自己第 2 行的 GROUNDING RULE**：禁止断言未测量的行为）。
3. **称号机械 `A × B × C × D` 硬拼** —— `scorecard.mjs` 一行 `names.join(' × ')`，没有「人设」感。
4. **术语零解释** —— 「回合」「绕圈回合」「文件引用建议」对用户是黑话，不知好坏、不知所以然。

### 关键证据（本机结构扫描，只数标记不读正文）

- 6330 条 `type:user` 记录里 **1810 条是 `isMeta:true`**（系统提醒 / caveat / 命令输出注入）；
  `grep -rn isMeta src/` = **NO isMeta handling** —— 这些带文本的 meta 记录**全被 `applyPrompt`+`beginEpisode` 计了进去**。
- 另有 57 条 `<command-name>` 命令桩、35 条 `local-command-stdout`、25 条 `[Request interrupted]` 哨兵。
- 4119 条带 `tool_result` 的已被正确排除（`userText()` 只读 text 块）；sidechain 子代理也已排除（`claude-code.ts:161`）。

**结论**：约 29% 的「user 记录」是机器注入噪声，全进了 prompt/episode 计数。这是**有实锤的 CLI bug**，不是口味问题。
因 prompt 与 episode 在同一处计数（`claude-code.ts:166-167`），修一处同时修好两个口径。

---

## A. CLI — 过滤机器注入的非指令 `user` 记录（核心 bug 修复）

**文件**：`src/parsers/claude-code.ts`；审计对称平台 `src/parsers/codex.ts`。

新增谓词（命名示意，实现时定）：

```ts
// 仅当一条 user 记录是「真人下达的指令」时，才算一条 prompt / 开一个 episode。
// 纯结构标记 + 固定哨兵；text 仅瞬时用于哨兵匹配，绝不存储（守 ADR 0015/0016 红线）。
function isHumanPrompt(rec: any, text: string): boolean {
  if (rec?.isMeta === true) return false                 // 系统提醒/caveat/命令输出注入（最大噪声源）
  if (rec?.isSidechain === true) return false            // 子代理（已有，集中到此谓词）
  if (COMMAND_STUB_RE.test(text)) return false           // <command-name> / <local-command-stdout> 桩
  if (INTERRUPT_RE.test(text)) return false              // [Request interrupted by user]
  return text.trim().length > 0
}
```

- `claude-code.ts:158-168` 的计数入口改为：仅当 `isHumanPrompt(rec, text)` 才 `beginEpisode()` + `applyPrompt()`。
- 错误/返工/中断等**派生信号扫描照旧**（它们扫的是同一条 user 记录里的 `tool_result` / `toolUseResult`，
  与「是否算一条 prompt」是两回事，**不受本过滤影响**）。中断哨兵继续供 `markInterrupted` 用途——
  即「不计为 prompt」但「仍计为一次 interrupted 信号」，两者解耦。
- 哨兵正则 `COMMAND_STUB_RE` / `INTERRUPT_RE` 为**固定字面模式**，不参与任何内容用途，只做布尔判定。

**口径声明**：本改动收紧「什么算一条用户 prompt / 一个 episode 边界」——指令数 = 真人下达的指令条数，
不含系统注入 / 命令桩 / 中断。需在 ADR 0032（episode 边界）追加一条「排除 isMeta/命令桩/中断」的口径补注，
并用 `tools/check_adrs.mjs` 校验编号。

**测试**：`test/fixtures/` 新增覆盖每类噪声（isMeta、command 桩、interrupt、正常指令）的 JSONL；
`test/` 新增 vitest 断言「噪声不计入 prompts / episodes，正常指令计入」。同步跑 `verify:ccusage`
确认 token/成本**不受影响**（本改动只动 prompt/episode 计数，不动用量聚合）。

---

## B. Copy — 改掉「追问 N 轮」误导话术

**文件**：`skills/ccoach-insight/SKILL.md`。

「一口气追问了 1515 轮」是 skill 运行时由模型生成的散文，非固定模板。更新 guidance：

- prompt 计数一律表述为「**你下达了 N 条指令**」；**禁用「追问 N 轮 / 一口气问了 N 轮」**这类暗示「反复问同一件事」的措辞。
- 要点名烧钱会话，框架为「**这个会话累计 N 条指令、占了 X% token**」，并与 episode / 绕圈视角配套讲，
  而不是把「指令多」直接等同于「啰嗦/低效」。
- 与 E 的 glossary 联动：凡报告里出现「回合 / 绕圈」字样，必须带上人话解释（见 E）。

---

## C. Prompt 轴称号改名 —— 名实相符（**仅 Prompt 轴，其余三轴不动**）

**文件**：`skills/ccoach-insight/references/scorecard-copy.json`。

用户决定：只 Prompt 轴需要重做，spending / engineering / diligence 三轴**保持原样**。

新称号（中文 = 修仙「渡劫/瓶颈」批；英文 = AI-coding 网络梗批，**英文不绑中文直译**，但仍须诚实映射信号）：

| idx | 中文 | English | 真实信号（必须据此写 roast） |
|---|---|---|---|
| 0 | 渡劫飞升 | One-Shot | 高结构 + 带约束 + 点名文件，一次说清、几乎不返工 |
| 1 | 结丹有成 | Locked In | 方向准，偶尔补一句收尾 |
| 2 | 筑基初成 | Mid | 能说清，准头/篇幅还能再收 |
| 3 | 卡瓶颈 | Vibe Coder | 少结构少约束、想到哪问到哪、**爱边问边纠**（高 correction_rate） |
| 4 | 伪灵根 | Manifesting | 又短又没结构，细节全靠 AI 推断 |

**roast 重写铁律（修掉 GROUNDING RULE 违规）**：

- **删除任何「重复 / 改写了好几轮 / reworded the same ask」表述** —— Prompt 轴**从不测量句子相似度**，
  断言「重复」是 correctness bug。
- 每档 roast 只描述**真测得到**的东西：结构化比例 / 带约束比例 / 文件引用比例 / 纠错率 / 平均长度。
- 沿用 ADR 0029/0031：roast 是「安全默认 + 语气范例」，运行时模型按用户语言重写，但**不得断言未测量的行为**。

---

## D. 称号组合 —— 分数归代码，起名归模型

**文件**：`skills/ccoach-insight/scripts/scorecard.mjs` + `SKILL.md`。

- `scorecard.mjs`：四轴档位**仍确定性计算并输出**（`axes[]` 是证据，不可由模型篡改）。
  把 `title: names.join(' × ')`（`scorecard.mjs:188`）**降级为显式 fallback**——
  保留一个机械拼接值供非 LLM / JSON 消费者兜底，但字段语义改为「fallback / 占位」，
  并在 `_about` / 注释里写明：人设标题由模型据 `axes[]` 重写。
- `SKILL.md`：指示模型用四轴**真实档位**组合成一句**有趣的人设名**（如 渡劫飞升 × 富哥随意 × … →
  「随手烧钱的渡劫劳模」一类）。护栏：
  - 必须忠于四轴档位，**不许夸大、不许编造没有的轴**；
  - 不得引用 prompt 原文（ADR 0008）；
  - 中英分别按所在语言起名，英文可用梗但同样不许失真。

---

## E. 人话解释 / glossary —— 回合 · 绕圈回合 · 文件引用建议

**文件**：`src/i18n.ts`（+ `src/model.ts` glossary）+ `skills/ccoach-insight/SKILL.md`。

现状：`text.ts` 只印「绕圈 {sp}」「{n} 个回合」，零解释（`i18n.ts:180-183`）。补三段**人话定义**，
CLI 文本输出与 skill 报告都能复用：

1. **回合（episode）**：你下**一条指令** → agent 把这件事干完（含它中间的工具调用）= 一个回合；下一条指令开启下一个回合。
2. **绕圈回合（spiral）**：agent 在一个回合里**卡住打转**——反复改同一文件 / 连环报错 / 半天没新进展 / 耗时异常长。
   **明确标注「这是坏事」**（烧 token、烧时间、没产出）+ **怎么办**（拆任务 / 给更明确上下文 / 给它一个能自我验证的手段）。
3. **文件引用建议**：讲清**为什么有用**——直接点名 `file_path:line_number`，agent 跳到对的地方读，
   省掉满仓库 grep/搜索那一大坨 token，也少一次「改错文件」的返工。
   依据：Boris/Anthropic「上下文越满质量越差」+ 官方 `file_path:line_number` 精确引用格式（见来源）。

落点：
- CLI 侧加 glossary 字符串（en/zh，默认 en，沿 ADR 0026），让 `--json` 与文本输出都携带定义，下游无须自己编。
- SKILL.md 侧加 guidance：报告里给「文件引用」建议时**必须带上「为什么」**（省 token / 少返工），不许干巴巴一句「请引用文件」。

---

## 跨切片注意

- **隐私红线不放宽**：A 的哨兵匹配 text 仅瞬时用于布尔判定即弃；全程不存储 / 不外发 prompt 正文（ADR 0015/0016/0017）。
- **不破坏 `--json` 契约**：A 改的是计数口径（数值更准），字段结构不变；D 的 `title` 字段保留（语义降级为 fallback），
  skill 侧平滑切换（ADR 0004/0010）。
- **双平台对称**：A 必须审计 `codex.ts` 是否有对称的「机器注入 user 记录」噪声，对称处理（ADR 0011）。
- **文档同步**：A 追加 ADR 0032 口径补注；C/D 的「称号名实相符 + 起名归模型」原则可在 ADR 0029/0031 线追一条；
  `tools/check_adrs.mjs` 过编号。

## 验收标准

1. 噪声 JSONL（isMeta / 命令桩 / 中断）**不计入** prompts / episodes；正常指令计入 —— vitest 绿。
2. `verify:ccusage` 仍绿（token/成本不受影响）。
3. scorecard 输出 Prompt 轴新称号；**全仓搜不到**「复读机 / Broken Record / 重复 / reworded」残留。
4. `scorecard.mjs` 的 `title` 有注释标明为 fallback；SKILL.md 有「据 axes[] 起人设名」的 guidance + 护栏。
5. CLI `--json` 与文本输出含回合/绕圈/文件引用的 glossary；SKILL.md 要求文件引用建议必须讲「为什么」。

## 来源

- [Anthropic — Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Claude Code Docs — Best practices](https://code.claude.com/docs/en/best-practices)
- [How Boris Cherny Uses Claude Code](https://karozieminski.substack.com/p/boris-cherny-claude-code-workflow)
- [Context engineering from Claude](https://01.me/en/2025/12/context-engineering-from-claude/)
