# 设计：单平台行为画像标题修正 · scorecard 人格 title 渲染兜底 · MCP/Skills 使用 Top

> 状态：草案（待实现） · 日期：2026-06-06 · 关联：拟新增 ADR 0044（title 渲染兜底）/ 0045（MCP/Skills 使用统计）；修订 ADR 0042 遗留文案

## 背景与动机

三个独立、可并行落地的改动，统一开一个分支 `feat/single-platform-profile-mcp-skills`：

1. **单平台报告误显「两平台对称」**——ADR 0042 已把 skill 默认改为单平台，但 HTML 行为画像的 section 大标题仍写死「使用行为画像（两平台对称）」，单平台报告照显，让人 confused（用户在真实单平台报告中遇到）。
2. **scorecard 人格 title 被 fallback 覆盖**——人格称号（如「深夜烧 Opus 的劳模架构师」）本应由 skill agent 在报告期撰写（ADR 0008 D3 / 0029），但实际部署的 HTML 常显示确定性 fallback「A × B × C × D」。根因是渲染顺序/缺口：title 写回与渲染之间无强制次序、无标记、无检测。
3. **行为画像缺 MCP/Skills 使用 Top**——`tools.by_name` 把 `mcp__*` 工具和原生工具混在一起、`skills[]` 堆原始串、HTML 行为区两者都未展示。用户想先在 CLI + HTML 看到「用过哪些 MCP/Skill、各多少次、来源是谁」，为将来「注册一堆 MCP 却只用几个 → 建议清理省上下文」打底。

**北极星对齐**：三项都服务「make the harness legible」——消除误导文案（看得清）、保证人格称号真实呈现（看得清）、把 MCP/Skill 使用暴露成可调优证据（少浪费、敢 build）。

**非目标 / YAGNI**：

- 不重命名 `merge_dual_platform.mjs` / `render_dual_platform.mjs`（避免破坏 SKILL.md 调用与外部引用）；「dual」留作「单+双平台共用渲染器」的历史命名。
- 不改 CLI `--platform` 默认（保持 `all`；单平台行为由 skill 层 host 探测决定，ADR 0042 已定）。
- 需求 2 不采用「render 默认硬失败」：与 ADR 0029 的离线/测试 fixture 兜底定位冲突。
- 需求 3 本期**只统计用过的 MCP**；「注册了却几乎不用」的差集分析需读 MCP config（注册列表），属下一步，本期仅把使用侧数据备齐。
- 不引入 MCP server→plugin 的强解析（server 段本身即来源标识）；plugin 归属仅对 skill 做（`attributionSkill` 自带 `plugin:` 前缀）。

---

## 需求 1：单平台行为画像标题去「两平台对称」

### 现状 / 根因

- `skills/ccoach-insight/scripts/render_dual_platform.mjs:625` 无条件渲染 `tr('h_behavior_section')`。
- 该文案在 `skills/ccoach-insight/references/report-copy.json`：
  - `:213`（zh）`"h_behavior_section": "使用行为画像（两平台对称）"`
  - `:76`（en）`"h_behavior_section": "Usage Behavior Profile (symmetric across platforms)"`
- render 在 `:435-438` 已算出 `both`/`hasCc`/`hasCx`，但标题没用上 → 单平台也照显「两平台对称」。

### 方案（统一中性标题）

把 section 大标题统一改成中性的「**使用行为画像**」/「**Usage Behavior Profile**」，去掉「两平台对称 / symmetric across platforms」修饰。

理由：单平台时每个面板自带平台名（`behaviorPanel` 的 `beh_title`「Claude Code · 使用行为」）；双平台时本就有独立的「两平台对比」comparison 区（`h_comparison`，仅 `both` 渲染）。section 大标题再带「对称/两平台」既冗余又在单平台误导。一个 copy 值改措辞即可，零 breaking、零 render 逻辑改动。

> 备选（未采用）：双平台拼「使用行为画像 · 两平台对比」、单平台纯标题。采用统一中性是因为最简且任何平台组合都不会误导。

顺带：扫一遍其它「单平台会错显双平台」的文案/英文 `symmetric` 措辞（如 `report-copy.json` 内其它键、render 代码注释），一并去掉误导措辞。

### 涉及文件

- `skills/ccoach-insight/references/report-copy.json`：改 `h_behavior_section`（zh + en，及其它 locale 若有）。
- （可选）`render_dual_platform.mjs` 代码注释 `Symmetric behavior block` / `symmetric behavior panels` 去「symmetric」措辞（非功能）。

### 测试

- 扩展 `test/render-single-platform.test.ts`：断言单平台渲染的 HTML **不含**「两平台对称 / symmetric across platforms」。
- 断言双平台渲染仍正常（comparison 区 `h_comparison` 存在）。

---

## 需求 2：scorecard 人格 title 渲染顺序兜底（flag + 检测 + 强流程）

### 现状 / 根因链

- `skills/ccoach-insight/scripts/scorecard.mjs:190` `title: names.join(' × ')` 是**无标记** fallback；`:187-189` 仅有源码注释「Do not present this raw join」。
- `render_dual_platform.mjs:414` `esc(sc.title ?? '')` **直接渲染**，零检测；roast 同理 `:421` `esc(ax.roast)`。
- `SKILL.md:113`「Compose the persona title yourself」+ `:103`「rewrite each axes[].roast … before step 7」均为 **advisory 散文**，无强制次序、无渲染后自检 → 先渲染后改 / 漏改即把 fallback 发出去。

### 方案

**(a) scorecard.mjs ── 给 fallback 打标记**

- `build()` 返回新增 `title_is_fallback: true`（确定性 join 即兜底态）。
- 每条 `axes[].roast` 来自 fixture 时，该 axis 项加 `roast_is_fixture: true`（同类缺口一并防）。

**(b) render_dual_platform.mjs ── 检测 + 报警 + 轻标记，但仍出图**

- `scorecardHtml(sc)`：判定 title 为 fallback 当 `sc.title_is_fallback === true || /\s×\s/.test(sc.title ?? '')`（双保险：agent 即便只改 title 没清 flag，形态检测也能兜住；反之 flag 兜住）。
- 判定为 fallback 时：
  - `process.stderr.write` 一条**醒目警告**（agent 渲染完必然看到）：说明 persona title 未在渲染前写回、需撰写后重渲。
  - HTML 中留**轻量可见标记**（如 title 节点加注释 `<!-- title_is_fallback -->` 或一个不破坏版式的小提示 class），便于本地预览发现。
  - **仍照常渲染**（不阻断），保留 ADR 0029 的离线/测试/opt-out 兜底路径。
- roast 同理：`roast_is_fixture === true` 的 axis → 计入 stderr 汇总警告 + 轻标记。

**(c) SKILL.md ── 把写回提成渲染前强制步 + 渲染后自检**

- 将「把 persona title 写回 `scorecard.json.title`（并将 `title_is_fallback` 置 false）」「改写每条 `axes[].roast`（并将 `roast_is_fixture` 置 false）」从 step 6 advisory 散文，提为**渲染前（step 7 之前）的强制编号子步骤**。
- step 7 后新增**自检**：渲染若在 stderr 看到 fallback 警告，说明 title/roast 未写回，必须撰写后**重新渲染**。
- 明确次序不可颠倒：写回 → 渲染。

### 涉及文件

- `skills/ccoach-insight/scripts/scorecard.mjs`（加两个 flag）。
- `skills/ccoach-insight/scripts/render_dual_platform.mjs`（`scorecardHtml` 检测 + stderr + 轻标记）。
- `skills/ccoach-insight/SKILL.md`（step 6/7 强流程 + 自检）。

### 测试

- 新增 `test/scorecard-fallback-flag.test.ts`：`build()` 输出含 `title_is_fallback:true`、fixture roast 项含 `roast_is_fixture:true`；agent 改写场景（手动置 false + 改 title）→ flag 消失。
- 新增 render 检测用例：fallback scorecard JSON → 渲染产物含轻标记 + 触发 stderr 警告；已写回的 scorecard JSON → 无警告、无标记、正常显示人格称号。

---

## 需求 3：MCP + Skills 使用 Top（含来源归属）

### 现状

- `src/parsers/claude-code.ts:265` `applyToolName(name)` 已把 `mcp__server__tool` 全名记进 `toolByName`，但与原生工具混在同一 map（`:280` 仅另外 `applyTool('mcp')` 做类别计数）。
- `src/aggregate.ts:480` `tools.by_name` = `topCounts(byNameRec, 15)`（混合）；`:485` `tools.categories` 有 `mcp` 计数。
- `:493` `report.skills = topCounts(skillRec, 12)`，项为 `{command:"superpowers:brainstorming", count}`（原始串带 plugin 前缀）。
- `src/emit/text.ts:177` 渲染 `Skill: superpowers:brainstorming(N) …`；HTML `behaviorPanel`（`render:247-305`）**不渲染** skills/mcp。

### 解析规则（已用真实 JSONL 取样验证）

- **MCP**：`mcp__<server>__<tool>`。去 `mcp__` 前缀后按**第一个** `__` 切：server=首段、tool=其余；末段缺失（如 `mcp__plugin_imessage_imessage`）→ tool=''. 例：`mcp__playwright__browser_navigate`→(playwright, browser_navigate)；`mcp__plugin_imessage_imessage__reply`→(plugin_imessage_imessage, reply)。
- **skill**：`attributionSkill` 含 `:` → 拆 `plugin:skill`，plugin=首段；裸名（`tdd`/`ccoach-insight`/`grill-me`）→ 无 plugin。

### CLI 统一模型（`src/model.ts`）

```ts
// tools 块下新增可选 mcp 子块（与 by_name / categories 并列）
tools.mcp?: {
  total_calls: number
  top_tools:   McpToolCount[]   // { name, server, tool, count } —— name 为完整 mcp__server__tool
  top_servers: NameCount[]      // { name=server, count } —— 为"哪个 MCP 重度/可清理"打底
}
// skills 项扩展（向后兼容：command 保留完整原始串，新增可选 plugin）
skills?: SkillUsage[]           // { command, count, plugin? }
```

- Top 上限：`top_tools` 复用 15、`top_servers` 8、skills 维持 12（沿用 `aggregate.ts` 既有 cap 风格）。
- `aggregate.ts`：新增 `mcpToolCounts` / `mcpServerCounts` / `mcpTotalCalls`；在 `applyToolName` 内对 `mcp__` 前缀名解析并累加（parser 无需改）。`assemble()` 产出 `tools.mcp`；skills 解析 plugin 后产出 `SkillUsage[]`。
- glossary 补 `tools.mcp` 条目（自描述契约，ADR 0026）。

### 呈现

- **CLI text**（`emit/text.ts`）：skills 行美化为 `brainstorming·superpowers(N) tdd(N) …`（裸名不带后缀）；新增 `MCP: playwright(N) plugin_imessage_imessage(N) …`（server 维度）+ 可选 top tools 明细。新增对应 i18n key。
- **CLI json**（`emit/json.ts`）：透传 `tools.mcp` + 扩展后的 `skills`（emit/json 多为直接序列化，确认无需特殊处理）。
- **HTML**（`merge_dual_platform.mjs` 的 `claudeBehavior`/`codexBehavior` 提取 → `render` `behaviorPanel`）：behavior 新增 `mcp`/`skills` 字段；`behaviorPanel` 在现有 tools/commands 之后新增「MCP Top」「Skills Top」两块，**带来源备注**（skill→`brainstorming (superpowers)`、MCP→标 server）。新增 `beh_mcp`/`beh_skills` i18n key（report-copy.json，zh+en）。

### 隐私合规

MCP 工具名/server 名、skill 名/plugin 名均为**结构性非敏感标签**（同 `Bash`/`Edit`），符合 ADR 0017 D1（固定/非敏感标签）与 CLAUDE.md 隐私护栏；仅计数、绝不读工具入参/输出/内容。`--json` 新增字段全部可选，遵守 `--json` 契约向后兼容（ADR 0004/0010）。

### 为「建议清理未用 MCP」留接口

本期产出 `tools.mcp.top_servers` + `total_calls`，使 skill 层已能识别「重度 vs 偶用」的 server。后续一步（另起 ADR）读 MCP config 取「注册列表」，与使用侧做差集，得「注册却几乎不用」清单 → skill 给「清理省上下文」建议。本期不实现该差集。

### 涉及文件

- `src/model.ts`（`McpToolCount`/`SkillUsage` 类型 + `tools.mcp` + glossary）。
- `src/aggregate.ts`（mcp 计数 + skill plugin 解析 + assemble 产出）。
- `src/emit/text.ts`、`src/emit/json.ts`（text 区段 + json 透传）。
- `src/i18n.ts`（CLI text 的 MCP/Skills 文案键）。
- `skills/ccoach-insight/scripts/merge_dual_platform.mjs`（behavior 提取 mcp/skills）。
- `skills/ccoach-insight/scripts/render_dual_platform.mjs`（`behaviorPanel` 两个新块）。
- `skills/ccoach-insight/references/report-copy.json`（`beh_mcp`/`beh_skills`）。

### 测试

- `test/` 新增 mcp/skill 解析单测：`mcp__playwright__browser_navigate`→server/tool 正确；裸 vs `plugin:skill` 拆分正确；末段缺失容错。
- 扩展 aggregate/emit 测试：fixture 含 `mcp__*` 工具与带前缀 skill → `tools.mcp.top_servers`、`skills[].plugin`、text/json 输出正确。
- 视情况补 render 单测：behavior 含 mcp/skills → HTML 出现「MCP Top」「Skills Top」与来源备注。

---

## ADR 规划

- **ADR 0044**：scorecard 人格 title / roast 渲染兜底——fallback flag + render 检测/报警 + SKILL.md 渲染前强制写回与渲染后自检（需求 2）。
- **ADR 0045**：MCP / Skills 使用 Top 与来源归属——`tools.mcp` 数据结构、解析规则、隐私归类、为清理建议留接口（需求 3）。
- 需求 1 作为 ADR 0042 的遗留文案修订，不单独立 ADR，在 spec + commit 记录。

## 风险与回滚

- 需求 1：纯文案，风险极低；回滚=还原 copy 值。
- 需求 2：render 仅新增检测分支 + stderr，不改既有渲染主路径；离线/测试路径仍出图，风险低。
- 需求 3：`--json` 全为新增可选字段，向后兼容；mcp 解析需容错异常工具名（末段缺失/非 `mcp__` 误判）。以 vitest 覆盖边界。

## 分支与提交计划

分支 `feat/single-platform-profile-mcp-skills`，按需求拆独立提交（便于回滚与审查）：

1. `fix(report): single-platform behavior heading drops 'symmetric/两平台对称' (ADR 0042 follow-up)`
2. `feat(scorecard): title/roast fallback flags + render-order guard + SKILL.md enforce (ADR 0044)`
3. `feat(report): MCP & skills usage top with source attribution (ADR 0045)`
4. `docs(adr): add 0044/0045; update SKILL.md & docs`

每步配 vitest 回归，`tools/check_adrs.mjs` 校验 ADR 连续性，commit message 英文（CLAUDE.md 约定）。
