# ADR 0045 — MCP / Skills usage top with source attribution

> 状态：已接受 · 日期：2026-06-06
> · 遵守 [`adr/0017`](0017-derived-non-content-signals.md) 派生非内容信号边界
> · 不破坏 [`adr/0004`](0004-skills-based-analysis.md) / [`adr/0010`](0010-cli-rewrite-node-ccusage.md) 的 `--json` 契约

## 背景

行为画像已统计工具/命令/git/语言 Top，但：MCP 工具（`mcp__server__tool`）被混进
`tools.by_name`、只在 `tools.categories.mcp` 有一个总数，看不出**用了哪些 MCP、各多少次、属于
哪个 server**；`skills[]` 只堆原始 `attributionSkill` 串（如 `superpowers:brainstorming`），
不区分 plugin 来源。用户想先在 CLI + HTML 看到 MCP/Skill 使用 Top，为将来「注册一堆 MCP 却只
用几个 → 建议清理省上下文」打底。

## 决策

从既有 JSONL 派生 **MCP 使用 Top + skill plugin 归属**，端到端（CLI `--json`/text + skill HTML）：

- **数据结构**（`tools.mcp`）：`{ total_calls, top_tools:[{name,server,tool,count}],
  top_servers:[{name,count}] }`。`top_tools` 上限 15、`top_servers` 上限 8。从 `mcp__server__tool`
  工具名按前两个 `__` 切分、末段缺失容错。
- **skill 归属**：`skills[]` 项扩展为 `{command,count,plugin?}`，`plugin` 由 `plugin:skill` 前缀
  解析（裸名无 plugin）。
- **呈现**：CLI text 新增 `MCP:`（server 维度）+ 可选工具明细，skills 行改为「短名·plugin」；
  HTML 行为面板新增「MCP Top」「Skills Top」并标来源（MCP 标 server、skill 标 plugin）。
- **隐私**：MCP server/tool 名、skill/plugin 名均为结构性**非敏感标签**（同 Bash/Edit），仅计数，
  绝不读工具入参/输出（[`adr/0017`](0017-derived-non-content-signals.md) D1）。`--json` 新增字段全部可选，向后兼容。

## 影响

- 本期 MCP/Skills Top 为 **Claude Code 侧**：`codex.ts` parser 只记工具类别、不记工具名/skill，
  故 Codex 行为块的 mcp/skills 为空、不渲染；扩展 Codex parser 记录工具名属后续。
- 「注册却几乎不用」的差集分析需读 MCP config（注册列表），本期只产出使用侧数据（`top_servers`
  + `total_calls`），差集与清理建议另起一篇 ADR。
- 不破坏 `--json` 契约（仅新增可选字段，[`adr/0004`](0004-skills-based-analysis.md) / [`adr/0010`](0010-cli-rewrite-node-ccusage.md)）。
