# Scorecard Honesty + Prompt-Counting Noise Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ccoach's report honest and legible — stop counting machine-injected records as user "rounds", rename the misleading Prompt-axis tiers to match their real signal, let the model compose the persona title, and explain episode/spiral/file-reference in plain language.

**Architecture:** Five independent workstreams from the spec (`docs/superpowers/specs/2026-06-06-scorecard-honesty-prompt-counting-design.md`). The CLI fix (A) is a parser-level filter at the single prompt/episode counting site. The scorecard changes (C/D) are copy-table + skill-guidance edits — the deterministic tier *scores* are untouched; only names, roasts, and the model-written title change. The glossary (E) adds user-facing i18n strings + skill guidance.

**Tech Stack:** TypeScript (CLI, `src/`), vitest (`test/`), Node ESM `.mjs` (skill scripts), JSON copy tables, Markdown docs/ADRs.

---

## File Structure

| File | Responsibility | Workstream |
|---|---|---|
| `src/parsers/claude-code.ts` | Add `isHumanPrompt()`; gate prompt/episode counting on it | A |
| `test/fixtures/claude-noise/session.jsonl` | New fixture: 1 real instruction + isMeta/command-stub/interrupt noise | A |
| `test/claude-noise.test.ts` | Assert noise excluded, real instruction counted | A |
| `src/parsers/codex.ts` | Audit + clarifying comment (no isMeta-equivalent noise) | A |
| `docs/adr/0043-prompt-episode-counting-excludes-injected-records.md` | Record the counting-口径 decision | A |
| `skills/ccoach-insight/references/scorecard-copy.json` | Rename Prompt tiers + honest roasts | C |
| `test/scorecard-copy.test.ts` | Assert new names + no banned strings | C |
| `skills/ccoach-insight/scripts/scorecard.mjs` | Document `title` as fallback | D |
| `src/i18n.ts` | Add episode/spiral plain-language note strings (en+zh) | E |
| `src/emit/text.ts` | Print the episode/spiral notes | E |
| `test/text.test.ts` | Assert notes render | E |
| `skills/ccoach-insight/SKILL.md` | Ban "N rounds"; persona-title guidance; file-ref "why"; episode/spiral framing | B/D/E |
| `skills/ccoach-insight/references/session-prompt-review.md` | File-ref "why" framing; ban rounds phrasing | B/E |

---

## Task 1: CLI — filter machine-injected `user` records [A]

**Files:**
- Modify: `src/parsers/claude-code.ts` (constants near `CORRECTION_RE` at line 34; counting site at lines 161-168)
- Create: `test/fixtures/claude-noise/session.jsonl`
- Create: `test/claude-noise.test.ts`

- [ ] **Step 1: Create the noise fixture**

Create `test/fixtures/claude-noise/session.jsonl` with exactly these 5 lines (each line is one JSON object; no trailing blank line matters):

```jsonl
{"type":"user","timestamp":"2026-06-02T03:00:00.000Z","sessionId":"s1","cwd":"/home/u/ccoach","uuid":"u-real","message":{"role":"user","content":"please refactor src/parser.ts and must keep existing tests"}}
{"type":"assistant","timestamp":"2026-06-02T03:00:00.500Z","sessionId":"s1","cwd":"/home/u/ccoach","requestId":"r1","message":{"id":"m1","role":"assistant","usage":{"input_tokens":10,"output_tokens":20},"content":[{"type":"text","text":"ok"}]}}
{"type":"user","timestamp":"2026-06-02T03:00:01.000Z","sessionId":"s1","cwd":"/home/u/ccoach","isMeta":true,"uuid":"u-meta","message":{"role":"user","content":"<system-reminder>background context that is not a user instruction</system-reminder>"}}
{"type":"user","timestamp":"2026-06-02T03:00:02.000Z","sessionId":"s1","cwd":"/home/u/ccoach","uuid":"u-cmd","message":{"role":"user","content":"<command-name>/clear</command-name><command-message>clear</command-message>"}}
{"type":"user","timestamp":"2026-06-02T03:00:03.000Z","sessionId":"s1","cwd":"/home/u/ccoach","uuid":"u-int","message":{"role":"user","content":"[Request interrupted by user]"}}
```

Rationale: pre-fix the parser counts all 4 `user` text records as prompts (=4). Post-fix only `u-real` counts (=1). The assistant token record makes the real instruction's episode non-empty so `episodes === 1`.

- [ ] **Step 2: Write the failing test**

Create `test/claude-noise.test.ts`:

```ts
// test/claude-noise.test.ts
import { describe, it, expect } from 'vitest'
import { parseClaudeCode } from '../src/parsers/claude-code.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('parseClaudeCode — machine-injected user records are not prompts/episodes', () => {
  it('only the real instruction counts; isMeta / command-stub / interrupt are excluded', () => {
    const r = parseClaudeCode('test/fixtures/claude-noise', window)
    expect(r.prompt_signals.prompts).toBe(1) // not 4
    expect(r.episode_summary?.episodes).toBe(1) // the one real instruction, with token activity
  })

  it('the excluded records leave no raw text in the JSON', () => {
    const j = JSON.stringify(parseClaudeCode('test/fixtures/claude-noise', window))
    expect(j).not.toContain('system-reminder')
    expect(j).not.toContain('command-name')
    expect(j).not.toContain('Request interrupted')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/claude-noise.test.ts`
Expected: FAIL — `prompt_signals.prompts` is `4`, not `1` (isMeta/stub/interrupt currently counted).

- [ ] **Step 4: Add the constants + predicate**

In `src/parsers/claude-code.ts`, immediately after the `CORRECTION_RE` definition (line 34), add:

```ts
// 机器注入的 "user 角色" 记录不是真人指令，不算一条 prompt / 一个 episode 边界（ADR 0043）。
// 纯结构标记 + 固定字面哨兵；text 仅瞬时用于匹配，绝不存储（守 ADR 0015/0016 红线）。
const COMMAND_STUB_RE = /<\/?(command-name|command-message|command-args|local-command-stdout|local-command-stderr)>/i
const INTERRUPT_RE = /\[Request interrupted by user/i
function isHumanPrompt(rec: any, text: string): boolean {
  if (rec?.isMeta === true) return false // 系统提醒 / caveat / 命令输出注入（最大噪声源）
  if (COMMAND_STUB_RE.test(text)) return false // slash 命令桩
  if (INTERRUPT_RE.test(text)) return false // 中断哨兵（interrupted 信号另由 toolUseResult.interrupted 派生，互不影响）
  return text.trim().length > 0
}
```

- [ ] **Step 5: Gate the counting site on the predicate**

In `src/parsers/claude-code.ts`, change the block at lines 164-168 from:

```ts
    const text = userText(rec.message)
    if (text) {
      // 用户 prompt = 一个新回合的边界（ADR 0032 D2）；纠错词命中则把上一回合标记为 corrected。
      agg.beginEpisode(session, repo, ts, CORRECTION_RE.test(text))
      agg.applyPrompt(text)
    }
```

to:

```ts
    const text = userText(rec.message)
    if (text && isHumanPrompt(rec, text)) {
      // 用户 prompt = 一个新回合的边界（ADR 0032 D2，口径见 0043：排除 isMeta/命令桩/中断）；
      // 纠错词命中则把上一回合标记为 corrected。
      agg.beginEpisode(session, repo, ts, CORRECTION_RE.test(text))
      agg.applyPrompt(text)
    }
```

Leave the error/rework/interrupt scanning below (lines 169-208) unchanged — it derives signals from `tool_result`/`toolUseResult` on the same record and is independent of prompt counting.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/claude-noise.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the existing parser + episode tests (no regressions)**

Run: `npx vitest run test/claude-code.test.ts test/episodes.test.ts test/scorecard.test.ts`
Expected: PASS (the existing `test/fixtures/claude` has no isMeta/stub/interrupt records, so its `prompts === 1` assertion is unchanged).

- [ ] **Step 8: Confirm token/cost unaffected**

Run: `npm run verify:ccusage`
Expected: PASS — this change touches only prompt/episode counting, never token/usage aggregation.

- [ ] **Step 9: Commit**

```bash
git add src/parsers/claude-code.ts test/fixtures/claude-noise/session.jsonl test/claude-noise.test.ts
git commit -m "fix(parser): exclude isMeta/command-stub/interrupt records from prompt+episode counts

Machine-injected user-role records (isMeta system-reminders/caveats,
slash-command stubs, interrupt sentinels) were miscounted as user
prompts and episode boundaries, inflating 'rounds'. Gate counting on a
new isHumanPrompt() predicate (structural flags + fixed sentinels, no
content stored). Token/cost aggregation unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Audit Codex parser for symmetric noise [A]

**Files:**
- Modify: `src/parsers/codex.ts` (around the `turn_context` episode boundary, line 183-185)

- [ ] **Step 1: Inspect the Codex episode boundary**

Read `src/parsers/codex.ts` lines 180-199. Confirm: Codex episodes are bounded by `turn_context` records (not user messages), already guarded by `!sidechain && inWin(ts)`, and Codex rollouts have **no `isMeta` / command-stub / interrupt-text** concept (ADR 0041: Codex prompts are not read). Conclusion: no symmetric noise to filter.

- [ ] **Step 2: Add a clarifying comment**

In `src/parsers/codex.ts`, on the line at 184 (the `// 回合边界（ADR 0032 D2）…` comment), append a sentence documenting the audit:

```ts
            // 回合边界（ADR 0032 D2）：Codex 无用户消息记录，turn_context≈一次用户指令；无 corrected（不读 prompt，ADR 0041）。
            // 口径审计（ADR 0043）：Codex rollout 无 isMeta/命令桩/中断哨兵这类机器注入的 user 记录，turn_context 本身已是真实回合边界，无需对称过滤。
```

- [ ] **Step 3: Run Codex tests (no regressions)**

Run: `npx vitest run test/codex.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/parsers/codex.ts
git commit -m "docs(parser): note Codex has no injected-record noise to filter (ADR 0043)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: ADR — prompt/episode counting excludes injected records [A]

**Files:**
- Create: `docs/adr/0043-prompt-episode-counting-excludes-injected-records.md`

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0043-prompt-episode-counting-excludes-injected-records.md`:

```markdown
# 0043 — Prompt/Episode counting excludes machine-injected user records

状态：已采纳（2026-06-06）

## 背景

Claude Code 把多种**非真人指令**也记成 `type:user` 字符串记录：`isMeta:true` 的系统提醒 / caveat /
命令输出注入、slash 命令桩（`<command-name>` 等）、中断哨兵 `[Request interrupted by user]`。
旧实现（`claude-code.ts`）只挡了 sidechain 子代理，未挡这些——结构扫描显示某机器上 6330 条 `type:user`
里 1810 条是 `isMeta`，全被计为「一条 prompt / 一个 episode」，导致报告出现「追问 1515 轮」这类
**误导性口径**（虚高的「回合 / 提问数」）。

## 决策

「一条用户 prompt / 一个 episode 边界」**仅指真人下达的指令**。新增 `isHumanPrompt()` 谓词，排除：
`isMeta===true`、命令桩（`COMMAND_STUB_RE`）、中断哨兵（`INTERRUPT_RE`）。这是对 ADR 0032 D2
「用户 prompt = 回合边界」的口径收紧。

- 仅瞬时用 text 做布尔匹配即弃，**不存储 / 不外发原文**（守 ADR 0015/0016/0017 红线）。
- 与派生信号解耦：中断仍由 `toolUseResult.interrupted` 计入 interrupted 信号；本过滤只影响「是否算一条
  prompt / episode」，不动 token/用量聚合（`verify:ccusage` 不受影响）。
- 双平台对称（ADR 0011）：Codex rollout 无此类机器注入 user 记录，`turn_context` 本身即真实回合边界，
  无需对称过滤（见 `codex.ts` 注释）。

## 影响

- prompts / episodes 计数回归「真人指令数」；skill 报告随之改话术（禁用「追问 N 轮」，见 SKILL.md）。
- `--json` 字段结构不变，仅数值更准（不破坏契约，ADR 0004/0010）。
```

- [ ] **Step 2: Validate ADR numbering**

Run: `node tools/check_adrs.mjs`
Expected: PASS (0043 is the next sequential number after 0042).

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0043-prompt-episode-counting-excludes-injected-records.md
git commit -m "docs(adr): 0043 prompt/episode counting excludes injected user records

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rename Prompt-axis tiers + honest roasts [C]

**Files:**
- Modify: `skills/ccoach-insight/references/scorecard-copy.json` (the `axes.prompt.tiers` array, lines 32-40)
- Create: `test/scorecard-copy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/scorecard-copy.test.ts`:

```ts
// test/scorecard-copy.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const copy = JSON.parse(readFileSync('skills/ccoach-insight/references/scorecard-copy.json', 'utf8'))

describe('scorecard copy — Prompt-axis tiers are renamed and honest', () => {
  it('Prompt tier names match the agreed xianxia (zh) / AI-meme (en) ladder', () => {
    const tiers = copy.axes.prompt.tiers
    expect(tiers.map((t: any) => t.zh_name)).toEqual(['渡劫飞升', '结丹有成', '筑基初成', '卡瓶颈', '伪灵根'])
    expect(tiers.map((t: any) => t.en_name)).toEqual(['One-Shot', 'Locked In', 'Mid', 'Vibe Coder', 'Manifesting'])
  })

  it('no copy text claims unmeasured "repetition" (the old Broken Record bug)', () => {
    const blob = JSON.stringify(copy)
    expect(/复读机|Broken Record|reworded|改写了好几轮|repeat/i.test(blob)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/scorecard-copy.test.ts`
Expected: FAIL — current names are `复读机`/`Broken Record`, and the idx3 roast contains `改写了好几轮`/`reworded`.

- [ ] **Step 3: Replace the Prompt tiers**

In `skills/ccoach-insight/references/scorecard-copy.json`, replace the entire `"prompt"` block's `tiers` array (lines 33-39) with:

```json
      "tiers": [
        {"zh_name": "渡劫飞升", "en_name": "One-Shot", "zh_roast": "结构清晰、带约束、点名文件——需求一次说清，几乎不返工", "en_roast": "Structured, constrained, file-anchored — the ask lands in one pass."},
        {"zh_name": "结丹有成", "en_name": "Locked In", "zh_roast": "方向准，偶尔补一句收尾", "en_roast": "On target — just the occasional follow-up to tidy up."},
        {"zh_name": "筑基初成", "en_name": "Mid", "zh_roast": "能说清楚，准头和篇幅还能再收一点", "en_roast": "Clear enough — aim and length could tighten up."},
        {"zh_name": "卡瓶颈", "en_name": "Vibe Coder", "zh_roast": "结构和约束偏少，常常边问边改", "en_roast": "Light on structure and constraints — lots of fixing as you go."},
        {"zh_name": "伪灵根", "en_name": "Manifesting", "zh_roast": "prompt 又短又松散，细节多靠 AI 推断", "en_roast": "Short, loosely-structured prompts — much is left for the AI to infer."}
      ]
```

Do NOT touch the `spending`, `engineering`, or `diligence` blocks (user decision: only the Prompt axis changes).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/scorecard-copy.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the scorecard regression (still green)**

Run: `npx vitest run test/scorecard.test.ts`
Expected: PASS (it asserts `toBeTruthy()` + zh≠en tiers, both still hold).

- [ ] **Step 6: Commit**

```bash
git add skills/ccoach-insight/references/scorecard-copy.json test/scorecard-copy.test.ts
git commit -m "feat(scorecard): rename Prompt tiers to honest xianxia/AI-meme ladder

'Broken Record' claimed repetition the axis never measures (violating
the copy's own grounding rule). Renamed to 渡劫飞升/结丹有成/筑基初成/卡瓶颈/伪灵根
(One-Shot/Locked In/Mid/Vibe Coder/Manifesting) with roasts grounded
only in measured signals (structure/constraint/file-ref/correction).
Other three axes unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Document `title` as a fallback (model composes the persona) [D]

**Files:**
- Modify: `skills/ccoach-insight/scripts/scorecard.mjs` (line 187-188)

- [ ] **Step 1: Update the comment + keep the field as fallback**

In `skills/ccoach-insight/scripts/scorecard.mjs`, change lines 187-188 from:

```js
    // placeholder composite title; the model may rewrite into a sentence
    title: names.join(' × '),
```

to:

```js
    // FALLBACK ONLY: deterministic `A × B × C × D` join for non-LLM / JSON consumers.
    // The shareable persona title is MODEL-WRITTEN at report time from axes[] (ADR 0008 D3);
    // see SKILL.md "compose the persona title". Do not present this raw join as the final title.
    title: names.join(' × '),
```

- [ ] **Step 2: Verify scorecard still builds**

Run: `node skills/ccoach-insight/scripts/scorecard.mjs --data test/fixtures/scorecard/merged.json --lang en 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);if(!o.title)process.exit(1);console.log('title fallback ok:',o.title)})"`
Expected: prints `title fallback ok: …`. (If `test/fixtures/scorecard/merged.json` is named differently, list `test/fixtures/scorecard/` and use the merged JSON fixture there.)

- [ ] **Step 3: Run scorecard tests**

Run: `npx vitest run test/scorecard.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/ccoach-insight/scripts/scorecard.mjs
git commit -m "refactor(scorecard): mark title join as fallback; persona title is model-written

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CLI glossary — plain-language episode & spiral notes [E]

**Files:**
- Modify: `src/i18n.ts` (EN block near line 100; ZH block near line 183)
- Modify: `src/emit/text.ts` (episode block, lines 164-176)
- Modify: `test/text.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/text.test.ts` (inside the existing top-level `describe`, or append a new `describe`). First read the file to mirror its render-helper usage; then add:

```ts
import { describe, it, expect } from 'vitest'
import { renderText } from '../src/emit/text.js'
import { setLang } from '../src/i18n.js'

describe('text emit — episode/spiral plain-language notes', () => {
  const base: any = {
    tokens: { input: 0, cached_input: 0, output: 0, reasoning_output: 0, cache_creation: 0, total: 0 },
    rework_signals: { edits: 0, user_modified: 0, user_modified_rate: 0, lines_added: 0, lines_removed: 0 },
    episode_summary: {
      episodes: 3, autonomy_rate: 0.5, interrupted_rate: 0, corrected_rate: 0,
      intervention_style: 'balanced', spiral_episodes: 2, task_mix: {}, deepest_pit: undefined,
    },
  }
  it('prints the episode definition note and (when spirals>0) the spiral note', () => {
    setLang('en')
    const out = renderText(base as any)
    expect(out).toContain('one instruction you gave')
    expect(out).toContain('got stuck')
  })
})
```

Note: confirm the exported render function name in `src/emit/text.ts` (e.g. `renderText`) by reading the file's `export` line, and match the existing test's call shape (the file already has `test/text.test.ts`; reuse its import + the minimal report object it builds).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/text.test.ts`
Expected: FAIL — the note strings are not emitted yet.

- [ ] **Step 3: Add the i18n strings**

In `src/i18n.ts`, in the **EN** block, after the line `tx_episode_deepest: 'deepest pit: {type} · severity {sev} · {tok} token',` add:

```ts
  tx_episodes_note: 'An episode = one instruction you gave → the work the agent did for it; the next instruction starts the next episode.',
  tx_spiral_note: 'Spirals = episodes where the agent got stuck (same file re-edited, repeated errors, no progress). Costly — split the task, give sharper context, or give it a way to self-verify.',
```

In the **ZH** block, after the line `tx_episode_deepest: '最深的坑: {type} · 严重度 {sev} · {tok} token',` add:

```ts
  tx_episodes_note: '一个回合 = 你下的一条指令 → agent 为它做的事；下一条指令开启下一个回合。',
  tx_spiral_note: '绕圈 = agent 卡住打转的回合（反复改同一文件、连环报错、没进展）。很烧 token——拆小任务、给更明确上下文、或给它一个能自我验证的手段。',
```

- [ ] **Step 4: Print the notes in text.ts**

In `src/emit/text.ts`, inside the `if (ep && ep.episodes > 0) {` block, change it so the definition note prints right under the header and the spiral note prints only when spirals exist. Replace lines 165-176 with:

```ts
  const ep = r.episode_summary
  if (ep && ep.episodes > 0) {
    lines.push(t('tx_episodes_header'))
    lines.push('  ' + tf('tx_episodes_line', {
      n: ep.episodes, a: (ep.autonomy_rate * 100).toFixed(0), s: styleLabel(ep.intervention_style), sp: ep.spiral_episodes,
    }))
    lines.push('  ' + t('tx_episodes_note'))
    if (ep.spiral_episodes > 0) lines.push('  ' + t('tx_spiral_note'))
    const mix = Object.entries(ep.task_mix).sort((a, b) => b[1] - a[1]).slice(0, 3)
    if (mix.length) lines.push('  ' + t('tx_episode_taskmix') + mix.map(([k, v]) => `${k}(${Math.round(v * 100)}%)`).join(' '))
    if (ep.deepest_pit) lines.push('  ' + tf('tx_episode_deepest', { type: ep.deepest_pit.task_type, sev: ep.deepest_pit.severity, tok: comma(ep.deepest_pit.tokens) }))
    lines.push('')
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/text.test.ts`
Expected: PASS.

- [ ] **Step 6: Run i18n tests (key parity)**

Run: `npx vitest run test/i18n-cli.test.ts test/i18n-report.test.ts`
Expected: PASS — if a parity test asserts EN/ZH keys match, the two new keys exist in both blocks.

- [ ] **Step 7: Commit**

```bash
git add src/i18n.ts src/emit/text.ts test/text.test.ts
git commit -m "feat(report): plain-language episode + spiral notes in text output

Explain what an episode is, and that spirals are bad + what to do —
the glossary the report was missing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: SKILL.md — honest phrasing, persona title, file-ref "why" [B/D/E]

**Files:**
- Modify: `skills/ccoach-insight/SKILL.md`

This is a docs-only task (no unit test); each edit is a targeted insertion at a quoted anchor. Read the file first, then apply.

- [ ] **Step 1: Ban "N rounds" phrasing (B)**

Find the recommendations/insights guidance near line 88-90 (the bullet starting `- \`insights\` — a list…`). Immediately after the `insights` bullet, add:

```markdown
   - **Honest counting (ADR 0043):** the prompt count is "instructions you gave", NOT "rounds of asking". NEVER write "asked N rounds / 追问 N 轮 / 一口气问了 N 轮" — it implies repeatedly re-asking the same thing, which ccoach does not measure. For a heavy session say "this session ran N instructions and used X% of tokens" and pair it with the episode/spiral lens.
```

- [ ] **Step 2: Add persona-title guidance (D)**

Find the scorecard step near line 110 (the line `- Also write the personality-summary sentence yourself…`). Immediately after it, add:

```markdown
   - **Compose the persona title yourself (ADR 0008 D3).** `scorecard.json`'s `title` is a deterministic `A × B × C × D` fallback — do NOT present it raw. Write a short, witty persona handle from the four `axes[].tier` names (e.g. 渡劫飞升 + 富哥随意 + 架构师 + 劳模 → "随手烧钱的渡劫劳模"). Guardrails: stay faithful to the computed tiers, never exaggerate beyond them, never invent an axis, never quote prompt text. Write it in the report language.
```

- [ ] **Step 3: Add file-reference "why" + episode/spiral framing (E)**

Find the session-review fold-in bullet at line 94 (`- **By default, also run the Claude Code session prompt review**…`). Immediately after it, add:

```markdown
   - **Explain the "why", in plain language.** When recommending file references, say *why* it helps: naming `file_path:line_number` lets the agent jump straight to the right place instead of grepping the whole repo (saves tokens) and cuts "you edited the wrong file" reworks (Anthropic's context guidance: the fuller the context window, the worse quality gets). When the report mentions "episodes" or "spirals", define them in human terms: an episode = one instruction → the agent's work for it; a spiral = an episode where the agent got stuck (same file re-edited / repeated errors / no progress) — flag it as wasteful and suggest splitting the task, giving sharper context, or giving it a way to self-verify.
```

- [ ] **Step 4: Verify the edits landed and no banned phrasing remains**

Run: `grep -n "追问\|N rounds\|Compose the persona title\|file_path:line_number" skills/ccoach-insight/SKILL.md`
Expected: shows the new guidance lines; the only "追问" occurrence is the prohibition itself.

- [ ] **Step 5: Commit**

```bash
git add skills/ccoach-insight/SKILL.md
git commit -m "docs(skill): honest 'instructions not rounds', model-written persona title, file-ref/episode/spiral 'why'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: session-prompt-review.md — file-ref "why" + drop rounds phrasing [B/E]

**Files:**
- Modify: `skills/ccoach-insight/references/session-prompt-review.md`

Docs-only. Read the file first, then apply.

- [ ] **Step 1: Add the file-reference rationale**

Find the line `- Context: Did the prompt provide the repo, files, error, desired behavior, constraints, and examples needed for the agent to act?` (line 16). Immediately after it, add:

```markdown
- When prompts lack file anchors, recommend `file_path:line_number` references and **explain why in plain terms**: the agent jumps straight to the right place instead of searching the whole repo (saves tokens), and it cuts "edited the wrong file" reworks. Ground this in the measured `file_ref_ratio`, never in prompt text.
```

- [ ] **Step 2: Forbid the "rounds" framing**

Find the line `- What likely consumed tokens: ambiguity, repeated context loading, broad search, failed commands, rework, tool loops, or over-scoped asks.` (line 28). Immediately after it, add:

```markdown
- Describe prompt volume as "instructions given", never "rounds of asking" (ADR 0043). Do not imply the user re-asked the same thing — ccoach measures structure/constraint/file-ref/correction, not repetition.
```

- [ ] **Step 3: Verify**

Run: `grep -n "file_path:line_number\|instructions given\|ADR 0043" skills/ccoach-insight/references/session-prompt-review.md`
Expected: shows the two new blocks.

- [ ] **Step 4: Commit**

```bash
git add skills/ccoach-insight/references/session-prompt-review.md
git commit -m "docs(skill): session review — file-ref rationale, drop 'rounds' framing (ADR 0043)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full suite + acceptance check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS (all vitest specs).

- [ ] **Step 2: ccusage cross-check**

Run: `npm run verify:ccusage`
Expected: PASS.

- [ ] **Step 3: ADR lint**

Run: `node tools/check_adrs.mjs`
Expected: PASS.

- [ ] **Step 4: Acceptance — no banned strings survive anywhere**

Run: `grep -rn "复读机\|Broken Record\|reworded" src/ skills/ test/ docs/adr/`
Expected: NO matches (the spec/plan in `docs/superpowers/` may mention them as history; restrict the grep to the paths above).

- [ ] **Step 5: Acceptance — glossary + honest phrasing present**

Run: `grep -rn "one instruction you gave\|got stuck" src/i18n.ts && grep -n "instructions you gave\|Compose the persona title" skills/ccoach-insight/SKILL.md`
Expected: matches in both.

---

## Self-Review (completed)

- **Spec coverage:** A → Tasks 1-3; B → Tasks 7-8; C → Task 4; D → Tasks 5,7; E → Tasks 6,7,8. All five workstreams have tasks.
- **Placeholders:** none — every code/copy/doc step shows full content. Two doc tasks (7,8) say "read first" because they insert at quoted anchors in a large file; the inserted content is fully specified.
- **Type/name consistency:** `isHumanPrompt`, `COMMAND_STUB_RE`, `INTERRUPT_RE`, `tx_episodes_note`, `tx_spiral_note` are defined once and referenced consistently. New tier names match across copy edit (Task 4) and its test.
- **Open verification:** Task 5 Step 2 and Task 6 Step 1 ask the executor to confirm a fixture filename / exported function name by reading the file — these are real files in the repo, not placeholders.
