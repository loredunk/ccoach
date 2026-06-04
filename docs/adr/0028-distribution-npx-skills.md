# ADR 0028 — skill 分发：主推 `npx skills add`（Vercel Labs skills CLI）

> 状态：已接受 · 日期：2026-06-04（4a 本地实测 + 4b 外部端到端均已验证：推公开仓库后 `npx skills add loredunk/ccoach` 实测装出 ccoach-insight）
> · 取代 [`adr/0003-npm-distribution.md`](0003-npm-distribution.md) 的「自建 `ccoach skills install` + `@ccoach/skills` 包」设想（D3）；沿用 [`adr/0027-rename-skill-ccoach-insight.md`](0027-rename-skill-ccoach-insight.md) 的 canonical 名 `ccoach-insight`

## 背景

要让外部用户**方便安装** `ccoach-insight` skill，目标 **Claude Code + Codex 双端**，用户已装 Node。
`package.json` 的 `files:["dist"]` 不含 skill，故 skill 不随 npm 包发布；需要一条「装了就能用」的路径。

调研发现 **`skills` CLI（Vercel Labs，npm 包 `skills`）** 正是所需：`npx skills add <owner/repo>` 从 GitHub 仓库
发现并安装 skill，支持 `-a <agents>`（含 `claude-code`、`codex`）、`-g`（user 级）、`-s <skill>`、`-y`、`update`/`remove`。

## 决策

**主推 `npx skills add`**，不自建分发 CLI（取代 ADR 0003 D3）。用户面命令保持最简、交互选 agent/scope：

```
npx skills add loredunk/ccoach
```

（非交互可加 `-a claude-code -a codex -g -y`，即下文实测所用。）

- 仓库**无需任何清单文件**：`skills` CLI 自动扫描 `skills/*/SKILL.md`，已实测能发现 `ccoach-insight`。
- 安装模型（实测）：内容落 `~/.agents/skills/ccoach-insight`（**Codex 直接读这个 universal 目录**），并 **symlink**
  到 `~/.claude/skills/ccoach-insight`（Claude Code）。一条命令双端可用。
- 触发：Claude Code `/ccoach-insight`；Codex 从其 skills 目录识别（`agents/openai.yaml` 提供 display/default_prompt）。
- `files:["dist"]` 保持不变（skill 走 GitHub，不进 npm 包）；README（中英）写明上面的一行命令。

## 已实测（4a，本地可验）

- `npx skills add . --list` → 正确发现 1 个 skill `ccoach-insight` 及其描述。
- `HOME=<tmp> npx skills add . -a claude-code -a codex -s ccoach-insight -g -y` → 安装完成；
  `~/.claude/skills/ccoach-insight/SKILL.md` 经 symlink 可达；`~/.agents/skills/ccoach-insight` 为 Codex universal 落位。

## 已验证（4b，外部端到端）

提交推送到公开 `loredunk/ccoach` 后，临时 HOME 跑
`npx skills add loredunk/ccoach -a claude-code -a codex -s ccoach-insight -g -y` **成功从远端 clone 并装出
`ccoach-insight`**（`~/.claude/skills/ccoach-insight` symlink 可达、`~/.agents/skills/ccoach-insight` Codex universal 落位）。

剩余可选项（pending，不阻塞安装）：若 `skills` 生态有 registry/索引登记以提升 `npx skills find` 可发现性，按其文档按需登记。
