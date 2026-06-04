# ccoach

<p align="center"><a href="README.md">English README</a></p>

> 本机 AI 用量教练（macOS / Linux）。只读分析你在 **Claude Code / Codex** 上的用量，
> 告诉你**花在哪、哪里浪费、怎么用得更好**，并把结果做成**可分享的成绩卡**。
> 两个平台是对称的一等公民（不是只给 Codex 用的工具），未来还会扩展到 OpenClaw、Harness 等其它 Agent CLI。设计与决策见 [`docs/`](docs/)。

## 它能做什么

- **用量报告**：只读本机 **Claude Code / Codex** 记录，输出 Token、估算成本、工具调用、按仓库 /
  时段 / 来源 / 语言 / git 习惯 / 配置扫描的统计。纯只读，不改任何东西。
- **使用建议**（skill）：教 Claude Code / Codex 解读这些数据，给出**特性优先**的建议——
  凡能用产品原生特性（CLAUDE.md/AGENTS.md、subagents、hooks、plan mode、permission 设置、
  模型/effort 档位…）解决的，就点名特性去解决。支持**会话 / 项目 / 全局**三层分析。
- **可分享成绩卡**：把用量 / 习惯 / prompt 评成多轴段位（Prompt 功力、烧钱姿势、工程素养、
  勤奋度），在 HTML 报告顶部生成一张能炫能自嘲、可截图的成绩卡（中英双语，由 skill 渲染）。

> **隐私**：所有分析在你本地完成，prompt 内容不离开你的机器。

## 安装

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
ccoach --scope project          # global | project | session（额外给 projects[] / sessions_detail[]）
ccoach --lang zh                # 输出语言：en | zh（默认 en）
ccoach --json                   # 输出 JSON，脚本 / agent 友好
```

## 使用建议 skill

更深入的 AI 解读与 HTML 报告，用可复用的 skill
[skills/ccoach-insight](skills/ccoach-insight/SKILL.md)：它从 `ccoach report --json` 读取
**Claude Code + Codex** 两平台的本机数据（token、按模型拆分、行为画像），并按报告里实际出现的模型**联网查官方单价**计算权威成本，产出双平台 HTML 报告与成绩卡，
并能从高耗项目下钻到候选会话（`ccoach sessions`）；只在你明确授权后才读取所选会话的 user prompt，
且绝不读取隐藏的系统提示。

### 安装 skill（Claude Code + Codex）

用 [`skills`](https://github.com/vercel-labs/skills) CLI 安装（你已装 Node，无需再装别的）：

```bash
npx skills add loredunk/ccoach
```

它会让你**自行选择 agent（Claude Code / Codex）与范围（全局 / 项目）**。后续 `npx skills update ccoach-insight` 更新、`npx skills remove ccoach-insight` 卸载。

### 怎么用

装好后，直接用自然语言说一句——比如*“看看我最近 7 天 Claude Code + Codex 的用量”*——agent 就会自动唤起 skill。也可以显式调用：

- **Claude Code** —— 斜杠命令，可选参数是「往回数几天」或某个 `YYYY-MM-DD` 日期：

  ```text
  /ccoach-insight              # 今天，两平台
  /ccoach-insight 7            # 最近 7 天
  /ccoach-insight 2026-06-01   # 指定某一天
  ```

- **Codex** —— 装进 skills 目录后，相关请求会自动触发该 skill（比如*“我这周在 Codex 上花了多少？”*）。也可显式调用：输入 `$` 提及它、再用自然语言补上时间窗口：

  ```text
  $ccoach-insight              # 今天
  $ccoach-insight 最近 7 天     # 放宽窗口
  ```

不带时间参数就是**今天**。报告**默认英文**——要中文就说一声，或给 skill 脚本传 `--lang zh`（见 [SKILL.md](skills/ccoach-insight/SKILL.md)）。

## 说明与边界

- **只反映本机**：同账号多机登录时 rollout 按机器隔离，本工具只读本机文件、不跨机器汇总。
- **不输出配额百分比**：CLI 下 `rate_limits` 恒为 null，且配额是账号级、跨机器的。
- **成本为估算值**，不等于实际账单。CLI 内置一张 best-effort 的**离线 fallback** 价表；**权威成本**由报告 skill 按各 token 类别 × 报告里实际出现模型的**官方联网单价**计算。Token（与离线估算成本）经 `npm run verify:ccusage` 与 `ccusage` 对账——token 严格相等、成本 1% 容差内（ccusage 仅作开发/CI 校验，绝非运行时依赖）。
- 时间窗口按本机时区的绝对日期边界划分，报告头部会标明时区。

## 致谢

感谢 [ccusage](https://github.com/ryoppippi/ccusage)（作者 [@ryoppippi](https://github.com/ryoppippi)）——ccoach 的本机用量解析方法参考了它，开发时我也用 ccusage 来交叉校准 ccoach 的 token / 成本数字。🙏
