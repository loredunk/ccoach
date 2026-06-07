# Design — `ccoach-deepinsight`: 语义根因的深度用法教练（Claude Code 单平台先行）

> 状态：草案（brainstorming 产出，待用户评审） · 日期：2026-06-07
> · 分支：`exp/deepinsight`
> · 证据基线：本仓库实验 `experiments/2026-06-07-*`（13 agent / ~1.09M token / 三臂对照 + 三对抗审核 + 综合）
> · 沿用 ADR：0005（三层分析）· 0006（特性优先）· 0015（本人 prompt 长期授权）· 0016/0017（派生非内容信号 + 瞬时即弃）· 0018（CLI 接管采集 + opt-in 单会话 redacted prompt 预览）· 0032/0033/0034（episode / 任务分型 / 绕圈检测）· 0038（隐私分级 L0–L3 + 两段式 extract→analyze，本设计是其首个落地者）
> · 待立新 ADR：见 §11

## 1. 愿景与定位

`ccoach-deepinsight` 是**严肃的生产力 / 行为洞察工具**，与现有 `ccoach-insight`（偏娱乐的统计成绩卡，后续可能改名）**明确分开**。

它存在的意义：让用户**更有意识地驾驭 AI harness**——知道自己的不足、知道哪能补、知道自己的风格，拿到的是**解法和结果**。

**第一性原则（不可动摇）**：CLI 的聚合指标（spiral / structured_ratio / edit_ring / 以及任何"pass 率"）**会误导、有歧义、是机器话**，只能当**配角证据**。真正的产出是**语义根因**——读用户**自己的真实代码 / 真实会话内容**得出，用**人话**说清楚到底是：

- **cognitive_gap** — 用户不懂某块领域/代码/工具；
- **prompt_issue** — 表达/沟通问题（说成"下次这样做"，绝不数落）；
- **code_structure** — 代码本身让事情变难；
- **workflow** — 流程问题；
- **unknown_feature** — 其实早有官方原生功能能解决，用户不知道。

每条根因都配一个**本周就能做的具体动作**，并**优先点名官方 Claude Code 特性**（plan mode / @file / PostToolUse hook / /clear / subagents …）。只建议官方/原生，绝不推第三方习惯类 skill。

## 2. 实验证明了什么（设计的证据基线）

在本仓库真实数据上跑的三臂对照（session×4 / project×3 / content×2）+ 三对抗审核，三个审核镜头**独立一致**：

1. **尺度：两个都要（互补，非冗余）。** project 与 session 是**不同海拔**、互不包含——project 找"改一次受益所有会话"的系统病；session 钻"单回合到底发生了什么"的行为剧情。
2. **读代码（语义）：决定性地值。** 绝大多数根因 `needed_code_reading=true`（典型 4/5）；最深、最耐用的根因纯指标拿不到。
3. **读 assistant/tool_result 正文：值，但靶向。** 收益"huge"，**核心价值是当"防幻觉验证闸"**；**tight ~7.5K token 即拿到约 9 成价值**，rich ~30K 仅显式钻取用，full ~189K/会话禁用。

**最关键的发现（验证了第一性原则）**：只看轨迹/指标的 session 臂，对会话 `73ca7047` 给出了**信心 high、还引用真实代码**的根因——"这回合跑偏到 billing/endpoint、要的活儿没做成"。经 git + prompt 核验**纯属幻觉**：该会话实际 TDD 落地了 T15+T16 并干净提交，它引用的提交是 7–11 小时前的别的会话。**纯指标会自信地编造错误根因**——这就是 deep 必须读语义、且必须 grounding 的硬证据。

## 3. 架构：两遍流（project-first → session-on-demand）

### Pass 1 · PROJECT（默认、便宜、不读正文）

跨所有会话聚合，定位**系统性、改一次受益全局**的根因，产出 ship-once 修复。

- 输入：`ccoach report --scope project/episode --json`（既有）+ 读 `CLAUDE.md` / `package.json` / `.claude/`（或其缺失）/ git churn 指向的热点文件。**不读正文。**
- 典型产出（实验对 ccoach 的真实发现）："新建 `.claude/settings.json` 加 PostToolUse hook 跑 typecheck+test"；"给 CLAUDE.md 加 Commands block + 一行一文件的模块地图"。
- 这是**最高杠杆、最低风险**的海拔，**默认就跑**。

### Pass 2 · SESSION（spiral 命中 / 用户钻取时）

钻最深的单个坑，出**单回合行为**根因。**带两道闸**：

- **Grounding gate（不可违反）**：任何"这回合在干嘛 / 活儿成没成 / 是否跑偏"的判断，**只锚定该会话自己的 prompt + 落在其 `[first,last]` 时间窗内的提交**；**绝不跨窗口时间关联附近提交**（73ca7047 幻觉就是这么来的）。会话窗口取自 `ccoach sessions` 既有的 `first`/`last`；窗内提交由 skill 侧 `git log --since/--until` 取。
- **Content verification gate**：当根因取决于"意图"且要出 `confidence>=high` 时，**先花一笔 tight 正文摘要验证**再下结论。

### 两遍去重规则

两臂得出同一结论（如 plan mode / @file）时，**在 project 尺度只说一次**当作耐用习惯，session 尺度只作为实例引用——**不要每个会话重复唠叨**。session 尺度只保留 project 产不出的发现（假命题、贴了又弃的 skill、某会话特有的发现性打转）。

## 4. 输出模型

- 每条根因：`{ title, category(5类), why_human, fix, native_feature, evidence(trace/code/content), confidence, needed_code_reading, needed_content }`。
- **人话根因 + 本周可做动作 + 官方特性** 打头；**指标降级**为佐证，绝不进 `why_human` 正文当主语（审核指出"机器话泄进 why_human"是头号风格风险）。
- **假阳性诚实**：敢说"这是健康工作、无需改"（如某会话 22 prompts/9 工具其实是子代理委派 + 前期规划，不是打转）。一个文件高编辑次数 + 长无编辑段 + 有验证流 + 测试绿 = 健康重构，不是 spiral。
- **自省 dogfooding**：当某信号其实是**本工具自身的仪表局限**（如 `task_mix` 76.5% unknown 是 `task-type.ts` 阈值未校准），明确标注，别当成用户行为。
- **产出脱敏**：对外/落盘把路径/标识符换占位符 `<…>`（实验已验证方案可行），零 prompt 原文、零 assistant/思维正文。

## 5. "pass 率"放在哪（降级为配角）

- pass 率/绕圈率等**只作为 Pass 1 的一行佐证数字**，从既有 `episode_summary`（`spiral_episodes` / `autonomy_rate` 等）派生，**不做新的跨回合按文件 churn 采集**（v1 YAGNI——语义根因才是产品，跨回合 churn 信号留到确有需要再立项）。
- 绝不把任何率值当标题或结论。

## 6. CLI 加性（边界 A）+ 隐私/授权

skill 为主；CLI 只加**两个确定性数据出口** + **一个 bug 修复**：

### 6.1 新增 `ccoach digest`（token 受控的 redacted 正文摘要）——需新 ADR

- 用途：Pass 2 的"防幻觉验证闸"。把实验里的 `/tmp/extract-digest.mjs` 产品化。
- 形态：`ccoach digest --platform claude-code --id <id> [--budget tight|rich] [--per-item <n>] [--max-total <n>]` → 按时间序输出 **assistant 文本回复 + 工具输入 + tool_result 正文**，**逐项截断 + 总量封顶**，复用 `redact()` 脱敏。**不含 thinking。**
- 预算默认：`tight` = 200 字/项、30KB 封顶（~7.5K token）；`rich` = 600 字/项、120KB 封顶（~30K token）。**无 full 档**。
- 隐私：**opt-in（命令本身即显式）**、纯本地、**原始正文瞬时派生即弃**（只落截断+脱敏后的摘要）、绝不进默认报告/成绩卡路径、绝不外发。这是 ADR 0018「opt-in 单会话 redacted prompt 预览」的**自然延伸**——从"只读 user prompt"扩到"opt-in 读 assistant 回复 + tool_result 正文（脱敏截断）"，**仍不读 thinking / system·developer prompt / 文件内容做内容用途**。

### 6.2 Grounding 数据——无需改 CLI

会话 `first`/`last` 已在 `ccoach sessions` 输出；窗内提交由 skill 侧 git 取。CLI 不动。

### 6.3 Bug 修复：`src/sessions.ts:164`

`--id` 收集 prompt 文本用 `sid === wantId`（精确等于），与 `--help`/列表过滤承诺的**子串匹配**不一致 → `--id <短前缀> --include-user-prompts` 能列出会话却 `prompts: []`。改为与 `:178` 一致的子串匹配。补回归测试。

## 7. 组件与数据流

```
ccoach-deepinsight/ (skill)
  SKILL.md                         # 两遍流编排 + 隐私 + feature-first
  references/
    deepinsight-method.md          # 根因分类法 + grounding gate + 假阳性诚实
    feature-mapping-deep.md        # finding(5类) → 官方特性（复用并深化 ccoach-insight 的表）
  scripts/ (.mjs, 确定性)
    grounding.mjs                  # 给定会话窗口跑 git log，取窗内提交（只读）

数据流：
  Pass1: ccoach report --scope project|episode --json + 读 src/git
         → 语义聚合 → project 根因（ship-once）
  Pass2: ccoach sessions --id <id> [--include-user-prompts]  (window+prompts)
         → grounding.mjs (窗内提交)
         → [触发时] ccoach digest --budget tight  (验证闸)
         → 读相关 src/ → session 根因（grounded）
  产出：脱敏的人话根因报告（可选复用 insight 的 HTML 渲染，v1 先 markdown）
```

## 8. 隐私护栏（红线保留 / opt-in 新增）

- **保留不放宽**：全程只读、默认不外发；绝不读 thinking / system·developer prompt / 文件内容做内容用途；成绩卡/默认报告纯聚合零原文。
- **opt-in 新增（§6.1）**：deep 模式下，经显式触发，读**用户自己当前项目的源码**（只读、绝不改）+ 经 `ccoach digest` 读 **redacted/截断的 assistant 回复 + tool_result 正文**；原始正文瞬时即弃，产出脱敏占位符，纯本地。
- **CLI 核心默认行为不变**：`digest` 是独立 opt-in 命令，默认报告路径一字不读正文。

## 9. 测试

- CLI：`ccoach digest` 的预算封顶/脱敏/不含 thinking 回归；`sessions --id` 子串 bug 回归；隐私回归（默认路径零正文、digest 输出无 thinking/未脱敏泄漏）。
- skill：grounding.mjs 的窗口边界（绝不取窗外提交）单测；脱敏占位符校验；样例根因的"指标不进 why_human 主语" lint（可选）。

## 10. 范围外 / YAGNI / 后续

- v1 **仅 Claude Code**；Codex 对称留后。
- v1 **不做**跨回合按文件 churn 的新 CLI 采集（pass 率配角即可）。
- v1 产出先 **markdown**；HTML 渲染复用 insight 的渲染器留后续。
- 反事实"能省多少"量化（ADR 0036）留后。

## 11. 待立新 ADR

1. **deep-insight 两遍流 + grounding gate + 内容验证闸**（尺度互补、grounding 不跨窗、指标降级、假阳性诚实）。
2. **`ccoach digest`：opt-in redacted 正文摘要**（assistant 回复 + tool_result，token 受控、瞬时即弃、不含 thinking）——作为 ADR 0018 的延伸 + ADR 0038 隐私分级的首个落地。

## 附录 · 实验产物

- `experiments/2026-06-07-deepinsight-experiment-report.md`（综合报告）
- `experiments/2026-06-07-sample-outputs.md`（两尺度样例 + 脱敏样例）
- `experiments/2026-06-07-verdict-and-design-notes.json`（裁决 + 设计要点 + 真实发现）
- 原始 workflow 结果含脱敏正文片段，**只留本地 `/tmp`、不入仓库树**（隐私护栏）。

> 说明：`experiments/` 为本地探索产物，**不纳入 git**（可能含 redacted 正文/prompt 转述）；仅本设计文档入库。
