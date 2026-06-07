# ccoach-deepinsight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `ccoach-deepinsight` — a semantic root-cause deep-usage coach for Claude Code — as a skill backed by two small additive CLI data outputs.

**Architecture:** Boundary A (skill-first + minimal additive CLI). CLI gains one opt-in `ccoach digest` command (token-bounded, redacted assistant/tool_result content; no thinking) and a fix to the `sessions --id` substring bug. The skill orchestrates a two-pass flow (project-default → session-on-demand) with a grounding gate (never time-correlate a session to commits outside its `[first,last]` window) and a content verification gate (tight digest before high-confidence intent claims). Semantic root cause (read real code, read-only) leads; metrics are demoted to minor evidence.

**Tech Stack:** TypeScript + cac (CLI), vitest (TDD), Node ESM. Skill = `SKILL.md` + `references/*.md` + `scripts/*.mjs`. Docs = ADRs validated by `tools/check_adrs.mjs`.

**Where:** All work happens in the worktree `/Users/mac/workspace/ccoach-deepinsight` on branch `exp/deepinsight`. Run every command from that directory.

**Spec:** `docs/superpowers/specs/2026-06-07-deepinsight-design.md`.

---

### Task 0: Worktree deps + baseline green

**Files:** none (environment setup)

- [ ] **Step 1: Install deps in the worktree**

Run: `cd /Users/mac/workspace/ccoach-deepinsight && npm ci`
Expected: installs without error (worktree starts with no `node_modules`).

- [ ] **Step 2: Confirm baseline build + tests pass before any change**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all vitest suites PASS, `dist/cli.js` built. This is the green baseline every later task must preserve.

---

### Task 1: ADR 0048 — deep-insight two-pass flow + grounding gate

**Files:**
- Create: `docs/adr/0048-deepinsight-two-pass-grounding-gate.md`

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0048-deepinsight-two-pass-grounding-gate.md`:

```markdown
# ADR 0048 — deep-insight：两遍流（project→session）+ grounding gate + 内容验证闸

> 状态：已接受 · 日期：2026-06-07
> · 沿用 [`adr/0005-tiered-analysis-and-signals.md`](0005-tiered-analysis-and-signals.md) / [`adr/0006-feature-first-recommendations.md`](0006-feature-first-recommendations.md)
> · 复用 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md) / [`adr/0034-spiral-detection-deepest-pit-story.md`](0034-spiral-detection-deepest-pit-story.md)
> · 配套 [`adr/0049-ccoach-digest-optin-content.md`](0049-ccoach-digest-optin-content.md)

## 背景

`ccoach-insight` 是偏娱乐的统计成绩卡。用户需要一个**严肃的生产力/行为洞察工具** `ccoach-deepinsight`：
给出**语义根因 + 可执行解法**，让用户更有意识地驾驭 harness。真实实验（2026-06-07，三臂对照 +
三对抗审核）证明：**纯指标会自信地编造错误根因**——只看轨迹的臂对某会话断言"跑偏、活儿没做成"，
经 git+prompt 核验纯属幻觉（它把会话外 7–11 小时的提交错误关联了进来）。

## 决策

### D1 两遍流

- **Pass 1 · PROJECT（默认、便宜、不读正文）**：跨会话聚合定位系统性、改一次受益全局的根因，
  产出 ship-once 修复（如 `.claude/settings.json` PostToolUse hook、CLAUDE.md Commands block + 模块地图）。
- **Pass 2 · SESSION（spiral 命中 / 用户钻取）**：钻单个最深的坑，出单回合行为根因。

### D2 grounding gate（不可违反）

会话级"这回合在干嘛 / 活儿成没成 / 是否跑偏"的判断，**只锚定该会话自己的 prompt + 落在其
`[first,last]` 窗口内的提交**；**绝不跨窗口时间关联附近提交**。

### D3 内容验证闸

当会话根因取决于"意图"且要出 `confidence>=high` 时，**先花一笔 tight 正文摘要验证**（见 ADR 0049）。

### D4 指标降级 + 假阳性诚实

绕圈率/pass 率等指标只作**配角佐证**，绝不进根因正文当主语；敢明确说"这是健康工作、无需改"；
当某信号其实是工具自身仪表局限（如 task_mix 大量 unknown 是分型器未校准）须标注。

### D5 去重

两遍得出同一结论时只在 project 尺度说一次，session 尺度作实例引用，不逐会话重复唠叨。

## 后果

- skill 为主、CLI 仅加性（ADR 0049 + sessions bug 修复）；分工不破（CLI 出数据 / skill 出解读）。
- 隐私红线整体不放宽，唯一 opt-in 放宽见 ADR 0049。
- v1 仅 Claude Code、产出 markdown；HTML/Codex 对称留后。

## 开放问题

- OQ1 spiral 触发 Pass 2 的阈值与 top-N 选取，待真实数据校准。
- OQ2 pass 率是否值得未来做成跨回合按文件 churn 的 CLI 一等信号（v1 不做）。
```

- [ ] **Step 2: Validate ADR lint**

Run: `node tools/check_adrs.mjs`
Expected: passes (unique numbering, status field present, relative links resolve).

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0048-deepinsight-two-pass-grounding-gate.md
git commit -m "docs(adr): 0048 deep-insight two-pass flow + grounding gate"
```

---

### Task 2: ADR 0049 — `ccoach digest` opt-in redacted content

**Files:**
- Create: `docs/adr/0049-ccoach-digest-optin-content.md`

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0049-ccoach-digest-optin-content.md`:

```markdown
# ADR 0049 — `ccoach digest`：opt-in、token 受控的 redacted 正文摘要

> 状态：已接受 · 日期：2026-06-07
> · 延伸 [`adr/0018-cli-absorbs-collection-prompt-preview.md`](0018-cli-absorbs-collection-prompt-preview.md)（opt-in 单会话 redacted prompt 预览）
> · 落地 [`adr/0038-privacy-levels-two-stage-extract-analyze.md`](0038-privacy-levels-two-stage-extract-analyze.md)（隐私分级 / 两段式）
> · 配套 [`adr/0048-deepinsight-two-pass-grounding-gate.md`](0048-deepinsight-two-pass-grounding-gate.md)

## 背景

deep-insight 的"防幻觉验证闸"（ADR 0048 D3）需要读会话**正文**才能证伪"纯指标编造的根因"。
实验测得：单会话完整正文约 18.9 万 token（不可控）；**逐项截断 + 总量封顶**的摘要 tight ~7.5K /
rich ~30K token 即拿到约 9 成价值。

## 决策

### D1 新增 `ccoach digest` 命令（opt-in）

按时间序产出**单个具名会话**的 **assistant 文本回复 + 工具输入 + tool_result 正文**摘要，
**逐项截断 + 总量封顶**、复用 `redact()` 脱敏。**绝不含 thinking / system·developer prompt /
文件内容做内容用途**。命令本身即显式 opt-in，且**必须 `--id` 指定单会话**（不自动全量）。

### D2 token 预算

`--budget tight`（200 字/项、30KB 封顶，~7.5K token，默认）/ `rich`（600 字/项、120KB，~30K token）；
`--per-item` / `--max-total` 可覆盖。**无 full 档**。

### D3 隐私

原始正文**瞬时派生即弃**（只落截断+脱敏后的摘要）、纯本地、绝不外发；**绝不进默认报告/成绩卡路径**；
仅 Claude Code（v1）。沿用 ADR 0016/0017 的"派生即弃"与 0018 的"opt-in 单会话 redacted 预览"边界，
仅把"可读对象"从 user prompt 扩到 assistant 回复 + tool_result（仍不碰 thinking/系统 prompt/文件内容）。

## 后果

- CLI 出现首个"读 assistant/tool_result 正文"的能力，但严格 opt-in + 受控 + 脱敏 + 即弃，红线其余不变。
- 复用既有 `redact()`，无新脱敏面。

## 开放问题

- OQ1 Codex 对称（读 rollout 正文）留后。
- OQ2 预算阈值随真实数据微调。
```

- [ ] **Step 2: Validate ADR lint**

Run: `node tools/check_adrs.mjs`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0049-ccoach-digest-optin-content.md
git commit -m "docs(adr): 0049 ccoach digest opt-in redacted content (token-bounded)"
```

---

### Task 3: Fix `sessions --id` substring bug (TDD)

**Files:**
- Modify: `src/sessions.ts:164`
- Test: `test/sessions.test.ts` (append one case)

- [ ] **Step 1: Write the failing test**

Append inside the `describe('ccoach sessions', ...)` block in `test/sessions.test.ts`:

```ts
  // bug: 文本收集用 sid===wantId（精确），与 --help/列表过滤承诺的子串匹配不一致 → --id 短前缀返回空 prompts。
  it('claude 预览：--id 子串也收集 prompt 文本（修 sid===wantId）', () => {
    const o = listClaudeSessions('test/fixtures/claude', window, { sessionId: 's', includePrompts: true }) as Record<string, any>
    expect(o.selected_session.session_id).toBe('s1')
    expect(o.selected_session.prompts).toHaveLength(1)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sessions.test.ts -t "子串也收集"`
Expected: FAIL — `prompts` has length 0 (current `sid === wantId` never matches `'s1' === 's'`).

- [ ] **Step 3: Fix the substring match**

In `src/sessions.ts`, change line 164 from:

```ts
        if (wantId && (wantId === '*' || sid === wantId)) s.texts.push({ ts: tsv, text, fl })
```

to:

```ts
        if (wantId && (wantId === '*' || sid.includes(wantId))) s.texts.push({ ts: tsv, text, fl })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sessions.test.ts`
Expected: PASS (new case + all existing sessions cases).

- [ ] **Step 5: Commit**

```bash
git add src/sessions.ts test/sessions.test.ts
git commit -m "fix(sessions): --id collects prompt text by substring match (was exact-equality)"
```

---

### Task 4: `src/digest.ts` + fixture + unit tests (TDD)

**Files:**
- Create: `test/fixtures/claude-digest/sample.jsonl`
- Create: `src/digest.ts`
- Test: `test/digest.test.ts`

- [ ] **Step 1: Create the deterministic fixture**

Create `test/fixtures/claude-digest/sample.jsonl` (one JSON object per line, no blank lines):

```jsonl
{"type":"user","sessionId":"d1","timestamp":"2026-06-02T10:00:00Z","message":{"role":"user","content":[{"type":"text","text":"please fix the failing build"}]}}
{"type":"assistant","sessionId":"d1","timestamp":"2026-06-02T10:00:01Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"PRIVATE_THOUGHT_DO_NOT_LEAK"},{"type":"text","text":"I'll run the tests then patch. note key sk-ABCDEFGHIJKLMN"}]}}
{"type":"assistant","sessionId":"d1","timestamp":"2026-06-02T10:00:02Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}
{"type":"user","sessionId":"d1","timestamp":"2026-06-02T10:00:03Z","message":{"role":"user","content":[{"type":"tool_result","content":"FAIL one test failed","is_error":true}]}}
{"type":"assistant","sessionId":"d1","timestamp":"2026-06-02T10:00:04Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/Users/x/proj/src/a.ts","old_string":"foo","new_string":"bar"}}]}}
{"type":"user","sessionId":"d1","timestamp":"2026-06-02T10:00:05Z","toolUseResult":{"stdout":"PASS all green"},"message":{"role":"user","content":[]}}
```

- [ ] **Step 2: Write the failing test**

Create `test/digest.test.ts`:

```ts
// test/digest.test.ts — ccoach digest（ADR 0049：opt-in、token 受控、redacted、不含 thinking）
import { describe, it, expect } from 'vitest'
import { buildDigest, BUDGETS } from '../src/digest.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('ccoach digest', () => {
  it('提取 assistant 文本 + 工具输入 + tool_result（含 error 标记），排除 thinking', () => {
    const d = buildDigest('test/fixtures/claude-digest', window, { sessionId: 'd1' }) as any
    expect(d.session_id).toBe('d1')
    const kinds = d.items.map((i: any) => i.kind)
    expect(kinds).toContain('ASSISTANT')
    expect(kinds).toContain('TOOL')
    expect(kinds).toContain('RESULT')
    expect(kinds).toContain('RESULT_ERR')
    const j = JSON.stringify(d)
    expect(j).not.toContain('PRIVATE_THOUGHT_DO_NOT_LEAK') // thinking 绝不进 digest
    expect(j).not.toContain('please fix the failing build') // 人类 prompt 不在 digest（走 sessions --include-user-prompts）
    expect(j).toContain('npm test') // 工具输入保留
  })

  it('脱敏：密钥被 redact', () => {
    const d = buildDigest('test/fixtures/claude-digest', window, { sessionId: 'd1' }) as any
    const j = JSON.stringify(d)
    expect(j).not.toMatch(/sk-ABCDEFGHIJKLMN/)
    expect(j).toContain('sk-REDACTED')
  })

  it('token 受控：总量封顶触发 dropped、stats 含 est_tokens', () => {
    const d = buildDigest('test/fixtures/claude-digest', window, { sessionId: 'd1', perItem: 20, maxTotal: 30 }) as any
    expect(d.stats.dropped).toBeGreaterThan(0)
    expect(d.stats.emitted_chars).toBeLessThanOrEqual(60) // 封顶附近（最多溢出一项）
    expect(typeof d.stats.est_tokens).toBe('number')
    expect(BUDGETS.tight.maxTotal).toBe(30000)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/digest.test.ts`
Expected: FAIL — `Cannot find module '../src/digest.js'`.

- [ ] **Step 4: Implement `src/digest.ts`**

Create `src/digest.ts`:

```ts
// src/digest.ts — opt-in、token 受控、redacted 的单会话正文摘要（ADR 0049）。
// 提取 assistant 文本回复 + 工具输入 + tool_result 正文；**绝不含 thinking / system·developer prompt /
// 文件内容做内容用途**。原始正文瞬时派生即弃，落地只有截断+脱敏后的摘要。复用 sessions.redact()。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inLocalRange, type Window } from './window.js'
import { redact } from './sessions.js'

export interface DigestOpts {
  sessionId: string // 必填：指定单会话（子串匹配，与 sessions --id 一致）
  perItem?: number // 单项码点上限（默认 200）
  maxTotal?: number // 总量码点上限（默认 30000）
}
export type DigestBudget = 'tight' | 'rich'
export const BUDGETS: Record<DigestBudget, { perItem: number; maxTotal: number }> = {
  tight: { perItem: 200, maxTotal: 30000 },
  rich: { perItem: 600, maxTotal: 120000 },
}

interface DigestItem { kind: string; text: string }

function walkJsonl(dir: string): string[] {
  const out: string[] = []
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkJsonl(p))
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
  }
  return out.sort()
}

function toolInputSummary(name: string, input: any): string {
  if (!input || typeof input !== 'object') return ''
  if (name === 'Bash') return 'cmd: ' + String(input.command ?? '')
  if (name === 'Edit' || name === 'NotebookEdit') return 'file ' + String(input.file_path ?? input.notebook_path ?? '') + ' | -' + String(input.old_string ?? '').slice(0, 140) + ' +' + String(input.new_string ?? '').slice(0, 140)
  if (name === 'Write') return 'file ' + String(input.file_path ?? '') + ' | ' + String(input.content ?? '').slice(0, 160)
  if (name === 'Read') return 'file ' + String(input.file_path ?? '')
  if (name === 'Grep') return 'q ' + String(input.pattern ?? '') + ' @ ' + String(input.path ?? input.glob ?? '')
  return JSON.stringify(input).slice(0, 220)
}

function resultText(rec: any): { text: string; isError: boolean } {
  const parts: string[] = []
  let isError = false
  const r = rec.toolUseResult
  if (r) {
    if (typeof r === 'string') parts.push(r)
    else {
      if (r.stdout) parts.push(String(r.stdout))
      if (r.stderr) parts.push('[stderr] ' + String(r.stderr))
      if (typeof r.content === 'string') parts.push(r.content)
      else if (Array.isArray(r.content)) parts.push(r.content.map((c: any) => c?.text ?? '').join(' '))
      if (r.is_error === true) isError = true
    }
  }
  const c = rec.message?.content
  if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_result') {
    const cc = b.content
    if (typeof cc === 'string') parts.push(cc)
    else if (Array.isArray(cc)) parts.push(cc.map((x: any) => x?.text ?? '').join(' '))
    if (b.is_error === true) isError = true
  }
  return { text: parts.join(' ').trim(), isError }
}

const cps = (s: string): number => [...s].length
function trunc(s: string, n: number): string { const a = [...s]; return a.length > n ? a.slice(0, n).join('') + '…' : s }

export function buildDigest(dir: string, window: Window, opts: DigestOpts): Record<string, unknown> {
  const perItem = opts.perItem ?? BUDGETS.tight.perItem
  const maxTotal = opts.maxTotal ?? BUDGETS.tight.maxTotal
  const want = opts.sessionId

  const recs: any[] = []
  for (const file of walkJsonl(dir)) {
    let content: string
    try { content = readFileSync(file, 'utf8') } catch { continue }
    for (const line of content.split('\n')) {
      const t = line.trim(); if (!t) continue
      let rec: any
      try { rec = JSON.parse(t) } catch { continue }
      if (rec?.isSidechain === true) continue
      const sid = typeof rec.sessionId === 'string' ? rec.sessionId : ''
      if (!sid || !sid.includes(want)) continue
      const tsRaw = rec?.timestamp
      const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : null
      const tsv = ts && !Number.isNaN(ts.getTime()) ? ts : null
      if (tsv && !inLocalRange(tsv, window)) continue
      rec.__ts = tsv ? tsv.getTime() : 0
      recs.push(rec)
    }
  }
  recs.sort((a, b) => a.__ts - b.__ts)

  const items: DigestItem[] = []
  for (const rec of recs) {
    if (rec.type === 'assistant') {
      const c = Array.isArray(rec.message?.content) ? rec.message.content : []
      for (const b of c) {
        if (b?.type === 'text' && b.text) items.push({ kind: 'ASSISTANT', text: String(b.text) })
        else if (b?.type === 'tool_use') items.push({ kind: 'TOOL', text: String(b.name ?? '') + ' ' + toolInputSummary(b.name, b.input) })
        // thinking 故意排除
      }
    } else if (rec.type === 'user') {
      const { text, isError } = resultText(rec)
      if (text) items.push({ kind: isError ? 'RESULT_ERR' : 'RESULT', text })
    }
  }

  const emitted: DigestItem[] = []
  let total = 0, rawChars = 0, dropped = 0
  for (const it of items) {
    rawChars += cps(it.text)
    if (total >= maxTotal) { dropped++; continue }
    const red = redact(it.text.replace(/\s+/g, ' '), perItem)
    emitted.push({ kind: it.kind, text: red })
    total += cps(red)
  }

  const sid = recs.length ? String(recs[0].sessionId) : want
  return {
    platform: 'claude-code',
    session_id: sid,
    budget: { per_item: perItem, max_total: maxTotal },
    includes_content: true,
    excludes: ['thinking', 'system_prompt', 'file_contents_as_content'],
    stats: { items: items.length, emitted: emitted.length, dropped, raw_chars: rawChars, emitted_chars: total, est_tokens: Math.round(total / 4) },
    items: emitted,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/digest.test.ts && npm run typecheck`
Expected: PASS (3 cases) + typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/digest.ts test/digest.test.ts test/fixtures/claude-digest/sample.jsonl
git commit -m "feat(digest): token-bounded redacted content digest (assistant/tool_result, no thinking) — ADR 0049"
```

---

### Task 5: Wire `ccoach digest` CLI command

**Files:**
- Modify: `src/cli.ts` (add import + new command block after the `sessions` command, before `cli.help()`)

- [ ] **Step 1: Add the import**

In `src/cli.ts`, change the digest-related import line. After the existing `import { listClaudeSessions, ... } from './sessions.js'` line, add:

```ts
import { buildDigest, BUDGETS, type DigestBudget } from './digest.js'
```

- [ ] **Step 2: Add the command block**

In `src/cli.ts`, insert this block immediately before `cli.help()`:

```ts
// 正文摘要钻取（ADR 0049）：opt-in、token 受控、redacted（assistant 回复 + tool_result，不含 thinking）。
cli
  .command('digest', 'opt-in token-bounded redacted content digest of ONE session (assistant replies + tool_result; no thinking)')
  .option('--platform <platform>', 'Data source: claude-code (codex not supported yet)', { default: 'claude-code' })
  .option('--id <sessionId>', 'Session id to digest (substring match) — REQUIRED')
  .option('--date <date>', 'Single-day window (YYYY-MM-DD)')
  .option('--since <date>', 'From a date until today (YYYY-MM-DD)')
  .option('--days <n>', 'Last N days (including today)')
  .option('--claude-dir <dir>', 'Override Claude data dir (path to projects dir)')
  .option('--budget <budget>', 'Token budget: tight (~7.5K) | rich (~30K)', { default: 'tight' })
  .option('--per-item <n>', 'Override per-item code-point cap')
  .option('--max-total <n>', 'Override total code-point cap')
  .option('--lang <lang>', 'Output language: en | zh', { default: 'en' })
  .action((options: Record<string, unknown>) => {
    try {
      setLang(options.lang as string | undefined)
      const platform = String(options.platform ?? 'claude-code')
      if (platform !== 'claude-code') throw new Error(`digest supports only --platform claude-code (got ${platform})`)
      if (!options.id) throw new Error('digest requires --id <sessionId> (opt-in, single session only)')
      const daysRaw = options.days
      const days = daysRaw != null ? Number(daysRaw) : undefined
      if (days !== undefined && !Number.isFinite(days)) throw new Error(`invalid --days ${String(daysRaw)}`)
      const window = resolveWindow(
        { date: options.date as string | undefined, since: options.since as string | undefined, days },
        new Date(),
      )
      const budget = String(options.budget ?? 'tight') as DigestBudget
      if (budget !== 'tight' && budget !== 'rich') throw new Error(`invalid --budget ${budget} (want tight|rich)`)
      const base = BUDGETS[budget]
      const perItem = options.perItem != null ? Number(options.perItem) : base.perItem
      const maxTotal = options.maxTotal != null ? Number(options.maxTotal) : base.maxTotal
      const dir = (options.claudeDir as string | undefined) || claudeProjectsDir()
      const out = buildDigest(dir, window, { sessionId: String(options.id), perItem, maxTotal })
      process.stdout.write(JSON.stringify(out, null, 2) + '\n')
    } catch (e) {
      process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n')
      process.exit(1)
    }
  })
```

- [ ] **Step 3: Build and smoke-test the command on the fixture**

Run:
```bash
npm run build
node dist/cli.js digest --claude-dir test/fixtures/claude-digest --id d1 --budget tight
```
Expected: JSON with `session_id: "d1"`, `items[]` containing ASSISTANT/TOOL/RESULT/RESULT_ERR, `sk-REDACTED` present, no `PRIVATE_THOUGHT_DO_NOT_LEAK`, and a `stats` block with `est_tokens`.

- [ ] **Step 4: Verify required-flag guards**

Run: `node dist/cli.js digest --claude-dir test/fixtures/claude-digest ; echo "exit=$?"`
Expected: stderr `digest requires --id ...`, `exit=1`.
Run: `node dist/cli.js digest --platform codex --id d1 ; echo "exit=$?"`
Expected: stderr `digest supports only --platform claude-code ...`, `exit=1`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add 'ccoach digest' opt-in content command (--id required, tight|rich budget)"
```

---

### Task 6: Skill `grounding.mjs` + `parseGitLog` (TDD)

**Files:**
- Create: `skills/ccoach-deepinsight/scripts/grounding.mjs`
- Test: `test/deepinsight-grounding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/deepinsight-grounding.test.ts`:

```ts
// test/deepinsight-grounding.test.ts — grounding gate parser（ADR 0048 D2）
import { describe, it, expect } from 'vitest'
import { parseGitLog } from '../skills/ccoach-deepinsight/scripts/grounding.mjs'

describe('grounding parseGitLog', () => {
  it('解析 hash/ts/subject，空输入返回空数组，绝不臆造提交', () => {
    const raw =
      'abc1234567\t2026-06-04T19:20:00+08:00\tfeat: T15 i18n\n' +
      'def8901234\t2026-06-04T21:11:00+08:00\tfix: T16 token display\n'
    const c = parseGitLog(raw)
    expect(c).toHaveLength(2)
    expect(c[0]).toEqual({ hash: 'abc12345', ts: '2026-06-04T19:20:00+08:00', subject: 'feat: T15 i18n' })
    expect(c[1].subject).toBe('fix: T16 token display')
    expect(parseGitLog('')).toEqual([])
    expect(parseGitLog('garbage-no-tabs')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/deepinsight-grounding.test.ts`
Expected: FAIL — cannot find module `grounding.mjs`.

- [ ] **Step 3: Implement `grounding.mjs`**

Create `skills/ccoach-deepinsight/scripts/grounding.mjs`:

```js
// grounding.mjs — deep-insight 的 grounding gate（ADR 0048 D2）。
// 只读 git：给定会话 [since, until] 窗口，取窗内提交，供 skill 把会话意图锚定到真实落地。
// 绝不臆造、绝不取窗外提交（窗口由 git --since/--until 强制）。
import { execFileSync } from 'node:child_process'

// 解析 `git log --pretty=%H%x09%cI%x09%s`（TAB 分隔）为 [{hash, ts, subject}]。纯函数，可测。
export function parseGitLog(raw) {
  const out = []
  for (const line of String(raw).split('\n')) {
    const t = line.replace(/\r$/, '')
    if (!t.trim()) continue
    const parts = t.split('\t')
    if (parts.length < 2) continue
    const [hash, iso, ...rest] = parts
    if (!hash || !iso) continue
    out.push({ hash: hash.slice(0, 8), ts: iso, subject: rest.join('\t') })
  }
  return out
}

// 取 [since, until]（ISO 时间）内的提交。只读；任何失败返回空数组。
export function commitsInWindow({ since, until, cwd = '.' }) {
  let raw = ''
  try {
    raw = execFileSync('git', ['-C', cwd, 'log', '--since', since, '--until', until, '--pretty=%H%x09%cI%x09%s'], {
      encoding: 'utf8',
    })
  } catch {
    return []
  }
  return parseGitLog(raw)
}

// CLI 用法：node grounding.mjs <since-ISO> <until-ISO> [cwd]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , since, until, cwd] = process.argv
  if (!since || !until) {
    process.stderr.write('usage: node grounding.mjs <since-ISO> <until-ISO> [cwd]\n')
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(commitsInWindow({ since, until, cwd: cwd || '.' }), null, 2) + '\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/deepinsight-grounding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ccoach-deepinsight/scripts/grounding.mjs test/deepinsight-grounding.test.ts
git commit -m "feat(deepinsight): grounding.mjs — session-window git commits (grounding gate, ADR 0048)"
```

---

### Task 7: `SKILL.md` (two-pass orchestration)

**Files:**
- Create: `skills/ccoach-deepinsight/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `skills/ccoach-deepinsight/SKILL.md`:

````markdown
---
name: ccoach-deepinsight
description: Deep, semantic root-cause coaching for how you work with Claude Code in a specific project. Goes beyond aggregate metrics — reads your own real code (read-only) and, on spiral-flagged sessions, an opt-in token-bounded content digest — to tell you in plain language WHY work churned and the concrete fix, anchored to official Claude Code features. Distinct from the entertainment-flavored ccoach-insight report. Claude Code only (for now); read-only, local, desensitized.
when_to_use: 'Trigger when the user wants a SERIOUS productivity / behavioral deep-dive on how they use Claude Code in a project — "why do I keep reworking this", "where am I wasting effort", "deep insight", "what should I change to use Claude Code better", "/ccoach-deepinsight". NOT for the fun usage scorecard (that is ccoach-insight).'
allowed-tools: Read Grep Glob Bash(ccoach *) Bash(npx *) Bash(node *) Bash(git *)
---

# ccoach-deepinsight — semantic root-cause deep coach (Claude Code)

## Purpose

Tell the user, in plain human language, WHY their work in a project churns/wastes effort and the concrete fix — so they wield the AI harness more consciously. The deliverable is **solutions and results**, not metrics.

**First principle (non-negotiable):** CLI aggregate metrics (spiral, edit_ring, structured_ratio, any "pass rate") mislead and are machine-speak. They are **minor supporting evidence only — never the headline.** The real product is the **semantic root cause**, found by reading the user's own real code (read-only) and, when needed, an opt-in content digest.

Every root cause is classified and stated as a human fix:
- **cognitive_gap** — didn't know something about the domain/code/tool.
- **prompt_issue** — communication; say it as "next time do X", never a scold.
- **code_structure** — the code made it hard.
- **workflow** — process.
- **unknown_feature** — an official Claude Code feature already solves it.

**Feature-first:** name the official native feature (plan mode, @file references, PostToolUse hooks, /clear, subagents, CLAUDE.md anchors). Official only — never recommend third-party habit skills.

## Privacy (red lines, ADR 0048/0049)

Read-only; local; never exfiltrate. Read the user's own current-project code (never modify it) and CLI-derived signals. Reading assistant/tool_result content is **opt-in and only via `ccoach digest`** (token-bounded, redacted, NO thinking). **Never** read thinking / system·developer prompts / file contents as content. All surfaced/written output is **desensitized** (paths/identifiers → `<…>`); no raw prompt text, no assistant/thinking content.

## Workflow — two passes (ADR 0048)

Single platform: **Claude Code**. Locate `ccoach` (prefer PATH; else `node dist/cli.js` in this repo, or `npx @loredunk/ccoach@latest`).

### Pass 1 — PROJECT (always; cheap; NO content)

Find systemic root causes that recur across sessions and are fixable once.

1. `ccoach --platform claude-code --since <date> --scope project --json` and `--scope episode --json` → project + episode/spiral signals.
2. Read the repo itself (read-only): `CLAUDE.md`/`AGENTS.md`, `package.json` (scripts), whether `.claude/settings.json` exists, and the hot files git churn points at. Use Grep/Glob/Read.
3. Emit **ship-once** root causes + fixes, e.g.: a missing `.claude/settings.json` PostToolUse hook running the repo's typecheck/test; a CLAUDE.md Commands block + one-line-per-file module map. Ground each in the code you read; demote metrics to a single supporting line.

This pass alone is the highest-leverage, lowest-risk output. Stop here unless the user wants per-session depth or a session is spiral-flagged.

### Pass 2 — SESSION (on spiral-flagged sessions or user drill-down)

Drill the deepest individual pits for per-turn behavioral root causes.

1. List candidates (numeric, zero content): `ccoach sessions --platform claude-code --repo <repo> --since <date> --top 20`. Pick spiral/high-churn sessions.
2. **Grounding gate (ADR 0048 D2 — never violate):** read that session's own redacted prompts (`ccoach sessions --platform claude-code --id <FULL-session-id> --include-user-prompts`) and its `[first,last]` window. For any claim about what the turn was doing / whether work shipped, get in-window commits ONLY:
   `node ${CLAUDE_SKILL_DIR}/scripts/grounding.mjs "<first-ISO>" "<last-ISO>" <repo-path>`
   **Never** time-correlate the session to commits outside that window.
3. **Content verification gate (ADR 0049):** before emitting any session-intent finding at confidence≥high, spend a TIGHT digest:
   `ccoach digest --platform claude-code --id <FULL-session-id> --budget tight` (≈7.5K tok; redacted; no thinking). Use it to FALSIFY a tentative root cause before asserting it — this is what prevents confidently-wrong diagnoses. Use `--budget rich` only on explicit single-session drill-down.
4. Read the specific code the session worked on (read-only) for the semantic reason it churned.

### Dedup (ADR 0048 D5)

When both passes reach the same conclusion (e.g. plan mode, @file refs), state it ONCE at project scope as a durable habit; the session pass cites instances. Reserve the session pass for findings the project pass cannot produce.

## Output

Markdown (v1). For each root cause: a plain-language semantic statement, the concrete fix (official feature named), confidence, and at most one supporting metric line. **False-positive honesty:** explicitly say "this is healthy work, no change needed" when a flagged spiral is actually a disciplined, test-verified change. **Dogfooding honesty:** flag when a signal is the tool's own instrument limitation (e.g. task_mix mostly "unknown" = uncalibrated classifier), not user behavior. Desensitize all paths/identifiers to `<…>` before writing/sharing.

## Honesty rules (ADR 0048 D4 / repo CLAUDE.md)

Never assert what ccoach doesn't measure (no "you never ran tests", "didn't review", "should've used plan mode" unless a real signal supports it). Verify any feature/config recommendation against current official Claude Code docs (WebSearch) before suggesting; only suggest, never auto-change config.
````

- [ ] **Step 2: Sanity-check the skill is discoverable + frontmatter parses**

Run: `node -e "const fs=require('fs');const t=fs.readFileSync('skills/ccoach-deepinsight/SKILL.md','utf8');const m=t.match(/^---\n([\s\S]*?)\n---/);if(!m)throw new Error('no frontmatter');if(!/name:\s*ccoach-deepinsight/.test(m[1]))throw new Error('bad name');console.log('frontmatter OK')"`
Expected: `frontmatter OK`.

- [ ] **Step 3: Commit**

```bash
git add skills/ccoach-deepinsight/SKILL.md
git commit -m "feat(deepinsight): SKILL.md — two-pass semantic root-cause coach (ADR 0048/0049)"
```

---

### Task 8: References (method + feature mapping)

**Files:**
- Create: `skills/ccoach-deepinsight/references/deepinsight-method.md`
- Create: `skills/ccoach-deepinsight/references/feature-mapping-deep.md`

- [ ] **Step 1: Write the method reference**

Create `skills/ccoach-deepinsight/references/deepinsight-method.md`:

```markdown
# deep-insight method — root-cause taxonomy, grounding gate, honesty

## Root-cause ladder (semantic-first)
For each observed churn/waste: 1) what the work was trying to do (from prompts + code, paraphrased); 2) the SEMANTIC reason it churned (from reading the code); 3) classify: cognitive_gap | prompt_issue | code_structure | workflow | unknown_feature; 4) the concrete fix (official feature named); 5) at most ONE supporting metric line. Metrics never lead.

## Grounding gate (never violate)
A session's intent claim ("this turn did X / shipped / drifted") must be anchored to that session's own prompts + commits inside its [first,last] window (via scripts/grounding.mjs). NEVER time-correlate to commits outside the window. Proven failure: a trace-only diagnosis confidently asserted a session "drifted and didn't ship" by matching commits 7–11h outside the session; git+prompts showed it TDD-shipped the right features. When intent matters and confidence≥high, run a tight `ccoach digest` to falsify first.

## False-positive honesty
A high single-file edit count + long no-edit stretches + a verification workflow + green tests = a healthy refactor/localization sweep, not a spiral. Say "this is the good case, no change needed."

## Dogfooding honesty
When a signal reflects the tool's own instrument limitation (e.g. task_mix mostly "unknown" = uncalibrated task-type classifier), label it as such, not as user behavior.

## Token discipline
Content (`ccoach digest`) is default OFF. Trigger only on spiral-flagged/ambiguous sessions where the root cause hinges on intent. tight (~7.5K) captures ~90% of value; rich (~30K) only on explicit drill-down; never full.
```

- [ ] **Step 2: Write the feature-mapping reference**

Create `skills/ccoach-deepinsight/references/feature-mapping-deep.md`:

```markdown
# finding (5 categories) → official Claude Code feature

> Feature-first, official only. Verify against current docs before recommending.

| Root-cause category | Typical signature | Official fix to name |
|---|---|---|
| code_structure | same file re-edited 7-8x; a signal threads many layers | open in **plan mode** to enumerate cross-layer edit sites first; or **subagents** (one per layer); split oversized files |
| workflow (no verify gate) | edits land blind; converge by re-editing; repo has test/typecheck but no `.claude/settings.json` | add a **PostToolUse hook** (`.claude/settings.json`) running typecheck+test → red/green instead of blind loop |
| cognitive_gap (re-discovery) | each session re-greps where logic lives; CLAUDE.md has no commands/map | add a **Commands block + module map to CLAUDE.md**; use **@file references** to point at the artifact |
| prompt_issue | terse, file-less openers on a layered codebase; serial re-steers | front-load the target with **@file references** + acceptance criteria; **plan mode** to align before editing |
| unknown_feature | manual context reloading; long single threads bundling unrelated tasks | **/clear** at task boundaries; **/compact**; persist stable rules in **CLAUDE.md**; **skills**/slash-commands for repeated flows |

Demote metrics to support. Never claim an activity ccoach doesn't measure.
```

- [ ] **Step 3: Commit**

```bash
git add skills/ccoach-deepinsight/references/
git commit -m "docs(deepinsight): method + feature-mapping references"
```

---

### Task 9: TODO entry + full green gate

**Files:**
- Modify: `docs/TODO.md` (append a task entry under the pending section)

- [ ] **Step 1: Append the TODO entry**

In `docs/TODO.md`, after the `## T28 …` block (before the `---` / `## 已完成（历史）` divider), add:

```markdown
## T29 · deep-insight 语义根因深度教练（P1）— 🚧 进行中（分支 exp/deepinsight）

> 决策：[`adr/0048-deepinsight-two-pass-grounding-gate.md`](adr/0048-deepinsight-two-pass-grounding-gate.md) + [`adr/0049-ccoach-digest-optin-content.md`](adr/0049-ccoach-digest-optin-content.md)
> 设计/计划：`superpowers/specs/2026-06-07-deepinsight-design.md` + `plans/2026-06-07-deepinsight.md`。

- [x] 修 `sessions --id` 子串匹配 bug（文本收集曾用精确等于）。
- [x] 新增 `ccoach digest`（opt-in、token 受控、redacted；assistant 回复 + tool_result，不含 thinking）。
- [x] skill `ccoach-deepinsight`：两遍流（project→session）+ grounding.mjs（grounding gate）+ method/feature 引用。
- [ ]（后续）HTML 渲染产出、Codex 对称、spiral→Pass2 阈值校准、pass 率是否升为跨回合 CLI 信号。
```

- [ ] **Step 2: Validate ADR links + full green gate**

Run: `node tools/check_adrs.mjs && npm run typecheck && npm test && npm run build`
Expected: ADR lint passes; typecheck clean; ALL vitest suites PASS (including new digest / grounding / sessions cases); build succeeds.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md
git commit -m "docs(todo): T29 deep-insight semantic root-cause coach (in progress)"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** §1 positioning → SKILL.md (Task 7). §3 two-pass + grounding + content gate → SKILL.md + grounding.mjs (Tasks 6/7) + ADR 0048 (Task 1). §4 output model/honesty → SKILL.md + deepinsight-method.md (Tasks 7/8). §5 pass-rate demotion → SKILL.md first-principle + method ref. §6.1 `ccoach digest` → Tasks 4/5 + ADR 0049 (Task 2). §6.2 grounding via skill-side git → Task 6. §6.3 sessions bug → Task 3. §9 testing → tests in Tasks 3/4/6 + green gate Task 9. §11 ADRs → Tasks 1/2. All sections covered.

**Placeholder scan:** no TBD/TODO-as-code; every code step has complete code; commands have expected output. Clean.

**Type consistency:** `buildDigest(dir, window, opts)` + `BUDGETS` + `DigestBudget` used identically in digest.ts (Task 4) and cli.ts (Task 5). `redact(text, charLimit)` matches src/sessions.ts export. `parseGitLog`/`commitsInWindow` signatures match between grounding.mjs (Task 6) and its test. `Window` shape `{fromYmd,toYmd,desc}` matches src/window.ts. Consistent.
