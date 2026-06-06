# Host-Platform Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `ccoach-insight` skill default to a single-platform report for the host it runs in (Claude Code vs Codex), keeping the dual-platform comparison as an explicit opt-in.

**Architecture:** No CLI change — `ccoach report --platform` already supports per-platform. The skill detects the host via the `CLAUDECODE` env var (falling back to asking the user when indeterminate) and requests one platform. The merge script is generalized to accept one OR two platform reports; the dual renderer renders only the platforms present and hides the comparison section when single; the scorecard grades the present (host) platform.

**Tech Stack:** Node ≥18 ESM `.mjs` skill scripts, TypeScript CLI (`src/`), vitest, JSON i18n copy tables.

---

## File Structure

- `skills/ccoach-insight/scripts/merge_dual_platform.mjs` — make `--cc-report` / `--codex-report` individually optional (≥1 required); build `platforms{}` + `combined` from whichever are present; add `prompt_signals` to `buildCodex`.
- `skills/ccoach-insight/scripts/render_dual_platform.mjs` — render only present platforms; gate comparison section on `both`; add platform-scope subtitle.
- `skills/ccoach-insight/scripts/scorecard.mjs` — grade the host platform (`claude_code ?? codex`).
- `skills/ccoach-insight/references/report-copy.json` — rebrand `report_title`; add `report_subtitle_scope` + `m_active_days` (en + zh).
- `skills/ccoach-insight/SKILL.md` — host-aware Step 0 + single-platform default flow + opt-in dual flow; reword frontmatter.
- `skills/ccoach-insight/agents/openai.yaml` — host-aware `default_prompt`.
- `docs/adr/0042-skill-host-platform-default.md` — new ADR.
- `docs/PRD.md`, `docs/TODO.md` — reflect the behavior change.
- `test/merge-single-platform.test.ts` — new (merge tolerance).
- `test/render-single-platform.test.ts` — new (renderer single/dual).
- `test/scorecard.test.ts` — extend (host=codex grading).

---

## Task 1: merge — tolerate a single platform

**Files:**
- Modify: `skills/ccoach-insight/scripts/merge_dual_platform.mjs` (`buildCodex` return ~274-298; `main()` ~317-353)
- Test: `test/merge-single-platform.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/merge-single-platform.test.ts`:

```ts
// 单平台 merge 容忍度（宿主平台默认，ADR 0042）：只给一个平台 report 也能合并；两个都给则 dual 不变。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MERGE = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts', 'merge_dual_platform.mjs')

const ccReport = {
  tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 },
  cache_hit_rate: 0.2, sessions: 2, active_days: 1, estimated_cost_usd: 1.5,
  model_tokens: [{ model: 'claude-opus-4-8', tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, estimated_cost_usd: 1.5, priced: true }],
  models_timeline: [{ model: 'claude-opus-4-8', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 200, days: [{ date: '2026-06-01', tokens: 200 }] }],
  prompt_signals: { prompts: 2, avg_len: 200, structured_ratio: 0.5, constraint_ratio: 0.5, file_ref_ratio: 0.3, correction_rate: 0.1 },
  generated_for: 'today', endpoints: [],
}
const codexReport = {
  tokens: { input: 300, output: 100, cached_input: 80, reasoning_output: 20, total: 400 },
  cache_hit_rate: 0.3, active_days: 2, sessions: 3, estimated_cost_usd: 2.0, reasoning_ratio: 0.2,
  model_tokens: [{ model: 'gpt-5.4', tokens: { input: 300, cached_input: 80, output: 100, reasoning_output: 20, cache_creation: 0, total: 400 }, estimated_cost_usd: 2.0, priced: true }],
  models_timeline: [{ model: 'gpt-5.4', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 400, days: [{ date: '2026-06-01', tokens: 400 }] }],
  prompt_signals: { prompts: 3, avg_len: 150 },
  generated_for: 'today', endpoints: [],
}

function runMerge(args: string[], dir: string): any {
  const out = path.join(dir, 'merged.json')
  execFileSync('node', [MERGE, ...args, '--output', out], { encoding: 'utf8' })
  return JSON.parse(readFileSync(out, 'utf8'))
}

describe('merge: single-platform tolerance (ADR 0042)', () => {
  it('only --cc-report → platforms has claude_code only', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge1-'))
    try {
      const ccPath = path.join(dir, 'cc.json'); writeFileSync(ccPath, JSON.stringify(ccReport))
      const m = runMerge(['--cc-report', ccPath], dir)
      expect(Object.keys(m.platforms)).toEqual(['claude_code'])
      expect(m.platforms.codex).toBeUndefined()
      expect(m.combined.total_tokens).toBe(200)
      expect(m.combined.total_cost_usd).toBe(1.5)
      expect(m.combined.total_sessions).toBe(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('only --codex-report → platforms has codex only; combined reflects codex', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge2-'))
    try {
      const cxPath = path.join(dir, 'cx.json'); writeFileSync(cxPath, JSON.stringify(codexReport))
      const m = runMerge(['--codex-report', cxPath], dir)
      expect(Object.keys(m.platforms)).toEqual(['codex'])
      expect(m.platforms.claude_code).toBeUndefined()
      expect(m.combined.total_tokens).toBe(400)
      expect(m.combined.total_sessions).toBe(3) // codex behavior sessions fallback
      expect(m.combined.prompt_signals.prompts).toBe(3)
      expect(m.platforms.codex.prompt_signals.prompts).toBe(3) // buildCodex now carries prompt_signals
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('both reports → platforms has both (dual unchanged)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge3-'))
    try {
      const ccPath = path.join(dir, 'cc.json'); writeFileSync(ccPath, JSON.stringify(ccReport))
      const cxPath = path.join(dir, 'cx.json'); writeFileSync(cxPath, JSON.stringify(codexReport))
      const m = runMerge(['--cc-report', ccPath, '--codex-report', cxPath], dir)
      expect(Object.keys(m.platforms).sort()).toEqual(['claude_code', 'codex'])
      expect(m.combined.total_tokens).toBe(600)
      expect(m.combined.total_sessions).toBe(2) // Claude-centric in dual (unchanged)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('neither report → exit non-zero', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge4-'))
    try {
      expect(() => execFileSync('node', [MERGE, '--output', path.join(dir, 'm.json')], { encoding: 'utf8' })).toThrow()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/merge-single-platform.test.ts`
Expected: FAIL — current `main()` requires both reports (`missing --cc-report` → exit 2), so the single-platform cases throw before producing output.

- [ ] **Step 3a: Add `prompt_signals` to `buildCodex`**

In `skills/ccoach-insight/scripts/merge_dual_platform.mjs`, inside `buildCodex`'s returned object, add a `prompt_signals` line right after `behavior:`:

```js
    behavior: codexBehavior(r, lang),
    prompt_signals: r.prompt_signals ?? {}, // 单平台(宿主=Codex)时供成绩卡 Prompt Skill 轴（ADR 0008/0042）
    episode_summary: r.episode_summary ?? null, // 回合概览（ADR 0032/0034）
```

- [ ] **Step 3b: Rewrite `main()` to accept one or two platform reports**

Replace the entire `main()` function body (the validation loop through the final `console.log`) with:

```js
function main() {
  const a = parseArgs(process.argv.slice(2))
  // 至少一个平台 report + --output（单平台默认；两个都给 = 双平台 opt-in，ADR 0042）。
  // --cc-sessions 仍可选（Claude top-sessions 表；缺省即空表）。
  if (!a.output) {
    process.stderr.write('missing --output\n')
    process.exit(2)
  }
  if (!a['cc-report'] && !a['codex-report']) {
    process.stderr.write('need at least one of --cc-report / --codex-report\n')
    process.exit(2)
  }
  const lang = a.lang || 'en' // 默认英文（ADR 0026）；与 ccoach report / scorecard / render 同传
  const ccReport = a['cc-report'] ? load(a['cc-report']) : null
  const codexReport = a['codex-report'] ? load(a['codex-report']) : null
  const ccSessions = a['cc-sessions'] ? load(a['cc-sessions']) : null
  const claude = ccReport ? buildClaude(ccReport, ccSessions, lang) : null
  const codex = codexReport ? buildCodex(codexReport, lang) : null

  const platforms = {}
  if (claude) platforms.claude_code = claude
  if (codex) platforms.codex = codex

  const merged = {
    title: 'AI Usage Report', // 不再用于显示（renderer 按 --lang 取标题，ADR 0025）；保留字段兼容
    generated_at: todayIso(),
    window: buildWindow([codexReport, ccReport].filter(Boolean)),
    platforms,
    combined: {
      total_cost_usd: round((claude?.cost_usd ?? 0) + (codex?.cost_usd ?? 0), 2),
      total_tokens: (claude?.tokens.total ?? 0) + (codex?.tokens.total ?? 0),
      // 会话数：优先 Claude（dual 行为不变）；单 Codex 时取 Codex behavior 会话数（成绩卡用）。
      total_sessions: claude?.sessions ?? codex?.behavior?.sessions ?? 0,
      prompt_signals: ccReport?.prompt_signals ?? codexReport?.prompt_signals ?? {},
    },
  }
  writeFileSync(a.output, JSON.stringify(merged, null, 2))
  console.log(`wrote ${a.output}`)
  console.log(`  统计窗口: ${merged.window.desc ?? '(unknown)'}`)
  if (claude) console.log(`  Claude Code: ${claude.sessions} sessions, $${claude.cost_usd}, ${comma(claude.tokens.total)} tokens`)
  if (codex) console.log(`  Codex: ${codex.active_days} days, $${codex.cost_usd}, ${comma(codex.tokens.total)} tokens (empty=${codex.tokens.total === 0})`)
  console.log('  注：成本为离线 fallback；跑 apply_pricing.mjs 用联网官方价覆盖。')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/merge-single-platform.test.ts`
Expected: PASS (all 4 cases).

Also confirm no regression in the existing merge test:
Run: `npx vitest run test/merge-extras.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ccoach-insight/scripts/merge_dual_platform.mjs test/merge-single-platform.test.ts
git commit -m "feat(skill): merge tolerates a single platform report (ADR 0042)"
```

---

## Task 2: scorecard — grade the host platform

**Files:**
- Modify: `skills/ccoach-insight/scripts/scorecard.mjs:152`
- Test: `test/scorecard.test.ts` (append a case)

- [ ] **Step 1: Write the failing test**

Append this `it(...)` inside the existing `describe('scorecard 回归（.mjs，去 Python）', ...)` block in `test/scorecard.test.ts` (after the existing test, before the closing `})` of the describe). It writes a Codex-only merged JSON and asserts the Diligence axis reads Codex's `active_days` (Workhorse / index 0) — which only happens when the host falls back to `platforms.codex`:

```ts
  it('Codex-only merged JSON → 成绩卡评宿主(Codex)数据，不塌（ADR 0042）', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-sc-cx-'))
    try {
      const codexOnly = {
        platforms: {
          codex: {
            cost_usd: 12, active_days: 6, tokens: { total: 500000 },
            models: [{ model: 'gpt-5.4', cost: 12 }],
            behavior: { tool_categories: { shell: 10, file: 30 }, repos: [{ repo: 'a' }], hours: [{ hour: 14, count: 20 }], sessions: 8 },
            prompt_signals: { prompts: 5, avg_len: 300, structured_ratio: 0.6, constraint_ratio: 0.5, file_ref_ratio: 0.4, correction_rate: 0.1 },
          },
        },
        combined: { total_cost_usd: 12, total_tokens: 500000, total_sessions: 8, prompt_signals: {} },
      }
      const dataPath = path.join(d, 'codex-only.json')
      writeFileSync(dataPath, JSON.stringify(codexOnly))
      const out = path.join(d, 'card.json')
      execFileSync('node', [path.join(SKILL, 'scorecard.mjs'), '--data', dataPath, '--lang', 'en', '--output', out], { encoding: 'utf8' })
      const card = JSON.parse(readFileSync(out, 'utf8'))
      expect(new Set(card.axes.map((a: { key: string }) => a.key))).toEqual(AXES)
      for (const a of card.axes) expect(a.tier, `${a.key} tier`).toBeTruthy()
      const dil = card.axes.find((a: { key: string }) => a.key === 'diligence')
      // 宿主=Codex 时 active_days=6 → Workhorse(0)；旧逻辑(host={}) active_days=0 → 会落到 index 2
      expect(dil.tier_index).toBe(0)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
```

Note: `test/scorecard.test.ts` already imports `execFileSync`, `readFileSync`, `writeFileSync`? Verify the imports at the top include `writeFileSync` — the existing file imports `readFileSync, mkdtempSync, rmSync` from `node:fs`. **Add `writeFileSync`** to that import if missing:

```ts
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scorecard.test.ts`
Expected: FAIL on the new case — current `scorecard.mjs:152` (`const cc = platforms.claude_code ?? {}`) yields `cc = {}` for Codex-only, so `scoreDiligence` reads `active_days = 0` → `tier_index` is 2, not 0.

- [ ] **Step 3: Grade the host platform**

In `skills/ccoach-insight/scripts/scorecard.mjs`, change line 152:

```js
  const cc = data.platforms.claude_code ?? {}
```

to:

```js
  // 宿主平台：dual 时取 Claude（行为不变）；单平台时取在场平台（ADR 0042）。
  const cc = data.platforms.claude_code ?? data.platforms.codex ?? {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scorecard.test.ts`
Expected: PASS (existing case + new Codex-only case).

- [ ] **Step 5: Commit**

```bash
git add skills/ccoach-insight/scripts/scorecard.mjs test/scorecard.test.ts
git commit -m "feat(skill): scorecard grades the host platform, not always Claude (ADR 0042)"
```

---

## Task 3: renderer — single-platform aware + i18n keys

**Files:**
- Modify: `skills/ccoach-insight/references/report-copy.json` (`dual.en` + `dual.zh`)
- Modify: `skills/ccoach-insight/scripts/render_dual_platform.mjs` (`render()` ~431-624)
- Test: `test/render-single-platform.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/render-single-platform.test.ts`:

```ts
// 单平台渲染（宿主平台默认，ADR 0042）：只画在场平台、隐藏对比区、副标题标平台范围；dual 仍两栏 + 对比。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-ignore — skill 层 .mjs 无类型声明（运行时导入）
import { buildClaude, buildCodex } from '../skills/ccoach-insight/scripts/merge_dual_platform.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RENDER = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts', 'render_dual_platform.mjs')

const ccRaw = { tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, cache_hit_rate: 0.2, sessions: 2, active_days: 1, estimated_cost_usd: 1.5, model_tokens: [{ model: 'claude-opus-4-8', tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, estimated_cost_usd: 1.5, priced: true }], models_timeline: [{ model: 'claude-opus-4-8', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 200, days: [{ date: '2026-06-01', tokens: 200 }] }], prompt_signals: { prompts: 2 }, endpoints: [] }
const cxRaw = { tokens: { input: 300, output: 100, cached_input: 80, reasoning_output: 20, total: 400 }, cache_hit_rate: 0.3, active_days: 2, sessions: 3, estimated_cost_usd: 2.0, reasoning_ratio: 0.2, model_tokens: [{ model: 'gpt-5.4', tokens: { input: 300, cached_input: 80, output: 100, reasoning_output: 20, cache_creation: 0, total: 400 }, estimated_cost_usd: 2.0, priced: true }], models_timeline: [{ model: 'gpt-5.4', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 400, days: [{ date: '2026-06-01', tokens: 400 }] }], prompt_signals: { prompts: 3 }, endpoints: [] }

function renderMerged(merged: object, lang = 'en'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-rs-'))
  try {
    const dataPath = path.join(dir, 'm.json'); const insPath = path.join(dir, 'i.json'); const outPath = path.join(dir, 'o.html')
    writeFileSync(dataPath, JSON.stringify(merged))
    writeFileSync(insPath, JSON.stringify({ executive_summary: 'x', insights: [], recommendations: [] }))
    execFileSync('node', [RENDER, '--data', dataPath, '--insights', insPath, '--lang', lang, '--output', outPath])
    return readFileSync(outPath, 'utf8')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('render: single-platform (ADR 0042)', () => {
  it('Claude-only → CC panel, no comparison, no Codex panel', () => {
    const cc = buildClaude(ccRaw)
    const html = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { claude_code: cc }, combined: { total_cost_usd: 1.5, total_tokens: 200, total_sessions: 2 } })
    expect(html).toContain('<h2>Claude Code</h2>')
    expect(html).not.toContain('Platform Comparison')
    expect(html).not.toContain('<h2>Codex</h2>')
    expect(html).toContain('Platform: Claude Code')
  })
  it('Codex-only → Codex panel, no comparison, no Claude panel', () => {
    const cx = buildCodex(cxRaw)
    const html = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { codex: cx }, combined: { total_cost_usd: 2.0, total_tokens: 400, total_sessions: 3 } })
    expect(html).toContain('<h2>Codex</h2>')
    expect(html).not.toContain('Platform Comparison')
    expect(html).not.toContain('<h2>Claude Code</h2>')
    expect(html).toContain('Platform: Codex')
  })
  it('dual → both panels + comparison (regression)', () => {
    const cc = buildClaude(ccRaw); const cx = buildCodex(cxRaw)
    const html = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { claude_code: cc, codex: cx }, combined: { total_cost_usd: 3.5, total_tokens: 600, total_sessions: 2 } })
    expect(html).toContain('<h2>Claude Code</h2>')
    expect(html).toContain('<h2>Codex</h2>')
    expect(html).toContain('Platform Comparison')
    expect(html).toContain('Platform: Claude Code + Codex')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/render-single-platform.test.ts`
Expected: FAIL — current `render()` reads `cc.cost_usd` / `cx.tokens.total` unconditionally, so a Codex-only `data.platforms` (no `claude_code`) throws; and the comparison/subtitle assertions are unmet.

- [ ] **Step 3a: Rebrand title + add i18n keys (English)**

In `skills/ccoach-insight/references/report-copy.json`, in the `dual.en` block, change:

```json
      "report_title": "Dual-Platform AI Usage Report",
```

to (and add the scope subtitle on the next line):

```json
      "report_title": "ccoach Insight Report",
      "report_subtitle_scope": "Platform: {scope}",
```

Then, still in `dual.en`, after the `"active_days_sub": "{n} active days",` line, add:

```json
      "m_active_days": "Active Days",
```

- [ ] **Step 3b: Rebrand title + add i18n keys (Chinese)**

In the `dual.zh` block of the same file, change:

```json
      "report_title": "双平台 AI 使用报告",
```

to:

```json
      "report_title": "ccoach 洞察报告",
      "report_subtitle_scope": "平台：{scope}",
```

Then, still in `dual.zh`, after the `"active_days_sub": "{n} 活跃天",` line, add:

```json
      "m_active_days": "活跃天数",
```

- [ ] **Step 3c: Make `render()` single-platform aware**

In `skills/ccoach-insight/scripts/render_dual_platform.mjs`, apply these edits inside `render(...)`.

(i) Replace the platform/title setup:

```js
  const cc = data.platforms.claude_code
  const cx = data.platforms.codex
  const comb = data.combined
  const title = tr('report_title') // 报告标题属骨架文案，按 --lang 取；忽略 merge 写入的固定 data.title
  const htmllang = tr('html_lang')
```

with:

```js
  const cc = data.platforms.claude_code
  const cx = data.platforms.codex
  const hasCc = !!cc
  const hasCx = !!cx
  const both = hasCc && hasCx // dual=完整对比；单平台=隐藏对比区 + 缺席面板（宿主平台默认，ADR 0042）
  const scope = both ? 'Claude Code + Codex' : hasCc ? 'Claude Code' : 'Codex'
  const comb = data.combined
  const title = tr('report_title') // 报告标题属骨架文案，按 --lang 取；忽略 merge 写入的固定 data.title
  const htmllang = tr('html_lang')
```

(ii) Add the platform-scope subtitle in the header. Replace:

```js
    `<header><h1>${esc(title)}</h1>` +
      `<p><b>${tr('header_meta', { window: esc(data.window?.desc ?? data.generated_at), gen: esc(data.generated_at) })}</b></p>` +
      `<p class='muted'>${tr('header_source')}${costMeta}</p></header>`,
```

with:

```js
    `<header><h1>${esc(title)}</h1>` +
      `<p class='muted'>${esc(tr('report_subtitle_scope', { scope }))}</p>` +
      `<p><b>${tr('header_meta', { window: esc(data.window?.desc ?? data.generated_at), gen: esc(data.generated_at) })}</b></p>` +
      `<p class='muted'>${tr('header_source')}${costMeta}</p></header>`,
```

(iii) Guard the combined headline's per-platform cost metrics. Replace:

```js
  p.push(metric(tr('m_cc_cost'), money(cc.cost_usd), tr('active_days_sub', { n: cc.active_days })))
  p.push(metric(tr('m_cx_cost'), money(cx.cost_usd), tr('active_days_sub', { n: cx.active_days })))
  p.push('</section>')
```

with:

```js
  if (both) {
    p.push(metric(tr('m_cc_cost'), money(cc.cost_usd), tr('active_days_sub', { n: cc.active_days })))
    p.push(metric(tr('m_cx_cost'), money(cx.cost_usd), tr('active_days_sub', { n: cx.active_days })))
  } else {
    const only = hasCc ? cc : cx
    p.push(metric(tr('m_active_days'), comma(only.active_days)))
  }
  p.push('</section>')
```

(iv) Gate the head-to-head comparison on `both`. Replace the whole block:

```js
  // head-to-head comparison bars
  p.push(
    `<section class='panel'><h2>${esc(tr('h_comparison'))}</h2><div class='legend'>` +
      "<span class='ldot a'></span>Claude Code" +
      "<span class='ldot b'></span>Codex</div>",
  )
  p.push(compareMetric(tr('cmp_total_cost'), cc.cost_usd, cx.cost_usd, money))
  p.push(compareMetric(tr('cmp_total_tokens'), cc.tokens.total, cx.tokens.total))
  // 输入 Token = 输入侧总量（含缓存读）——两平台口径统一，避免 Claude 因排除 cache 而虚小（ADR 0024）。
  p.push(compareMetric(tr('cmp_input'), inputSideTotal(cc.tokens, 'claude'), inputSideTotal(cx.tokens, 'codex')))
  p.push(compareMetric(tr('cmp_output'), cc.tokens.output, cx.tokens.output))
  p.push(compareMetric(tr('cmp_cache_read'), cc.tokens.cache_read, cx.tokens.cache_read))
  p.push(compareMetric(tr('cmp_cache_hit'), cc.cache_hit_rate, cx.cache_hit_rate, pct))
  p.push(compareMetric(tr('cmp_active_days'), cc.active_days, cx.active_days))
  p.push('</section>')
```

with:

```js
  // head-to-head comparison bars — 仅双平台渲染（单平台无对比对象，ADR 0042）
  if (both) {
    p.push(
      `<section class='panel'><h2>${esc(tr('h_comparison'))}</h2><div class='legend'>` +
        "<span class='ldot a'></span>Claude Code" +
        "<span class='ldot b'></span>Codex</div>",
    )
    p.push(compareMetric(tr('cmp_total_cost'), cc.cost_usd, cx.cost_usd, money))
    p.push(compareMetric(tr('cmp_total_tokens'), cc.tokens.total, cx.tokens.total))
    // 输入 Token = 输入侧总量（含缓存读）——两平台口径统一，避免 Claude 因排除 cache 而虚小（ADR 0024）。
    p.push(compareMetric(tr('cmp_input'), inputSideTotal(cc.tokens, 'claude'), inputSideTotal(cx.tokens, 'codex')))
    p.push(compareMetric(tr('cmp_output'), cc.tokens.output, cx.tokens.output))
    p.push(compareMetric(tr('cmp_cache_read'), cc.tokens.cache_read, cx.tokens.cache_read))
    p.push(compareMetric(tr('cmp_cache_hit'), cc.cache_hit_rate, cx.cache_hit_rate, pct))
    p.push(compareMetric(tr('cmp_active_days'), cc.active_days, cx.active_days))
    p.push('</section>')
  }
```

(v) Guard the two platform panels + make the grid dynamic. Replace the block from `// two platform panels side by side` through its closing `p.push('</section>')` (the one immediately before `// token composition per platform`):

```js
  // two platform panels side by side
  p.push("<section class='grid2'>")

  // Claude Code panel
  p.push("<div class='panel'><h2>Claude Code</h2>")
  p.push(
    `<p class='muted'>${tr('panel_sessions_meta', { source: esc(tr('src_claude')), range: rangeLabel(cc.date_range), sessions: cc.sessions, cost: costNote(cc) })}</p>`,
  )
  p.push(sparkline(cc.daily_series, '#0f766e'))
  p.push(`<h3>${esc(tr('h_model_dist'))}</h3>`)
  p.push(modelTable(cc.models, 'claude'))
  p.push(`<h3>${esc(tr('h_top_sessions'))}</h3><table><tr><th>${esc(tr('th_project'))}</th><th>${esc(tr('th_tokens'))}</th><th>${esc(tr('th_model'))}</th></tr>`)
  for (const s of cc.top_sessions) {
    p.push(
      `<tr><td>${esc(s.project)}<br><span class='muted'>${esc(s.last)}</span></td>` +
        `<td>${comma(s.tokens)}</td>` +
        `<td>${esc((s.models ?? []).join(', '))}</td></tr>`,
    )
  }
  p.push('</table>')
  p.push(claudeServerTools(cc))
  p.push('</div>')

  // Codex panel
  p.push("<div class='panel'><h2>Codex</h2>")
  const cxEmpty = (cx.tokens?.total ?? 0) === 0
  p.push(
    `<p class='muted'>${tr('panel_cx_meta', { source: esc(tr('src_codex')), range: rangeLabel(cx.date_range), cost: costNote(cx) })}</p>`,
  )
  if (cxEmpty) {
    p.push(`<p class='muted'>${esc(tr('cx_empty'))}</p>`)
  } else {
    p.push(sparkline(cx.daily_series, '#b45309'))
    p.push(`<h3>${esc(tr('h_model_dist'))}</h3>`)
    p.push(modelTable(cx.models, 'codex'))
    p.push(
      `<p class='muted'>${tr('cx_tokline', { tokens: comma((cx.tokens ?? {}).total ?? 0), cost: money(cx.cost_usd), hit: pct(cx.cache_hit_rate) })}</p>`,
    )
    p.push(codexBillingBreakdown(cx))
    p.push(codexExecProfile(cx))
  }
  p.push('</div>')
  p.push('</section>')
```

with (note: each panel wrapped in its `if`, grid class is `both ? 'grid2' : ''`):

```js
  // platform panels — 按在场平台渲染（单平台不并排、不留空壳，ADR 0042）
  p.push(`<section class='${both ? 'grid2' : ''}'>`)

  // Claude Code panel
  if (hasCc) {
    p.push("<div class='panel'><h2>Claude Code</h2>")
    p.push(
      `<p class='muted'>${tr('panel_sessions_meta', { source: esc(tr('src_claude')), range: rangeLabel(cc.date_range), sessions: cc.sessions, cost: costNote(cc) })}</p>`,
    )
    p.push(sparkline(cc.daily_series, '#0f766e'))
    p.push(`<h3>${esc(tr('h_model_dist'))}</h3>`)
    p.push(modelTable(cc.models, 'claude'))
    p.push(`<h3>${esc(tr('h_top_sessions'))}</h3><table><tr><th>${esc(tr('th_project'))}</th><th>${esc(tr('th_tokens'))}</th><th>${esc(tr('th_model'))}</th></tr>`)
    for (const s of cc.top_sessions) {
      p.push(
        `<tr><td>${esc(s.project)}<br><span class='muted'>${esc(s.last)}</span></td>` +
          `<td>${comma(s.tokens)}</td>` +
          `<td>${esc((s.models ?? []).join(', '))}</td></tr>`,
      )
    }
    p.push('</table>')
    p.push(claudeServerTools(cc))
    p.push('</div>')
  }

  // Codex panel
  if (hasCx) {
    p.push("<div class='panel'><h2>Codex</h2>")
    const cxEmpty = (cx.tokens?.total ?? 0) === 0
    p.push(
      `<p class='muted'>${tr('panel_cx_meta', { source: esc(tr('src_codex')), range: rangeLabel(cx.date_range), cost: costNote(cx) })}</p>`,
    )
    if (cxEmpty) {
      p.push(`<p class='muted'>${esc(tr('cx_empty'))}</p>`)
    } else {
      p.push(sparkline(cx.daily_series, '#b45309'))
      p.push(`<h3>${esc(tr('h_model_dist'))}</h3>`)
      p.push(modelTable(cx.models, 'codex'))
      p.push(
        `<p class='muted'>${tr('cx_tokline', { tokens: comma((cx.tokens ?? {}).total ?? 0), cost: money(cx.cost_usd), hit: pct(cx.cache_hit_rate) })}</p>`,
      )
      p.push(codexBillingBreakdown(cx))
      p.push(codexExecProfile(cx))
    }
    p.push('</div>')
  }
  p.push('</section>')
```

(vi) Guard the token-composition panels + dynamic grid. Replace:

```js
  // token composition per platform
  p.push("<section class='grid2'>")
  // Both panels use disjoint buckets that sum to total (ADR 0024). For Codex this fixes the old
  // double-count where input (incl cached) + cached + reasoning (⊆ output) overshot 100%.
  p.push(`<div class='panel'><h2>${esc(tr('h_cc_tokens'))}</h2>`)
  const cccomp = tokenComposition(cc.tokens, 'claude')
  p.push(barRow(tr('bar_cache_read'), cccomp.cacheRead, cccomp.total))
  p.push(barRow(tr('bar_output'), cccomp.output, cccomp.total))
  p.push(barRow(tr('bar_cache_create'), cccomp.cacheCreate, cccomp.total))
  p.push(barRow(tr('bar_fresh_input'), cccomp.fresh, cccomp.total))
  p.push('</div>')
  p.push(`<div class='panel'><h2>${esc(tr('h_cx_tokens'))}</h2>`)
  const cxcomp = tokenComposition(cx.tokens, 'codex')
  p.push(barRow(tr('bar_cached_input'), cxcomp.cacheRead, cxcomp.total))
  p.push(barRow(tr('bar_fresh_input'), cxcomp.fresh, cxcomp.total))
  p.push(barRow(tr('bar_output'), cxcomp.output, cxcomp.total))
  if (cxcomp.reasoning) {
    const rpct = cxcomp.output ? ((cxcomp.reasoning / cxcomp.output) * 100).toFixed(0) : '0'
    p.push(`<p class='muted'>${esc(tr('cx_reasoning_note', { n: comma(cxcomp.reasoning), pct: rpct }))}</p>`)
  }
  p.push('</div></section>')
```

with:

```js
  // token composition per platform — 按在场平台渲染（ADR 0042）
  p.push(`<section class='${both ? 'grid2' : ''}'>`)
  // Both panels use disjoint buckets that sum to total (ADR 0024). For Codex this fixes the old
  // double-count where input (incl cached) + cached + reasoning (⊆ output) overshot 100%.
  if (hasCc) {
    p.push(`<div class='panel'><h2>${esc(tr('h_cc_tokens'))}</h2>`)
    const cccomp = tokenComposition(cc.tokens, 'claude')
    p.push(barRow(tr('bar_cache_read'), cccomp.cacheRead, cccomp.total))
    p.push(barRow(tr('bar_output'), cccomp.output, cccomp.total))
    p.push(barRow(tr('bar_cache_create'), cccomp.cacheCreate, cccomp.total))
    p.push(barRow(tr('bar_fresh_input'), cccomp.fresh, cccomp.total))
    p.push('</div>')
  }
  if (hasCx) {
    p.push(`<div class='panel'><h2>${esc(tr('h_cx_tokens'))}</h2>`)
    const cxcomp = tokenComposition(cx.tokens, 'codex')
    p.push(barRow(tr('bar_cached_input'), cxcomp.cacheRead, cxcomp.total))
    p.push(barRow(tr('bar_fresh_input'), cxcomp.fresh, cxcomp.total))
    p.push(barRow(tr('bar_output'), cxcomp.output, cxcomp.total))
    if (cxcomp.reasoning) {
      const rpct = cxcomp.output ? ((cxcomp.reasoning / cxcomp.output) * 100).toFixed(0) : '0'
      p.push(`<p class='muted'>${esc(tr('cx_reasoning_note', { n: comma(cxcomp.reasoning), pct: rpct }))}</p>`)
    }
    p.push('</div>')
  }
  p.push('</section>')
```

(vii) Guard the behavior section. Replace:

```js
  // symmetric behavior panels (tools / git / languages / repos / hours)
  p.push(`<section><h2 class='section-h'>${esc(tr('h_behavior_section'))}</h2>` + "<div class='grid2'>")
  p.push(behaviorPanel(cc.behavior, '#0f766e', 'Claude Code'))
  p.push(behaviorPanel(cx.behavior, '#b45309', 'Codex'))
  p.push('</div></section>')
```

with:

```js
  // symmetric behavior panels (tools / git / languages / repos / hours) — 按在场平台渲染（ADR 0042）
  p.push(`<section><h2 class='section-h'>${esc(tr('h_behavior_section'))}</h2>` + `<div class='${both ? 'grid2' : ''}'>`)
  if (hasCc) p.push(behaviorPanel(cc.behavior, '#0f766e', 'Claude Code'))
  if (hasCx) p.push(behaviorPanel(cx.behavior, '#b45309', 'Codex'))
  p.push('</div></section>')
```

(viii) Guard the episode section. Replace:

```js
  // per-turn episode analysis (ADR 0032/0034): autonomy / spirals / task mix / deepest pit
  p.push(`<section><h2 class='section-h'>${esc(tr('h_episode_section'))}</h2>` + "<div class='grid2'>")
  p.push(episodePanel(cc.episode_summary, 'Claude Code'))
  p.push(episodePanel(cx.episode_summary, 'Codex'))
  p.push('</div></section>')
```

with:

```js
  // per-turn episode analysis (ADR 0032/0034) — 按在场平台渲染（ADR 0042）
  p.push(`<section><h2 class='section-h'>${esc(tr('h_episode_section'))}</h2>` + `<div class='${both ? 'grid2' : ''}'>`)
  if (hasCc) p.push(episodePanel(cc.episode_summary, 'Claude Code'))
  if (hasCx) p.push(episodePanel(cx.episode_summary, 'Codex'))
  p.push('</div></section>')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/render-single-platform.test.ts`
Expected: PASS (Claude-only, Codex-only, dual).

Confirm no regression in the existing render/i18n tests (they use dual data, which is unchanged):
Run: `npx vitest run test/i18n-report.test.ts test/merge-extras.test.ts test/token-display.test.ts test/scorecard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ccoach-insight/scripts/render_dual_platform.mjs skills/ccoach-insight/references/report-copy.json test/render-single-platform.test.ts
git commit -m "feat(skill): render single platform when host-scoped; gate comparison + rebrand title (ADR 0042)"
```

---

## Task 4: SKILL.md + openai.yaml — host-aware workflow

**Files:**
- Modify: `skills/ccoach-insight/SKILL.md` (frontmatter `description`/`when_to_use`; `## Workflow` section)
- Modify: `skills/ccoach-insight/agents/openai.yaml` (`default_prompt`)

No automated test (prose). Verification is a read-through + a grep gate in Step 4.

- [ ] **Step 1: Reword the frontmatter description**

In `skills/ccoach-insight/SKILL.md`, replace the `description:` line (line 3) with:

```yaml
description: Generate an enriched HTML report of your local AI coding usage. By DEFAULT it reports the platform you're running in (Claude Code if invoked from Claude Code, Codex if invoked from Codex); the dual-platform comparison is opt-in (ask to "compare" or for "both"). Tokens & models come from `ccoach report --json` (offline local parse); cost is computed from official online prices the agent looks up per model. Use when the user wants a deeper AI-written review of how they use Claude Code or Codex — cost, token, cache, model and active-hours breakdown, habits analysis, project-by-project recommendations, high-token project/session drilldown, or a richer HTML dashboard than the raw text/JSON reports.
```

- [ ] **Step 2: Reword `when_to_use`**

Replace the `when_to_use:` line (line 4) with:

```yaml
when_to_use: 'Trigger when the user wants to review, analyze, or visualize their local AI coding usage — for example "how much did I spend", "how much did I use AI today", "generate an AI usage report", "build an HTML dashboard of my usage", "which projects burned the most tokens", "review my most expensive sessions", "analyze my AI coding habits", or an explicit /ccoach-insight invocation. By DEFAULT report the host platform (the one this skill is invoked from). Trigger the DUAL-platform comparison ONLY when the user explicitly asks to compare ("compare my Claude Code vs Codex usage", "both platforms", "dual report").'
```

- [ ] **Step 3: Insert the host-aware Step 0 and reframe the workflow**

In the `## Workflow` section, immediately under the `## Workflow` heading and BEFORE `### Daily dual-platform report`, insert this new subsection:

```markdown
### Step 0 — pick the platform (host-aware default)

Decide which platform(s) to report, in this priority order:

1. **Explicit user request wins.** If the user names a platform ("my Codex usage", "Claude Code report") → that single platform. If they ask to **compare / both / dual** ("compare Claude Code vs Codex", "both platforms") → run the **Dual-platform comparison (opt-in)** flow below.
2. **Otherwise detect the host platform** you are running in:

   ```sh
   PLAT=$([ -n "$CLAUDECODE" ] && echo claude-code || echo codex)
   ```

   `CLAUDECODE` is set by Claude Code and absent under Codex. Report that single platform. (You also know your own host; the env probe is the deterministic primary.)
3. **If the host is indeterminate** (no `CLAUDECODE` and not recognizably Codex — e.g. another harness or a pipe), **ASK the user** which to generate: **① Claude Code ② Codex ③ dual comparison**, then proceed.

Let `<P>` be the chosen single platform (`claude-code` or `codex`). The **default report** below covers `<P>` only; `merge_dual_platform.mjs` now accepts a single `--cc-report` OR `--codex-report` and renders one panel with no comparison section. Only the explicit **Dual-platform comparison (opt-in)** path runs both platforms.
```

Then rename the existing `### Daily dual-platform report` heading to:

```markdown
### Default report (single platform `<P>`)
```

Within that renamed section, change step 2 (the two `ccoach report` lines) so only `<P>` is generated:

Replace:

```markdown
2. Generate **both platform reports** from ccoach (offline local parse; same `<W>`/`<L>`):
   - `ccoach report --platform codex <W> <L> --json > /tmp/codex-usage-report.json`
   - `ccoach report --platform claude-code <W> <L> --json > /tmp/claude-report.json`
```

with:

```markdown
2. Generate the **host platform report** from ccoach (offline local parse; same `<W>`/`<L>`):
   - `ccoach report --platform <P> <W> <L> --json > /tmp/<P>-report.json`
   - (Only the **Dual-platform comparison (opt-in)** path runs BOTH `--platform codex` and `--platform claude-code`.)
```

In step 3 (top Claude sessions) prepend the guard "When `<P>` = claude-code:". In step 4 (merge), replace the merge command so it passes only the matching report flag:

Replace the step-4 merge bullet:

```markdown
   - `node ${CLAUDE_SKILL_DIR}/scripts/merge_dual_platform.mjs --cc-report /tmp/claude-report.json --cc-sessions /tmp/cc-sessions.json --codex-report /tmp/codex-usage-report.json <L> --output /tmp/ai-usage.json`
```

with:

```markdown
   - Single platform (default): pass only the matching report flag —
     `node ${CLAUDE_SKILL_DIR}/scripts/merge_dual_platform.mjs --<P>-report /tmp/<P>-report.json [--cc-sessions /tmp/cc-sessions.json] <L> --output /tmp/ai-usage.json` (use `--cc-report` when `<P>=claude-code`, `--codex-report` when `<P>=codex`; `--cc-sessions` only applies to claude-code).
   - Dual comparison (opt-in): pass BOTH — `--cc-report /tmp/claude-report.json --cc-sessions /tmp/cc-sessions.json --codex-report /tmp/codex-usage-report.json`.
```

Finally, rename the existing `### Single-platform fallback` heading to `### Dual-platform comparison (opt-in)` and update its first sentence to read:

```markdown
Run this ONLY when the user explicitly asks to compare platforms. Generate BOTH reports (step 2 for `--platform claude-code` and `--platform codex`), pass both `--cc-report` and `--codex-report` to `merge_dual_platform.mjs`, then price/scorecard/render as usual — the renderer shows both panels plus the head-to-head comparison. The Codex-only enriched fallback (`render_enriched_codex_report.mjs`) remains available for a Codex-only deep report.
```

(Keep the remaining bullet about `render_enriched_codex_report.mjs` / Node-missing / never substituting `stats-cache.json`.)

- [ ] **Step 4: Update `agents/openai.yaml` default_prompt + verify**

In `skills/ccoach-insight/agents/openai.yaml`, change `default_prompt` to:

```yaml
  default_prompt: "Generate an enriched AI usage HTML report for my current platform (today) with deep insights and high-token project drilldowns."
```

Verify the SKILL.md edits landed and are internally consistent:

Run: `grep -n 'CLAUDECODE' skills/ccoach-insight/SKILL.md && grep -n 'Step 0 — pick the platform' skills/ccoach-insight/SKILL.md && grep -n 'Dual-platform comparison (opt-in)' skills/ccoach-insight/SKILL.md`
Expected: each grep prints a matching line (probe present, Step 0 present, opt-in dual section present).

Run the full suite to confirm nothing else regressed:
Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ccoach-insight/SKILL.md skills/ccoach-insight/agents/openai.yaml
git commit -m "docs(skill): host-aware Step 0, single-platform default, dual opt-in (ADR 0042)"
```

---

## Task 5: ADR 0042 + PRD + TODO

**Files:**
- Create: `docs/adr/0042-skill-host-platform-default.md`
- Modify: `docs/PRD.md`, `docs/TODO.md`

- [ ] **Step 1: Write ADR 0042**

Create `docs/adr/0042-skill-host-platform-default.md`:

```markdown
# ADR 0042 — ccoach-insight 默认出宿主平台报告，双平台对比转 opt-in

> 状态：已接受 · 日期：2026-06-06
> · 收敛 [`adr/0011-multi-platform-usage-sources.md`](../../adr/0011-multi-platform-usage-sources.md) 的「Codex 与 Claude Code 对称、一等数据源」——对称不等于每次都并排
> · 沿用 [`adr/0025-report-skeleton-i18n-default-english.md`](../../adr/0025-report-skeleton-i18n-default-english.md) 的报告骨架 i18n（默认英文、逐键回退）
> · 不放宽 [`adr/0016-error-signals-derived-tool-result-reading.md`](../../adr/0016-error-signals-derived-tool-result-reading.md) / [`adr/0017-derived-non-content-signals.md`](../../adr/0017-derived-non-content-signals.md) 的隐私红线

## 背景

`ccoach-insight` 的默认工作流一直**同时**生成 Claude Code + Codex 双平台报告。双平台对比曾作卖点，
但 Codex 与 Claude Code 的模型/harness 风格差异大，强行并排信息过载；多数用户只用其中一个平台，
双栏反而稀释了「当前平台」的信号。

## 决策

1. **默认出「宿主平台」单报告**：skill 被调用时，按优先级解析目标平台——
   (1) 用户显式点名平台/对比 → 照办；
   (2) 否则探测宿主：`CLAUDECODE` 环境变量在 → `claude-code`，不在 → `codex`；
   (3) 宿主无法判定 → 向用户提问（① Claude Code ② Codex ③ 双平台对比）。
2. **双平台对比转 opt-in**：仅当用户显式要求「对比 / both / dual」时，才生成两平台并渲染 head-to-head 对比。
3. **实现走「N 面板」泛化**（不新增渲染器）：`merge_dual_platform.mjs` 接受单个 `--cc-report` 或
   `--codex-report`（≥1）；`render_dual_platform.mjs` 按 `platforms{}` 在场平台渲染、单平台隐藏对比区 +
   缺席面板；`scorecard.mjs` 评宿主平台（`claude_code ?? codex`，dual 时仍取 Claude，行为不变）。
4. **品牌化标题**：报告 H1 统一为 `ccoach Insight Report` / `ccoach 洞察报告`，平台范围走副标题
   （`Claude Code` / `Codex` / `Claude Code + Codex`）。

## 隐私

探测仅读取一个布尔型环境变量（`CLAUDECODE` 是否存在），不读取任何内容，不外发。
ADR 0015/0016/0017 的全部红线不变（绝不读 assistant/thinking/system·developer prompt/文件内容；
派生信号仍只留数值/白名单标签；写入前脱敏截断）。

## 影响

- CLI 零改动（`--platform claude-code|codex|all` 已足够）。
- `apply_pricing.mjs` 已按 `Object.values(platforms)` 遍历，天然容忍单平台。
- `render_enriched_codex_report.mjs` 保留为既有 Codex-only 深度 fallback；本期不退役（要退役另起一篇）。
```

- [ ] **Step 2: Update PRD**

In `docs/PRD.md`, find the section describing the `ccoach-insight` skill / report output and add this bullet (place it under the skill/report description):

```markdown
- **默认出宿主平台报告（ADR 0042）**：skill 默认只分析「当前调用它的平台」（Claude Code → CC 报告，Codex → Codex 报告），
  双平台对比为显式 opt-in（用户说「对比 / both / dual」才出两栏）。宿主无法判定时向用户提问。探测仅读 `CLAUDECODE` 布尔，隐私红线不变。
```

- [ ] **Step 3: Update TODO**

In `docs/TODO.md`, add a completed entry near the other skill tasks:

```markdown
- [x] **宿主平台默认（ADR 0042）**：`ccoach-insight` 默认出当前宿主平台单报告（`CLAUDECODE` 探测 + 无法判定时提问），
      双平台对比转 opt-in；`merge`/`render`/`scorecard` 泛化为「N 面板」，标题品牌化为 `ccoach Insight Report` / `ccoach 洞察报告`。
      回归 `test/merge-single-platform.test.ts` / `test/render-single-platform.test.ts` + scorecard host 用例。
```

- [ ] **Step 4: Run docs lint**

Run: `node tools/check_adrs.mjs`
Expected: `docs lint OK: ADR numbering/status valid, all relative links resolve.`

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0042-skill-host-platform-default.md docs/PRD.md docs/TODO.md
git commit -m "docs: record host-platform-default decision (ADR 0042) + PRD/TODO"
```

---

## Task 6: Final verification

**Files:** none (verification gate)

- [ ] **Step 1: Build the CLI**

Run: `npm run build`
Expected: `tsc` completes with no errors (these changes are skill-side + tests, but build must stay green).

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests + the 3 new/extended ones (`merge-single-platform`, `render-single-platform`, scorecard host case).

- [ ] **Step 3: Run docs lint**

Run: `node tools/check_adrs.mjs`
Expected: `docs lint OK`.

- [ ] **Step 4: Manual smoke (optional but recommended)**

From the ccoach repo, build then generate a single-platform report end to end and eyeball it:

```sh
node dist/cli.js report --platform claude-code --json > /tmp/cc.json
node skills/ccoach-insight/scripts/merge_dual_platform.mjs --cc-report /tmp/cc.json --output /tmp/ai-usage.json
node skills/ccoach-insight/scripts/scorecard.mjs --data /tmp/ai-usage.json --lang en --output /tmp/sc.json
echo '{"executive_summary":"smoke","insights":[],"recommendations":[]}' > /tmp/ins.json
node skills/ccoach-insight/scripts/render_dual_platform.mjs --data /tmp/ai-usage.json --insights /tmp/ins.json --scorecard /tmp/sc.json --lang en --output /tmp/single.html
grep -c 'Platform Comparison' /tmp/single.html   # expect 0
grep -c '<h2>Codex</h2>' /tmp/single.html         # expect 0
grep -c 'ccoach Insight Report' /tmp/single.html  # expect 1
```

Expected: comparison + Codex panel absent (0), branded title present (1).

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-06-host-platform-default-design.md`):
- §1 行为规则 (explicit > host detect > ask) → Task 4 Step 0.
- §2 宿主探测 (`CLAUDECODE` probe) → Task 4 Step 0.
- §3 默认工作流单平台 → Task 4 Step 3.
- §4 merge 单平台 → Task 1.
- §5 renderer N 面板 + 隐藏对比 + 标题 → Task 3.
- §6 scorecard host 泛化 → Task 2.
- §6.4 i18n report-copy keys → Task 3 Steps 3a/3b.
- §8 frontmatter + openai.yaml → Task 4 Steps 1/2/4.
- §9 ADR 0042 + PRD + TODO → Task 5.
- §10 tests (merge/render/scorecard/privacy) → Tasks 1/2/3 + existing privacy suite via Task 6.

**Type/name consistency:** `hasCc`/`hasCx`/`both`/`scope` defined once in `render()` (Task 3 (i)) and used in (ii)-(viii). Merge `combined.total_sessions` fallback (`claude?.sessions ?? codex?.behavior?.sessions ?? 0`) is consistent with the Task 2 scorecard expectation (Codex-only → 8). `report_subtitle_scope` / `m_active_days` keys added in Task 3a/3b match the `tr(...)` calls in Task 3c (ii)/(iii).

**No indeterminate-host automation:** Step 0 case 3 asks the user (per spec §1.3) rather than silently defaulting.
