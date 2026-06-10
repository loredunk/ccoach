# ccoach

<p align="center"><a href="README.md">English README</a></p>

> 本机 ccoach（macOS / Linux / Windows）。只读分析你在 **Claude Code / Codex** 上的用量，
> 告诉你**花在哪、哪里浪费、怎么用得更好**，并把结果做成**可分享的成绩卡**。
> 两个平台是对称的一等公民（不是只给 Codex 用的工具），未来还会扩展到 OpenClaw、Harness 等其它 Agent CLI。设计与决策见 [`docs/`](docs/)。

## 它能做什么

- **用量报告**：只读本机 **Claude Code / Codex** 记录，输出 Token、估算成本、工具调用、按仓库 /
  时段 / 来源 / 语言 / git 习惯 / 配置扫描的统计。纯只读，不改任何东西。
- **行为信号（按回合）**：你下的每条指令是一个「回合」，全部只算派生数字——哪些回合在**原地打转**、
  你个人的**上下文保质期**（大约多少个回合后会话开始变差）、同类任务下不同 **effort 档 / 模型**的效果
  对比、哪些文件跨会话被反复改动、以及哪些**原生特性你还没用上**（依据工具自己的使用计数器，不是猜的）。
- **使用建议**（两个 skill）：教 Claude Code / Codex 解读这些数据——**ccoach-insight** 给**特性优先**
  的建议 + 报告/成绩卡（凡能用产品原生特性 CLAUDE.md/AGENTS.md、subagents、hooks、plan mode、
  permission 设置、模型/effort 档位… 解决的，就点名特性去解决；支持**会话 / 项目 / 全局**三层），
  **ccoach-deepinsight** 则是**语义根因教练**，读你的真实代码讲清**为什么**返工、以及具体怎么改。
- **可分享成绩卡**：把用量 / 习惯 / prompt 评成多轴段位（Prompt 功力、烧钱姿势、工程素养、
  勤奋度），在 HTML 报告顶部生成一张能炫能自嘲、可截图的成绩卡（中英双语，由 skill 渲染）。

> **隐私**：所有分析在你本地完成，prompt 内容不离开你的机器。

## ccoach skills

两个可复用的 skill 把原始 CLI 数据变成「给人看」的东西——一条命令一起装上：

- **[ccoach-insight](skills/ccoach-insight/SKILL.md)** —— **用量报告 + 可分享成绩卡**。从 `ccoach report --json` 读取 **Claude Code + Codex** 两平台的本机数据（token、按模型拆分、行为画像），按报告里实际出现的模型**联网查官方单价**计算权威成本，产出双平台 HTML 报告，开头是一张可截图分享的成绩卡；还能从高耗项目下钻到候选会话（`ccoach sessions`）。一眼可读、略带自嘲。
- **[ccoach-deepinsight](skills/ccoach-deepinsight/SKILL.md)** —— 面向单个项目的**语义根因教练**，认真的那种。它不止看聚合指标，而是只读地读你自己的真实代码，用大白话告诉你**为什么**这块活儿在反复返工、以及该怎么具体地改——始终落到官方原生特性上（plan mode、`@文件` 引用、hooks、`/clear`、子代理、CLAUDE.md / AGENTS.md 锚点），而且**推荐前一定先查官方文档核实现状**。它也会用上新的回合信号——上下文保质期、effort 档对比、文件改动热点、特性采用提示——并且天生诚实：该说「这是健康的工作、不用改」就直说，样本不足就标低置信、绝不硬下结论。交付的是解决办法，不是指标。

两者都**隐私优先**：全程只读、仅本机、绝不外发；只分析 **user prompt + 权限 + tool 调用**，绝不读 assistant 回复；所选会话的 prompt 只在授权后才读，隐藏的系统提示从不读取，写出的内容一律脱敏。

### 安装 skill（Claude Code + Codex）

用 [`skills`](https://github.com/vercel-labs/skills) CLI 安装（你已装 Node，无需再装别的）：

```bash
npx skills add loredunk/ccoach
```

一条命令同时装上**两个** skill（仓库自动发现 `skills/*/SKILL.md`）。它会让你**自行选择 agent（Claude Code / Codex）与范围（全局 / 项目）**。后续按名更新/卸载，例如 `npx skills update ccoach-insight ccoach-deepinsight`。

> **平台**：`ccoach` CLI 原生支持 macOS / Linux / Windows（纯 Node、零 shell 调用）。skill 的步骤是 Bash 命令序列（用到 `/tmp` 与 POSIX shell 语法），所以 **Windows 上请在 Git Bash 或 WSL 里运行你的 agent**；`.mjs` 渲染脚本本身是跨平台的。

### 怎么用

你不用敲命令——直接跟你的 agent 说话就行。装好后用自然语言问一句，agent 会挑对那个 skill：

- **用量报告 / 成绩卡** → *“看看我最近 7 天 Claude Code 和 Codex 的用量。”* · *“我这周哪些项目最烧 token？”* · *“把我今天用 AI 的情况做成一张 HTML 报告。”*
- **深度根因教练** → *“为什么我在这个项目里老是返工？”* · *“我在这个仓库里用 Claude Code 哪儿在浪费力气，该改什么？”* · *“给我一份这个项目的深度洞察。”*

想点名调用？在 **Claude Code** 里输入 `/ccoach-insight` 或 `/ccoach-deepinsight`（在 **Codex** 里是 `$ccoach-insight` / `$ccoach-deepinsight`）。单独用各有合理默认（报告 → **今天**；深度教练 → **当前项目**）；想放宽窗口就加「往回数几天」（`7`）或某个日期（`2026-06-01`）。

两者都**默认英文**——用中文问（或直接说要中文），agent 就会渲染成中文（见各自的 `SKILL.md`）。

## 安装 CLI

两个 skill 底层调用的都是 **`ccoach` CLI**——你也可以直接用它，查看 skill 所基于的原始用量报告。下面是安装与使用方式。

ccoach 是 TypeScript / Node 包（ESM，Node ≥ 18），CLI 命令为 `ccoach`，分发统一成「一切皆 npx」。

```bash
npx @loredunk/ccoach          # 免安装直接跑（发布后）
npm i -g @loredunk/ccoach     # 或全局安装
```

### 从源码运行（当前）

```bash
npm install
npm run build                 # -> dist/cli.js（bin: ccoach）
node dist/cli.js --json --days 7
# 或 `npm link`，之后 `ccoach` 即在 PATH 中
```

## 用法

裸命令即出今天的用量报告（两平台合并）：

```bash
ccoach                          # 今天，全部平台
ccoach --date 2026-05-13        # 指定某一天
ccoach --since 2026-05-01       # 从某天起到今天
ccoach --days 7                 # 最近 7 天
ccoach --platform claude-code   # claude-code | codex | all（默认 all）
ccoach --by-repo                # 按 git 仓库展开（含分支）
ccoach --scope project          # global | project | session | episode（额外给 projects[] / sessions_detail[] / episodes_detail[]）
ccoach --lang zh                # 输出语言：en | zh（默认 en）
ccoach --json                   # 输出 JSON，脚本 / agent 友好
ccoach sessions --top 20        # 会话候选清单（纯数字）；--id <id> 钻取单个会话——无需时间窗
ccoach digest --id <id>         # 显式开启：单会话限额、已脱敏的正文摘要（绝不含思考/系统提示）
```

## 说明与边界

- **只反映本机**：同账号多机登录时 rollout 按机器隔离，本工具只读本机文件、不跨机器汇总。
- **不输出配额百分比**：CLI 下 `rate_limits` 恒为 null，且配额是账号级、跨机器的。
- **行为信号只含派生值**：计数、比率与白名单标签，绝无原文。文件改动热点只在本地项目分析里出现（仅文件名、不含路径），绝不进可分享成绩卡；特性采用信号只读本机一小份固定白名单计数器，别的什么都不碰。
- **成本为估算值**，不等于实际账单。CLI 内置一张 best-effort 的**离线 fallback** 价表；**权威成本**由报告 skill 按各 token 类别 × 报告里实际出现模型的**官方联网单价**计算。Token（与离线估算成本）经 `npm run verify:ccusage` 与 `ccusage` 对账——token 严格相等、成本 1% 容差内（ccusage 仅作开发/CI 校验，绝非运行时依赖）。
- 时间窗口按本机时区的绝对日期边界划分，报告头部会标明时区。

## 致谢

感谢 [ccusage](https://github.com/ryoppippi/ccusage)（作者 [@ryoppippi](https://github.com/ryoppippi)）——ccoach 的本机用量解析方法参考了它，开发时我也用 ccusage 来交叉校准 ccoach 的 token / 成本数字。🙏
