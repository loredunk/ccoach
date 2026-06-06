# Single-Platform Profile · Scorecard Title Guard · MCP/Skills Usage Top Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent, TDD'd changes on branch `feat/single-platform-profile-mcp-skills`: (1) stop single-platform HTML reports showing a「两平台对称/symmetric」behavior heading; (2) guard the scorecard persona title/roast against being rendered as the deterministic fallback; (3) add MCP & Skills usage Top lists (with source attribution) to CLI `--json`/text and the HTML report.

**Architecture:** CLI core is TypeScript under `src/` (parser → `Aggregator` → `Report` → `emit/{text,json}`). The `skills/ccoach-insight/` layer is plain `.mjs` (`merge_dual_platform.mjs` → `scorecard.mjs` / `render_dual_platform.mjs`) consuming the CLI `--json`. Tests are vitest under `test/`. We add MCP aggregation in the Aggregator, attribution parsing for skills, fallback flags in the scorecard, and a render-order guard + HTML/copy wiring.

**Tech Stack:** TypeScript (CLI), Node ESM `.mjs` (skill scripts), vitest, `cac` CLI, hand-localized JSON copy tables (`references/*.json`).

**Scope note (honest boundary):** `src/parsers/codex.ts` records only tool *categories* (`applyTool('shell'|'web'|'other')`), never tool names or skills. Therefore MCP/Skills Top is **Claude-Code-driven** this iteration; the Codex behavior block carries empty mcp/skills and renders nothing. Extending the Codex parser to record tool names is out of scope (note it in ADR 0045).

---

## Task 1: Single-platform behavior heading drops「两平台对称/symmetric」(REQ1)

**Files:**
- Modify: `skills/ccoach-insight/references/report-copy.json` (en `h_behavior_section` ~line 76, zh ~line 213; en `prov_tokens_li` ~line 115, zh ~line 252)
- Modify: `skills/ccoach-insight/scripts/render_dual_platform.mjs:624` (code comment only)
- Test: `test/render-single-platform.test.ts`

- [ ] **Step 1: Add failing assertions to the existing single-platform tests**

In `test/render-single-platform.test.ts`, the `'Claude-only → …'` test currently asserts panels/comparison. Add heading assertions to it (insert after the existing `expect(html).toContain('Platform: Claude Code')` line):

```ts
    // REQ1: single-platform report must NOT show a dual-platform behavior heading
    expect(html).not.toContain('symmetric across platforms')
    expect(html).toContain('Usage Behavior Profile')
    const zhHtml = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { claude_code: cc }, combined: { total_cost_usd: 1.5, total_tokens: 200, total_sessions: 2 } }, 'zh')
    expect(zhHtml).not.toContain('两平台对称')
    expect(zhHtml).toContain('使用行为画像')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render-single-platform.test.ts -t 'Claude-only'`
Expected: FAIL — `expect(html).not.toContain('symmetric across platforms')` fails (current copy still has it).

- [ ] **Step 3: Reword the heading copy to be platform-count-neutral**

In `skills/ccoach-insight/references/report-copy.json`, EN block (~line 76) change:

```json
      "h_behavior_section": "Usage Behavior Profile (symmetric across platforms)",
```
to:
```json
      "h_behavior_section": "Usage Behavior Profile",
```

ZH block (~line 213) change:

```json
      "h_behavior_section": "使用行为画像（两平台对称）",
```
to:
```json
      "h_behavior_section": "使用行为画像",
```

Also neutralize the provenance note (it asserts "both …/两平台" even on a single-platform report). EN `prov_tokens_li` (~line 115) — change the trailing clause `for both Claude Code and Codex.` to `from your local Claude Code / Codex logs.`:

```json
      "prov_tokens_li": "<b>Tokens & models</b> (authoritative local facts): parsed offline by <code>ccoach report --json</code> from your local Claude Code / Codex logs.",
```

ZH `prov_tokens_li` (~line 252) — change `（Claude Code 与 Codex 两平台）。` to `（读取本机 Claude Code / Codex 日志）。`:

```json
      "prov_tokens_li": "<b>Token 与模型</b>（权威本地事实）：由 <code>ccoach report --json</code> 离线解析（读取本机 Claude Code / Codex 日志）。",
```

- [ ] **Step 4: Drop "symmetric" from the render code comment**

In `skills/ccoach-insight/scripts/render_dual_platform.mjs:624`, change the comment:

```js
  // symmetric behavior panels (tools / git / languages / repos / hours) — 按在场平台渲染（ADR 0042）
```
to:
```js
  // behavior panels (tools / git / languages / repos / hours) — 按在场平台渲染（单平台只画在场平台，ADR 0042）
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run test/render-single-platform.test.ts`
Expected: PASS (all three: Claude-only, Codex-only, dual). The dual test still passes — it never asserted on the heading text.

- [ ] **Step 6: Commit**

```bash
git add skills/ccoach-insight/references/report-copy.json skills/ccoach-insight/scripts/render_dual_platform.mjs test/render-single-platform.test.ts
git commit -m "fix(report): single-platform behavior heading drops 'symmetric/两平台对称' (ADR 0042 follow-up)

Behavior section heading was hardcoded 'Usage Behavior Profile (symmetric across platforms)' / '使用行为画像（两平台对称）' and rendered unconditionally, confusing single-platform reports. Reword to neutral 'Usage Behavior Profile' / '使用行为画像'; also neutralize the provenance note that asserted 'both/两平台'.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Scorecard emits fallback flags (REQ2, part 1)

**Files:**
- Modify: `skills/ccoach-insight/scripts/scorecard.mjs` (build() axes loop ~line 173, return object ~line 190)
- Test: `test/scorecard-fallback-flag.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/scorecard-fallback-flag.test.ts`:

```ts
// REQ2/ADR 0044: scorecard.mjs ships fallback markers so the renderer can detect that the
// persona title / roasts were not rewritten by the model before rendering.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts')
const FIX = path.join(HERE, 'fixtures', 'scorecard')
const DATA = path.join(FIX, 'merged_sample.json')

function buildCard(out: string): { title: string; title_is_fallback: boolean; axes: { roast_is_fixture: boolean }[] } {
  execFileSync('node', [path.join(SKILL, 'scorecard.mjs'), '--data', DATA, '--lang', 'en', '--output', out], { encoding: 'utf8' })
  return JSON.parse(readFileSync(out, 'utf8'))
}

describe('scorecard fallback flags (ADR 0044)', () => {
  it('raw scorecard marks title_is_fallback and every roast roast_is_fixture', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-fb-'))
    try {
      const card = buildCard(path.join(d, 'c.json'))
      expect(card.title).toContain(' × ')           // deterministic A × B × C × D join
      expect(card.title_is_fallback).toBe(true)
      expect(card.axes.length).toBe(4)
      for (const ax of card.axes) expect(ax.roast_is_fixture).toBe(true)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/scorecard-fallback-flag.test.ts`
Expected: FAIL — `card.title_is_fallback` is `undefined`, not `true`.

- [ ] **Step 3: Add the flags in scorecard.mjs build()**

In `skills/ccoach-insight/scripts/scorecard.mjs`, the axes assembly loop (~line 171-176) currently pushes:

```js
    axes.push({ key, label: ui[uiLabel], tier: name, roast, tier_index: i, tier_count: count })
```
Change it to mark the roast as fixture-sourced (every roast from `pick()` comes from the copy table = a fixture until the model rewrites it):

```js
    // roast_is_fixture: this roast came verbatim from scorecard-copy.json (the fixture/兜底);
    // the model rewrites axes[].roast before render and clears this flag (ADR 0029/0044).
    axes.push({ key, label: ui[uiLabel], tier: name, roast, roast_is_fixture: true, tier_index: i, tier_count: count })
```

In the return object (~line 187-190) currently:

```js
    // FALLBACK ONLY: deterministic `A × B × C × D` join for non-LLM / JSON consumers.
    // The shareable persona title is MODEL-WRITTEN at report time from axes[] (ADR 0008 D3);
    // see SKILL.md "compose the persona title". Do not present this raw join as the final title.
    title: names.join(' × '),
```
add the flag immediately after `title:`:

```js
    // FALLBACK ONLY: deterministic `A × B × C × D` join for non-LLM / JSON consumers.
    // The shareable persona title is MODEL-WRITTEN at report time from axes[] (ADR 0008 D3);
    // see SKILL.md "compose the persona title". Do not present this raw join as the final title.
    title: names.join(' × '),
    // title_is_fallback: the renderer warns + marks the HTML if this is still true at render time,
    // i.e. the model did not write the persona title back before rendering (ADR 0044).
    title_is_fallback: true,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/scorecard-fallback-flag.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing scorecard regression to ensure no break**

Run: `npx vitest run test/scorecard.test.ts`
Expected: PASS (it asserts axes/tier/rank invariants, unaffected by the new fields).

- [ ] **Step 6: Commit**

```bash
git add skills/ccoach-insight/scripts/scorecard.mjs test/scorecard-fallback-flag.test.ts
git commit -m "feat(scorecard): mark fallback title + fixture roasts (title_is_fallback / roast_is_fixture) (ADR 0044)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Render-order guard in scorecardHtml() (REQ2, part 2)

**Files:**
- Modify: `skills/ccoach-insight/scripts/render_dual_platform.mjs` (`scorecardHtml()` ~lines 406-429)
- Test: `test/scorecard-render-guard.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/scorecard-render-guard.test.ts`:

```ts
// REQ2/ADR 0044: the renderer must DETECT a still-fallback persona title / fixture roast,
// emit a stderr warning, and leave a visible HTML marker — but still render (offline/test 兜底, ADR 0029).
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts')
const FIX = path.join(HERE, 'fixtures', 'scorecard')
const DATA = path.join(FIX, 'merged_sample.json')
const INSIGHTS = path.join(FIX, 'insights_sample.json')
const RENDER = path.join(SKILL, 'render_dual_platform.mjs')

function buildScorecard(d: string): string {
  const out = path.join(d, 'sc.json')
  execFileSync('node', [path.join(SKILL, 'scorecard.mjs'), '--data', DATA, '--lang', 'en', '--output', out], { encoding: 'utf8' })
  return out
}
function render(d: string, scPath: string): { html: string; stderr: string } {
  const out = path.join(d, 'r.html')
  const res = spawnSync('node', [RENDER, '--data', DATA, '--insights', INSIGHTS, '--scorecard', scPath, '--lang', 'en', '--output', out], { encoding: 'utf8' })
  return { html: readFileSync(out, 'utf8'), stderr: res.stderr ?? '' }
}

describe('scorecard render-order guard (ADR 0044)', () => {
  it('fallback scorecard → HTML marker + stderr warning, still renders', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-guard-'))
    try {
      const scPath = buildScorecard(d)
      const { html, stderr } = render(d, scPath)
      expect(html).toContain("class='scorecard'")                       // still renders
      expect(html).toContain('<!-- ccoach:scorecard_title_is_fallback -->')
      expect(stderr).toContain('scorecard')                              // warned
    } finally { rmSync(d, { recursive: true, force: true }) }
  })

  it('rewritten scorecard → no marker, persona title shown, no warning', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-guard2-'))
    try {
      const scPath = buildScorecard(d)
      const card = JSON.parse(readFileSync(scPath, 'utf8'))
      card.title = '深夜烧 Opus 的劳模架构师'
      card.title_is_fallback = false
      for (const ax of card.axes) { ax.roast = 'rewritten'; ax.roast_is_fixture = false }
      writeFileSync(scPath, JSON.stringify(card))
      const { html, stderr } = render(d, scPath)
      expect(html).toContain('深夜烧 Opus 的劳模架构师')
      expect(html).not.toContain('<!-- ccoach:scorecard_title_is_fallback -->')
      expect(stderr).not.toContain('scorecard:')
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/scorecard-render-guard.test.ts`
Expected: FAIL — HTML has no `<!-- ccoach:scorecard_title_is_fallback -->` marker and stderr has no warning.

- [ ] **Step 3: Add the guard in scorecardHtml()**

In `skills/ccoach-insight/scripts/render_dual_platform.mjs`, replace the whole `scorecardHtml()` function (lines 406-429) with:

```js
// Render the shareable cover scorecard (vertical, screenshot-friendly).
// `sc` is the JSON from scripts/scorecard.mjs; fully bilingual via its own copy.
function scorecardHtml(sc) {
  if (!sc) return ''
  // Render-order guard (ADR 0044): the persona title + roasts are MODEL-WRITTEN before render
  // (SKILL.md step 6). If they are still the deterministic fallback at render time, leave a
  // visible HTML marker + warn on stderr so the omission is caught — but still render (offline/
  // test 兜底 stays valid, ADR 0029).
  const titleFallback = sc.title_is_fallback === true || /\s×\s/.test(sc.title ?? '')
  const fixtureRoasts = (sc.axes ?? []).filter((ax) => ax.roast_is_fixture === true).length
  if (titleFallback || fixtureRoasts) {
    const bits = []
    if (titleFallback) bits.push("persona title is still the fallback 'A × B × C × D'")
    if (fixtureRoasts) bits.push(`${fixtureRoasts} roast line(s) are still the fixture 兜底`)
    process.stderr.write(
      `⚠ scorecard: ${bits.join('; ')} — not written back to /tmp/scorecard.json before render. ` +
        `Compose the persona title / rewrite roasts, then re-render (ADR 0044).\n`,
    )
  }
  const parts = ["<section class='scorecard'>"]
  if (titleFallback) parts.push('<!-- ccoach:scorecard_title_is_fallback -->')
  parts.push(
    `<span class='sc-kicker'>${esc(sc.scorecard_label ?? '')} · ` + `${esc(sc.title_label ?? '')}</span>`,
  )
  parts.push(`<h2 class='sc-title'>${esc(sc.title ?? '')}</h2>`)
  if (sc.rank_label) parts.push(`<p class='sc-rank'>${esc(sc.rank_label)}</p>`)
  for (const ax of sc.axes ?? []) {
    const roastMark = ax.roast_is_fixture === true ? '<!-- ccoach:roast_is_fixture -->' : ''
    parts.push(
      "<div class='sc-axis'>" +
        roastMark +
        `<span class='sc-ax-label'>${esc(ax.label)}</span>` +
        `<span class='sc-tier'>${esc(ax.tier)}</span>` +
        `<span class='sc-roast'>${esc(ax.roast)}</span>` +
        '</div>',
    )
  }
  const note = [sc.privacy_note, sc.estimate_note].filter(Boolean).join(' · ')
  if (note) parts.push(`<p class='sc-note'>${esc(note)}</p>`)
  parts.push('</section>')
  return parts.join('')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/scorecard-render-guard.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Run the existing scorecard regression**

Run: `npx vitest run test/scorecard.test.ts`
Expected: PASS — note this test renders with the raw (fallback) scorecard, so it now also emits the stderr warning; that does not fail the test (it only asserts on HTML content / no quota / no secrets, and the marker is an HTML comment).

- [ ] **Step 6: Commit**

```bash
git add skills/ccoach-insight/scripts/render_dual_platform.mjs test/scorecard-render-guard.test.ts
git commit -m "feat(render): scorecard render-order guard — warn + mark when title/roast still fallback (ADR 0044)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: SKILL.md enforces write-back before render + ADR 0044

**Files:**
- Modify: `skills/ccoach-insight/SKILL.md` (steps 6-7, ~lines 96-118)
- Create: `docs/adr/0044-scorecard-title-render-order-guard.md`

- [ ] **Step 1: Restructure SKILL.md step 6/7 — make write-back a mandatory pre-render step + add self-check**

In `skills/ccoach-insight/SKILL.md`, the existing step 6 ends with two advisory bullets ("Also write the personality-summary sentence yourself…" and "Compose the persona title yourself…"). Replace those two bullets (the last two `-` lines of step 6, currently ~lines 112-113) with a single **mandatory, ordered** bullet:

```markdown
   - **REQUIRED before step 7 (render).** The scorecard you just generated ships fallback markers
     (`title_is_fallback: true`, each `axes[].roast_is_fixture: true`). Before rendering you MUST
     overwrite `/tmp/scorecard.json` in place:
     1. **Compose the persona title yourself (ADR 0008 D3)** — a short, witty handle from the four
       `axes[].tier` names (e.g. 渡劫飞升 + 富哥随意 + 架构师 + 劳模 → "随手烧钱的渡劫劳模"); stay
       faithful to the computed tiers, never invent an axis, never quote prompt text. Set
       `title` to it **and set `title_is_fallback` to `false`**.
     2. **Rewrite each `axes[].roast`** in the user's language per the rules above, and set that
       axis's `roast_is_fixture` to `false`.
     3. Also write the personality-summary sentence into the insights `executive_summary`.
     If you skip this, the renderer keeps the fallback `A × B × C × D` title and fixture roasts,
     emits a stderr warning, and leaves a `<!-- ccoach:scorecard_title_is_fallback -->` marker in the
     HTML (ADR 0044). Write-back happens BEFORE render — never render first and patch later.
```

Then, at the end of step 7 (after the existing last bullet "Use the user-specified output path…"), add a self-check bullet:

```markdown
   - **Self-check (ADR 0044):** after rendering, look at the command's stderr. If you see a
     `⚠ scorecard:` warning, the persona title / roasts were NOT written back before render — fix
     `/tmp/scorecard.json` (step 6 write-back) and **re-run this render command**. Do not ship the
     `ai-usage-report.html` while that warning is present.
```

- [ ] **Step 2: Create ADR 0044**

Create `docs/adr/0044-scorecard-title-render-order-guard.md`:

```markdown
# ADR 0044 — Scorecard persona title / roast render-order guard

> 状态：已接受 · 日期：2026-06-06
> · 实现 [`adr/0008`](0008-gamified-shareable-scorecard.md) D3「人格称号由模型撰写」与 [`adr/0029`](0029-model-authored-scorecard-roasts.md) 的兜底定位
> · 关联 skill 工作流 `skills/ccoach-insight/SKILL.md` step 6/7

## 背景

成绩卡的人格称号（`title`）与每轴 `roast` 约定由 skill 的 agent 在报告期按用户语言撰写
（ADR 0008 D3 / 0029）。`scorecard.mjs` 只产出**确定性兜底**：`title` 是 `A × B × C × D`
的轴名拼接、`roast` 直接取自 `references/scorecard-copy.json` 的 fixture。

实践中出现**渲染顺序 bug**：agent 先渲染 HTML、后才把人格称号写回 `/tmp/scorecard.json`，
或漏改就渲染——`render_dual_platform.mjs` 直接 `esc(sc.title)` 无任何检测，于是部署出去的
`ai-usage-report.html` 显示的是 fallback「卡瓶颈 × 富哥随意 × 架构师 × 劳模」，而非
「深夜烧 Opus 的劳模架构师」。SKILL.md 当时只用 advisory 散文要求写回，无强制次序、无自检。

## 决策

三处协同，**保证最终渲染的是模型撰写的称号/roast，同时不破坏离线/测试兜底**：

1. **标记（`scorecard.mjs`）**：兜底 `title` 旁输出 `title_is_fallback: true`；每条 fixture
   `roast` 所在轴输出 `roast_is_fixture: true`。agent 写回时一并置 `false`。
2. **检测 + 兜底（`render_dual_platform.mjs` 的 `scorecardHtml`）**：判定 fallback =
   `title_is_fallback===true || /\s×\s/.test(title)`（双保险：即便只改 title 没清 flag，形态
   也能兜住）。命中则 **stderr 醒目警告** + HTML 留 `<!-- ccoach:scorecard_title_is_fallback -->`
   可见标记，但**仍出图**（保 ADR 0029 的离线/纯测试/opt-out 兜底路径，不硬失败）。
3. **强流程（`SKILL.md`）**：把「写回 title/roast」从 advisory 提为 step 7 渲染前的**强制有序
   子步骤**，并在 step 7 后加**自检**（看到 `⚠ scorecard:` 警告即修正后重渲）。次序固定：写回 → 渲染。

## 影响

- 漏改/先渲染后改不再静默发出 fallback：stderr 警告 + HTML 标记使其可被发现。
- 不改 `--json` 契约；`scorecard.json` 仅新增两个布尔字段（向后兼容，ADR 0004/0010）。
- 不采用「render 默认硬失败」：会逼迫离线/测试每次显式放行，与 ADR 0029 兜底定位冲突。
```

- [ ] **Step 3: Validate ADR numbering**

Run: `node tools/check_adrs.mjs`
Expected: PASS (0044 is the next sequential number; no gaps/dupes).

- [ ] **Step 4: Commit**

```bash
git add skills/ccoach-insight/SKILL.md docs/adr/0044-scorecard-title-render-order-guard.md
git commit -m "docs(skill,adr): enforce scorecard title/roast write-back before render + ADR 0044

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: CLI data layer — MCP aggregation + skill plugin attribution (REQ3, part 1)

**Files:**
- Modify: `src/model.ts` (types ~line 15, `tools` ~197, `skills` ~213, glossary ~242-251)
- Modify: `src/aggregate.ts` (fields ~99-103, `applyToolName` ~271-273, assemble ~477-498)
- Test: `test/mcp-skills.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/mcp-skills.test.ts`:

```ts
// REQ3/ADR 0045: MCP usage top (per-tool + per-server) and skill plugin attribution.
import { describe, it, expect } from 'vitest'
import { Aggregator } from '../src/aggregate.js'

function build() {
  const agg = new Aggregator('claude-code')
  agg.applyTokens({ input: 100, cached_input: 0, output: 50, reasoning_output: 0, cache_creation: 0, total: 150 }, 'claude-opus-4-8', 'ccoach', 's1', new Date('2026-06-02T03:00:00Z'))
  agg.touchSession('s1')
  // MCP tool calls across two servers
  agg.applyToolName('mcp__playwright__browser_navigate')
  agg.applyToolName('mcp__playwright__browser_navigate')
  agg.applyToolName('mcp__playwright__browser_click')
  agg.applyToolName('mcp__plugin_imessage_imessage__reply')
  agg.applyToolName('mcp__plugin_imessage_imessage')          // malformed: missing tool segment
  agg.applyToolName('Bash')                                    // native tool, must NOT count as mcp
  // skills with and without plugin namespace
  agg.applySkill('superpowers:brainstorming')
  agg.applySkill('superpowers:brainstorming')
  agg.applySkill('tdd')
  return agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
}

describe('MCP & skills usage top (ADR 0045)', () => {
  it('tools.mcp ranks tools and servers, excludes native tools', () => {
    const r = build()
    expect(r.tools.mcp).toBeTruthy()
    expect(r.tools.mcp!.total_calls).toBe(5)                  // 4 well-formed + 1 malformed, Bash excluded
    const top = r.tools.mcp!.top_tools
    expect(top[0]).toEqual({ name: 'mcp__playwright__browser_navigate', server: 'playwright', tool: 'browser_navigate', count: 2 })
    const servers = r.tools.mcp!.top_servers
    expect(servers[0]).toEqual({ name: 'playwright', count: 3 })
    expect(servers.find((s) => s.name === 'plugin_imessage_imessage')!.count).toBe(2)
    // malformed name → server is the whole remainder, tool ''
    expect(top.find((t) => t.name === 'mcp__plugin_imessage_imessage')!.tool).toBe('')
  })

  it('skills carry plugin attribution (parsed from plugin:skill)', () => {
    const r = build()
    const brainstorm = r.skills!.find((s) => s.command === 'superpowers:brainstorming')!
    expect(brainstorm.count).toBe(2)
    expect(brainstorm.plugin).toBe('superpowers')
    const tdd = r.skills!.find((s) => s.command === 'tdd')!
    expect(tdd.plugin).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp-skills.test.ts`
Expected: FAIL — `r.tools.mcp` is `undefined`; `r.skills[].plugin` does not exist (and TS may error on `.mcp`/`.plugin`).

- [ ] **Step 3: Add types + glossary in model.ts**

In `src/model.ts` after the `NameCount` interface (line 16) add:

```ts
export interface McpToolCount { name: string; server: string; tool: string; count: number }
export interface SkillUsage { command: string; count: number; plugin?: string }
```

Change the `tools` object type (lines 197-202) to add the optional `mcp` sub-block — insert after the `categories?` line:

```ts
  tools: {
    shell_calls: number; web_searches: number; file_changes: number; total_calls: number
    top_commands: CommandCount[]
    by_name?: NameCount[]              // 各工具被调用次数（Claude：Bash/Edit/Glob/mcp__… 计数）
    categories?: Record<string, number> // 工具类别计数：shell/web/file/search/mcp/other
    mcp?: {                            // MCP 使用 Top（ADR 0045）：从 mcp__server__tool 工具名派生
      total_calls: number
      top_tools: McpToolCount[]        // per-tool 计数（含 server/tool 拆分）
      top_servers: NameCount[]         // per-server 聚合，为"哪个 MCP 重度/可清理"打底
    }
  }
```

Change the `skills` field (line 213):

```ts
  skills?: SkillUsage[]
```

Update the `skills` glossary entry (line 242) and add a `tools.mcp` entry next to `tools.categories` (after line 251). Change:

```ts
  skills: 'Times each skill was invoked (by attributionSkill), reflecting the skill usage profile.',
```
to:
```ts
  skills: 'Times each skill was invoked (by attributionSkill), with optional plugin attribution parsed from a plugin:skill name (e.g. superpowers:brainstorming → plugin=superpowers); reflects the skill usage profile. Non-sensitive labels only (ADR 0017).',
```
and after the `'tools.categories'` entry add:
```ts
  'tools.mcp': 'MCP usage top derived from mcp__server__tool tool names (Claude Code only this iteration): total_calls, top_tools (per-tool with server/tool split), top_servers (per-server aggregate). Tool/server names are structural non-sensitive labels, counts only, never tool inputs/outputs (ADR 0017/0045).',
```

- [ ] **Step 4: Add MCP fields + parsing in aggregate.ts**

In `src/aggregate.ts`, after the `toolByName` field declaration (line ~82) add three fields:

```ts
  private mcpToolCounts = new Map<string, number>() // 完整 mcp__server__tool 名 → 次数
  private mcpServerCounts = new Map<string, number>() // server 段 → 次数
  private mcpCalls = 0
```

Replace `applyToolName()` (lines 271-273) with:

```ts
  applyToolName(name: string): void {
    if (!name) return
    this.toolByName.set(name, (this.toolByName.get(name) ?? 0) + 1)
    if (name.startsWith('mcp__')) {
      this.mcpToolCounts.set(name, (this.mcpToolCounts.get(name) ?? 0) + 1)
      const rest = name.slice(5) // strip 'mcp__'
      const sep = rest.indexOf('__')
      const server = sep >= 0 ? rest.slice(0, sep) : rest // 末段缺失时整体即 server
      this.mcpServerCounts.set(server, (this.mcpServerCounts.get(server) ?? 0) + 1)
      this.mcpCalls++
    }
  }
```

In `assemble()`, right after the `report.tools.categories = cats` block (ends ~line 486) add MCP emission:

```ts
    if (this.mcpToolCounts.size) {
      const toolRec: Record<string, number> = {}
      for (const [k, v] of this.mcpToolCounts) toolRec[k] = v
      const serverRec: Record<string, number> = {}
      for (const [k, v] of this.mcpServerCounts) serverRec[k] = v
      report.tools.mcp = {
        total_calls: this.mcpCalls,
        top_tools: topCounts(toolRec, 15).map((c) => {
          const rest = c.command.slice(5)
          const sep = rest.indexOf('__')
          const server = sep >= 0 ? rest.slice(0, sep) : rest
          const tool = sep >= 0 ? rest.slice(sep + 2) : ''
          return { name: c.command, server, tool, count: c.count }
        }),
        top_servers: topCounts(serverRec, 8).map((c) => ({ name: c.command, count: c.count })),
      }
    }
```

Replace the skills emission line (line 493) — currently:

```ts
    if (this.skillCounts.size) report.skills = topCounts(skillRec, 12)
```
with plugin-attribution mapping (reuses the existing `skillRec` built at line 435-436):

```ts
    if (this.skillCounts.size) {
      report.skills = topCounts(skillRec, 12).map((c) => {
        const i = c.command.indexOf(':')
        return i > 0
          ? { command: c.command, count: c.count, plugin: c.command.slice(0, i) }
          : { command: c.command, count: c.count }
      })
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/mcp-skills.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Type-check + full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — `tsc` clean (note `report.tools.mcp` is now a known optional field; the `skills` map returns `SkillUsage[]`), all existing tests green.

- [ ] **Step 7: Commit**

```bash
git add src/model.ts src/aggregate.ts test/mcp-skills.test.ts
git commit -m "feat(report): aggregate MCP usage top (tool+server) and skill plugin attribution (ADR 0045)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CLI emit — text MCP/Skills lines + i18n (REQ3, part 2)

**Files:**
- Modify: `src/i18n.ts` (EN + ZH dicts — add `tx_skills_label`, `tx_mcp_servers`, `tx_mcp_tools`)
- Modify: `src/emit/text.ts` (skills line ~177-180; add MCP block)
- Test: `test/emit.test.ts` (extend)

- [ ] **Step 1: Write failing assertions in emit.test.ts**

In `test/emit.test.ts`, extend the `sample()` builder to add MCP + skill calls. Replace the existing `sample()` (lines 7-13) with:

```ts
function sample() {
  const agg = new Aggregator('claude-code')
  agg.applyTokens({ input: 100, cached_input: 40, output: 50, reasoning_output: 0,
    cache_creation: 10, total: 200 }, 'claude-opus-4-8', 'ccoach', 's1', new Date('2026-06-02T03:00:00Z'))
  agg.touchSession('s1')
  agg.applyToolName('mcp__playwright__browser_navigate')
  agg.applySkill('superpowers:brainstorming')
  return agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
}
```

Add two assertions inside the existing `'文本默认英文…'` test (after the `expect(out).toContain('total')` line):

```ts
    expect(out).toContain('MCP:')                       // MCP server line
    expect(out).toContain('playwright(1)')
    expect(out).toContain('brainstorming·superpowers(1)') // skill shows short name + plugin, not raw 'superpowers:brainstorming'
```

And in the existing `'JSON 含 glossary…'` test add:

```ts
    expect(parsed.tools.mcp.top_servers[0].name).toBe('playwright')
    expect(parsed.skills[0].plugin).toBe('superpowers')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/emit.test.ts`
Expected: FAIL — text output has neither `MCP:` nor the reformatted skill label; (the JSON assertions already pass thanks to Task 5, but the text ones fail).

- [ ] **Step 3: Add i18n keys**

In `src/i18n.ts`, add to the EN dict (near the other `tx_*` keys, e.g. after `tx_more_items`):

```ts
  tx_skills_label: 'Skill: ',
  tx_mcp_servers: 'MCP: ',
  tx_mcp_tools: 'MCP tools: ',
```
and to the ZH dict (matching position):

```ts
  tx_skills_label: '技能: ',
  tx_mcp_servers: 'MCP: ',
  tx_mcp_tools: 'MCP 工具: ',
```

- [ ] **Step 4: Render MCP + reformat skills in emit/text.ts**

In `src/emit/text.ts`, the `tools` block ends with `lines.push('')` at line 136. Right after it, add an MCP block:

```ts
  if (r.tools.mcp && r.tools.mcp.top_servers.length) {
    lines.push(t('tx_mcp_servers') + r.tools.mcp.top_servers.map((c) => `${c.name}(${c.count})`).join(' '))
    if (r.tools.mcp.top_tools.length) {
      lines.push('  ' + t('tx_mcp_tools') + r.tools.mcp.top_tools.slice(0, 8).map((m) => `${m.tool || m.name}·${m.server}(${m.count})`).join(' '))
    }
    lines.push('')
  }
```

Replace the skills block (lines 177-180) with a short-name + plugin formatting that uses the i18n label:

```ts
  if (r.skills?.length) {
    lines.push(t('tx_skills_label') + r.skills.map((c) => {
      const i = c.command.indexOf(':')
      const name = i > 0 ? c.command.slice(i + 1) : c.command
      return c.plugin ? `${name}·${c.plugin}(${c.count})` : `${name}(${c.count})`
    }).join(' '))
    lines.push('')
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/emit.test.ts`
Expected: PASS. (`emit/json.ts` needs no change — it is `JSON.stringify(report)`, so `tools.mcp` and `skills[].plugin` serialize automatically.)

- [ ] **Step 6: Full suite + type-check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/i18n.ts src/emit/text.ts test/emit.test.ts
git commit -m "feat(report): text emit MCP servers/tools line + skill short-name·plugin formatting (ADR 0045)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: HTML report — behavior panel MCP Top + Skills Top (REQ3, part 3)

**Files:**
- Modify: `skills/ccoach-insight/scripts/merge_dual_platform.mjs` (`claudeBehavior` ~153-187, `codexBehavior` ~190-218; add a `skillShort` helper)
- Modify: `skills/ccoach-insight/scripts/render_dual_platform.mjs` (`behaviorPanel` ~247-305)
- Modify: `skills/ccoach-insight/references/report-copy.json` (en `beh_*` ~59-75, zh ~196-212)
- Test: `test/render-mcp-skills.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/render-mcp-skills.test.ts`:

```ts
// REQ3/ADR 0045: the HTML behavior panel shows MCP Top + Skills Top with source attribution.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-ignore — skill 层 .mjs 无类型声明
import { buildClaude } from '../skills/ccoach-insight/scripts/merge_dual_platform.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RENDER = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts', 'render_dual_platform.mjs')

function renderMerged(merged: object, lang = 'en'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-ms-'))
  try {
    const dataPath = path.join(dir, 'm.json'); const insPath = path.join(dir, 'i.json'); const outPath = path.join(dir, 'o.html')
    writeFileSync(dataPath, JSON.stringify(merged))
    writeFileSync(insPath, JSON.stringify({ executive_summary: 'x', insights: [], recommendations: [] }))
    execFileSync('node', [RENDER, '--data', dataPath, '--insights', insPath, '--lang', lang, '--output', outPath])
    return readFileSync(outPath, 'utf8')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const ccRaw = {
  tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 },
  cache_hit_rate: 0.2, sessions: 2, active_days: 1, estimated_cost_usd: 1.5,
  model_tokens: [{ model: 'claude-opus-4-8', tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, estimated_cost_usd: 1.5, priced: true }],
  models_timeline: [{ model: 'claude-opus-4-8', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 200, days: [{ date: '2026-06-01', tokens: 200 }] }],
  prompt_signals: { prompts: 2 }, endpoints: [],
  tools: { total_calls: 5, shell_calls: 1, web_searches: 0, file_changes: 1, top_commands: [], mcp: { total_calls: 3, top_tools: [{ name: 'mcp__playwright__browser_navigate', server: 'playwright', tool: 'browser_navigate', count: 3 }], top_servers: [{ name: 'playwright', count: 3 }] } },
  skills: [{ command: 'superpowers:brainstorming', count: 2, plugin: 'superpowers' }, { command: 'tdd', count: 1 }],
}

describe('render: MCP Top + Skills Top (ADR 0045)', () => {
  it('Claude panel shows MCP tool with server + skill with plugin', () => {
    const cc = buildClaude(ccRaw)
    const html = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { claude_code: cc }, combined: { total_cost_usd: 1.5, total_tokens: 200, total_sessions: 2 } })
    expect(html).toContain('MCP Top')
    expect(html).toContain('browser_navigate')
    expect(html).toContain('playwright')
    expect(html).toContain('Skills Top')
    expect(html).toContain('brainstorming (superpowers)')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render-mcp-skills.test.ts`
Expected: FAIL — `html` contains neither `MCP Top` nor `Skills Top` (behavior currently drops mcp/skills).

- [ ] **Step 3: Extract mcp/skills into behavior in merge_dual_platform.mjs**

In `skills/ccoach-insight/scripts/merge_dual_platform.mjs`, add a helper near the top-level helpers (e.g. just above `claudeBehavior`, before line 153):

```js
// Strip a `plugin:` namespace prefix to the bare skill name (e.g. superpowers:brainstorming → brainstorming).
function skillShort(cmd) {
  const i = String(cmd).indexOf(':')
  return i > 0 ? String(cmd).slice(i + 1) : String(cmd)
}
function behaviorSkills(r) {
  return (r.skills ?? []).map((s) => ({ name: skillShort(s.command), plugin: s.plugin ?? '', count: s.count }))
}
```

In `claudeBehavior()`'s return object (after the `tools_by_name:` line, ~line 173) add two fields:

```js
    tools_by_name: (tools.by_name ?? []).map((x) => ({ name: x.name, count: x.count })),
    mcp: tools.mcp ?? null,
    skills: behaviorSkills(r),
```

In `codexBehavior()`'s return object (after its `tools_by_name: [],` line ~205) add the same two fields (they will be empty for Codex this iteration, so nothing renders):

```js
    tools_by_name: [],
    mcp: tools.mcp ?? null,
    skills: behaviorSkills(r),
```

- [ ] **Step 4: Render MCP Top + Skills Top in behaviorPanel**

In `skills/ccoach-insight/scripts/render_dual_platform.mjs`, in `behaviorPanel()` insert the two new blocks right after the `top_commands` block (after `p.push(miniBars(beh.top_commands, 'command', 'count', color))`, ~line 276):

```js
  const mcp = beh.mcp
  if (mcp && Array.isArray(mcp.top_tools) && mcp.top_tools.length) {
    p.push(`<h3>${esc(tr('beh_mcp'))}</h3>`)
    const items = mcp.top_tools.map((x) => ({ name: `${x.tool || x.name} · ${x.server}`, count: x.count }))
    p.push(miniBars(items, 'name', 'count', color))
  }
  const sk = beh.skills ?? []
  if (sk.length) {
    p.push(`<h3>${esc(tr('beh_skills'))}</h3>`)
    const items = sk.map((x) => ({ name: x.plugin ? `${x.name} (${x.plugin})` : x.name, count: x.count }))
    p.push(miniBars(items, 'name', 'count', color))
  }
```

- [ ] **Step 5: Add copy keys**

In `skills/ccoach-insight/references/report-copy.json`, EN block — after `"beh_top_commands": …` (~line 69) add:

```json
      "beh_mcp": "MCP Top (by tool · server)",
      "beh_skills": "Skills Top (with plugin)",
```

ZH block — after `"beh_top_commands": …` (~line 206) add:

```json
      "beh_mcp": "MCP Top（按工具 · server）",
      "beh_skills": "技能 Top（含 plugin）",
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/render-mcp-skills.test.ts`
Expected: PASS.

- [ ] **Step 7: Run render + scorecard regressions**

Run: `npx vitest run test/render-single-platform.test.ts test/scorecard.test.ts`
Expected: PASS (no regressions — new blocks only render when `beh.mcp`/`beh.skills` are populated, which the old fixtures don't set).

- [ ] **Step 8: Commit**

```bash
git add skills/ccoach-insight/scripts/merge_dual_platform.mjs skills/ccoach-insight/scripts/render_dual_platform.mjs skills/ccoach-insight/references/report-copy.json test/render-mcp-skills.test.ts
git commit -m "feat(report): HTML behavior panel shows MCP Top + Skills Top with source attribution (ADR 0045)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: ADR 0045 + final full-suite gate

**Files:**
- Create: `docs/adr/0045-mcp-skills-usage-top.md`

- [ ] **Step 1: Create ADR 0045**

Create `docs/adr/0045-mcp-skills-usage-top.md`:

```markdown
# ADR 0045 — MCP / Skills usage top with source attribution

> 状态：已接受 · 日期：2026-06-06
> · 遵守 [`adr/0017`](0017-derived-non-content-signals.md) 派生非内容信号边界
> · 不破坏 [`adr/0004`](0004-json-contract.md) / [`adr/0010`](0010-cli-rewrite-node-ccusage.md) 的 `--json` 契约

## 背景

行为画像已统计工具/命令/git/语言 Top，但：MCP 工具（`mcp__server__tool`）被混进
`tools.by_name`、只在 `tools.categories.mcp` 有一个总数，看不出**用了哪些 MCP、各多少次、属于
哪个 server**；`skills[]` 只堆原始 `attributionSkill` 串（如 `superpowers:brainstorming`），
不区分 plugin 来源。用户想先在 CLI + HTML 看到 MCP/Skill 使用 Top，为将来「注册一堆 MCP 却只
用几个 → 建议清理省上下文」打底。

## 决策

从既有 JSONL 派生 **MCP 使用 Top + skill plugin 归属**，端到端（CLI `--json`/text + skill HTML）：

- **数据结构**（`tools.mcp`，ADR 0045）：`{ total_calls, top_tools:[{name,server,tool,count}],
  top_servers:[{name,count}] }`。`top_tools` 上限 15、`top_servers` 上限 8。从 `mcp__server__tool`
  工具名按前两个 `__` 切分、末段缺失容错。
- **skill 归属**：`skills[]` 项扩展为 `{command,count,plugin?}`，`plugin` 由 `plugin:skill` 前缀
  解析（裸名无 plugin）。
- **呈现**：CLI text 新增 `MCP:`（server 维度）+ 可选工具明细，skills 行改为「短名·plugin」；
  HTML 行为面板新增「MCP Top」「Skills Top」并标来源（MCP 标 server、skill 标 plugin）。
- **隐私**：MCP server/tool 名、skill/plugin 名均为结构性**非敏感标签**（同 Bash/Edit），仅计数，
  绝不读工具入参/输出（ADR 0017 D1）。`--json` 新增字段全部可选，向后兼容。

## 影响

- 本期 MCP/Skills Top 为 **Claude Code 侧**：`codex.ts` parser 只记工具类别、不记工具名/skill，
  故 Codex 行为块的 mcp/skills 为空、不渲染；扩展 Codex parser 记录工具名属后续。
- 「注册却几乎不用」的差集分析需读 MCP config（注册列表），本期只产出使用侧数据（`top_servers`
  + `total_calls`），差集与清理建议另起一篇 ADR。
- 不破坏 `--json` 契约（仅新增可选字段，ADR 0004/0010）。
```

- [ ] **Step 2: Validate ADR numbering**

Run: `node tools/check_adrs.mjs`
Expected: PASS (0045 sequential).

- [ ] **Step 3: Full gate — type-check + all tests + ccusage cross-check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (all tests, including the 4 new files and the extended emit/render tests).

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0045-mcp-skills-usage-top.md
git commit -m "docs(adr): add 0045 MCP/skills usage top with source attribution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (plan author)

**Spec coverage:**
- REQ1 (single-platform heading) → Task 1. ✓ (heading copy + provenance note + render comment + tests)
- REQ2 (title/roast fallback guard) → Tasks 2 (flags), 3 (render guard), 4 (SKILL.md enforce + ADR 0044). ✓
- REQ3 (MCP/Skills top) → Tasks 5 (model+aggregate), 6 (text+i18n+json passthrough), 7 (HTML merge+render+copy), 8 (ADR 0045). ✓
- Spec's "为清理建议留接口" → covered by `top_servers` + `total_calls` and noted in ADR 0045 as a future step. ✓
- Spec's privacy compliance → asserted via non-sensitive-label rationale in ADR 0045 + glossary text. ✓

**Type consistency:** `McpToolCount {name,server,tool,count}` defined in Task 5, consumed identically in Task 5 assemble, Task 6 text emit (`m.tool`/`m.server`), Task 7 render (`x.tool`/`x.server`/`x.name`), and Task 7 test fixture. `SkillUsage {command,count,plugin?}` defined Task 5, consumed in Task 6 (`c.command`/`c.plugin`) and Task 7 (`behaviorSkills` reads `s.command`/`s.plugin`). `tools.mcp` shape identical across model.ts, aggregate.ts, text.ts, merge `behaviorSkills`/`mcp` passthrough, render. `title_is_fallback`/`roast_is_fixture` defined Task 2, consumed Task 3 render + tests. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every command has expected output. ✓

**Note for executor:** line numbers are approximate (use them to locate, then match on the verbatim code shown). Run `npx vitest run` after each task; if `tsc` flags an unrelated pre-existing issue, stop and report rather than widening scope.
