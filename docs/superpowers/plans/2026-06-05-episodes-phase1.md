# Episode 切分层 + 绕圈检测 + 任务分型 实现计划（E1+E2+E3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 parser 之上加 Episode（回合）抽象，离线纯结构地切分会话并派生任务类型与绕圈信号，经 `--scope episode` + 主报告 `episode_summary` 输出，隐私红线与 `--json` 契约零破坏。

**Architecture:** 新增 `src/episodes.ts`（平台无关 `EpisodeBuilder` 攒单回合有序事件 + `EpisodeAccumulator` 收尾派生）与 `src/task-type.ts`（纯函数分类）。parser 在边界调 `agg.beginEpisode()`（Claude=非 sidechain user-text 记录、Codex=turn_context），现有 `applyTokens/applyTool/applyToolResult/markInterrupted/markActive` 由聚合器顺带转发进当前回合；有序工具序列与文件 basename 瞬时即弃，落盘只剩派生布尔/计数。

**Tech Stack:** TypeScript（ESM、Node≥18）、vitest、tsdown。命令：`npm test`（vitest run）/ `npx vitest run <file>` / `npm run typecheck` / `node tools/check_adrs.mjs` / `npm run verify:ccusage`。

设计源：`docs/superpowers/specs/2026-06-05-episode-spiral-tasktype-design.md`。决策：ADR 0032/0033/0034。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/model.ts` | 加 `EpisodeDetail`/`SpiralSignals`/`EpisodeSummary` 类型 + glossary；`Report` 加 `episode_summary?`/`episodes_detail?` | 改 |
| `src/task-type.ts` | `TaskType`/`TaskFeatures` + 纯函数 `classifyTask` | 建 |
| `src/episodes.ts` | `EpisodeBuilder` + `EpisodeAccumulator` + 常量阈值 | 建 |
| `src/aggregate.ts` | `Scope` 加 `'episode'`；持有 `EpisodeAccumulator`；`beginEpisode`；apply* 转发；assemble 出 summary/details | 改 |
| `src/parsers/claude-code.ts` | user-text 边界 → `beginEpisode`（含 corrected 探测）；file 工具传 `fileKey/isEdit` | 改 |
| `src/parsers/codex.ts` | `turn_context` 边界 → `beginEpisode` | 改 |
| `src/cli.ts` | `--scope episode` 校验 + 帮助 | 改 |
| `src/emit/text.ts` + `src/i18n.ts` | 人读 episode 概览段 + en/zh 文案 | 改 |
| `test/task-type.test.ts` / `test/episodes.test.ts` | 单测 | 建 |
| `test/privacy.test.ts` | episode 隐私回归 | 改 |
| `test/fixtures/claude/`、`test/fixtures/codex/` | 多回合 fixture | 改/建 |

阈值常量（`src/episodes.ts`，草案、待真实数据校准）：`EDIT_RING_MIN=3`、`ERR_RUN_MIN=3`、`ERR_RATE_MIN=0.5`、`ERR_CALLS_MIN=4`、`NOPROG_MIN=4`、`TIME_FLOOR_MS=5*60*1000`、`MIN_SAMPLES=5`、`CONF_MIN=0.4`、`EPISODES_MAX=200`。

---

## Task 1: model.ts 类型 + glossary

**Files:** Modify `src/model.ts`

- [ ] **Step 1: 加类型（在 `ScopeBucket` 附近）**

```ts
export type TaskType =
  | 'explore' | 'implement' | 'debug' | 'refactor'
  | 'experiment' | 'scripting' | 'docs' | 'unknown'

export interface SpiralSignals {
  edit_ring: boolean
  error_dense: boolean
  no_progress: boolean
  time_outlier: boolean
  low_confidence: boolean   // 类型内样本不足、退全局基线
  severity: number          // 触发子信号加权计数，0=无 spiral
}
export interface EpisodeDetail {
  session_id: string
  repo: string
  index: number             // 会话内回合序号（0 起）
  start_ts: string          // ISO-8601 本机时区
  end_ts: string
  duration_seconds: number  // gap-capped 活跃时长
  tokens: Tokens
  estimated_cost_usd: number
  tool_calls: number
  files_touched: number     // 去重计数，不含文件名
  max_edits_per_file: number
  error_count: number
  error_rate: number
  interrupted: boolean
  end_type: 'natural' | 'interrupted' | 'corrected'
  task_type: TaskType
  task_type_confidence: number
  spiral: SpiralSignals
}
export interface EpisodeSummary {
  episodes: number
  autonomy_rate: number       // 无打断 episode 占比
  interrupted_rate: number
  corrected_rate: number      // Claude only（Codex 恒 0）
  intervention_style: 'micro-manager' | 'balanced' | 'free-range'
  spiral_episodes: number     // severity>0 的数
  task_mix: Record<string, number>   // task_type -> 占比 0–1
  deepest_pit?: { session_id: string; index: number; severity: number; tokens: number; task_type: TaskType }
}
```

- [ ] **Step 2: `Report` 加可选字段**（在 `sessions_detail?` 后）

```ts
  episode_summary?: EpisodeSummary
  episodes_detail?: EpisodeDetail[]   // 仅 --scope episode
```

- [ ] **Step 3: glossary 加条目**（`REPORT_GLOSSARY` 内）

```ts
  episode_summary: 'Per-turn (episode) rollup: an episode is "one user instruction → the next". autonomy_rate=share of episodes with no interruption; intervention_style derived from interrupt+correction rates; spiral_episodes=episodes with any structural loop signal; task_mix=share of episodes per task type; deepest_pit=the worst spiral episode (severity x tokens). All derived counts/labels; episode token sums are main-session only (sidechain excluded) so they are <= report.tokens.total.',
  episodes_detail: 'Per-episode derived signals (only with --scope episode): duration/tokens/tool_calls/files_touched(count only)/error stats/interrupted/end_type/task_type/spiral. Contains no prompt text, no paths, no file names, no diff text (ADR 0016/0017). end_type=corrected is Claude-only (Codex does not read user prompts, ADR 0041).',
```

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS（仅加类型，无引用）。

- [ ] **Step 5: Commit**

```bash
git add src/model.ts
git commit -m "feat(model): add Episode/Spiral/Summary types + glossary (ADR 0032/0033/0034)"
```

---

## Task 2: task-type.ts 纯函数 + 单测

**Files:** Create `src/task-type.ts`, `test/task-type.test.ts`

- [ ] **Step 1: 写失败测试** (`test/task-type.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { classifyTask, type TaskFeatures } from '../src/task-type.js'

const base = (): TaskFeatures => ({
  reads: 0, edits: 0, searches: 0, shells: 0, others: 0,
  filesTouched: 0, hasTest: false, longRun: false,
  docExtRatio: 0, codeExtRatio: 0, linesChanged: 0, errorRate: 0,
})

describe('classifyTask', () => {
  it('读多写少 → explore', () => {
    const f = { ...base(), reads: 12, searches: 6, edits: 1, filesTouched: 9 }
    expect(classifyTask(f).type).toBe('explore')
  })
  it('编辑密集 + 测试 → implement', () => {
    const f = { ...base(), edits: 10, reads: 4, hasTest: true, filesTouched: 3, codeExtRatio: 0.9 }
    expect(classifyTask(f).type).toBe('implement')
  })
  it('错误驱动 + 文件窄 → debug', () => {
    const f = { ...base(), edits: 6, reads: 5, errorRate: 0.6, filesTouched: 2, hasTest: true }
    expect(classifyTask(f).type).toBe('debug')
  })
  it('触碰文件多 + 大改 → refactor', () => {
    const f = { ...base(), edits: 14, filesTouched: 11, linesChanged: 800, codeExtRatio: 0.8 }
    expect(classifyTask(f).type).toBe('refactor')
  })
  it('长命令少编辑 → experiment', () => {
    const f = { ...base(), shells: 8, longRun: true, edits: 0, reads: 2 }
    expect(classifyTask(f).type).toBe('experiment')
  })
  it('文档为主 → docs', () => {
    const f = { ...base(), edits: 5, docExtRatio: 0.9, filesTouched: 2 }
    expect(classifyTask(f).type).toBe('docs')
  })
  it('信号过弱 → unknown 且 confidence 低', () => {
    const r = classifyTask(base())
    expect(r.type).toBe('unknown')
    expect(r.confidence).toBeLessThan(0.4)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/task-type.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现** (`src/task-type.ts`)

```ts
import type { TaskType } from './model.js'
export type { TaskType }

export interface TaskFeatures {
  reads: number; edits: number; searches: number; shells: number; others: number
  filesTouched: number
  hasTest: boolean
  longRun: boolean        // 出现疑似长任务命令（train/notebook/反复 rerun）
  docExtRatio: number     // 触碰文件中文档扩展名占比 0–1
  codeExtRatio: number    // 代码扩展名占比 0–1
  linesChanged: number    // +/- 累计
  errorRate: number       // 工具错误率 0–1
}

// 确定性分类：打分取最高，低分→unknown。规则顺序无关、用分值表达强度。
export function classifyTask(f: TaskFeatures): { type: TaskType; confidence: number } {
  const total = f.reads + f.edits + f.searches + f.shells + f.others
  if (total < 2) return { type: 'unknown', confidence: 0.1 }
  const readish = f.reads + f.searches
  const scores: Record<Exclude<TaskType, 'unknown'>, number> = {
    docs: f.docExtRatio >= 0.6 && f.edits > 0 ? 0.6 + f.docExtRatio * 0.4 : 0,
    experiment: f.longRun ? 0.7 + (f.edits === 0 ? 0.2 : 0) : 0,
    debug: f.errorRate >= 0.4 && f.edits > 0 && f.filesTouched <= 3 ? 0.5 + f.errorRate * 0.4 : 0,
    refactor: f.filesTouched >= 6 && (f.linesChanged >= 400 || f.edits >= 10) ? 0.6 + Math.min(0.3, f.filesTouched / 40) : 0,
    implement: f.edits >= 3 && (f.hasTest || f.codeExtRatio >= 0.5) ? 0.5 + Math.min(0.4, f.edits / 25) : 0,
    explore: readish >= 4 && f.edits <= 1 ? 0.5 + Math.min(0.4, readish / 25) : 0,
    scripting: f.edits >= 1 && !f.hasTest && total <= 6 && f.filesTouched <= 2 ? 0.45 : 0,
  }
  let bestType: TaskType = 'unknown'
  let best = 0
  for (const [k, v] of Object.entries(scores)) if (v > best) { best = v; bestType = k as TaskType }
  if (best < 0.4) return { type: 'unknown', confidence: Math.min(0.39, best) }
  return { type: bestType, confidence: Math.min(1, best) }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/task-type.test.ts`
Expected: PASS（7 例）。如个别用例与打分不符，**只调阈值/权重**直到全绿（阈值本就待校准）。

- [ ] **Step 5: typecheck + Commit**

```bash
npm run typecheck && git add src/task-type.ts test/task-type.test.ts
git commit -m "feat(task-type): deterministic episode task classifier (ADR 0033)"
```

---

## Task 3: episodes.ts — EpisodeBuilder（单回合派生 + spiral）

**Files:** Create `src/episodes.ts`（先只写 EpisodeBuilder + 常量 + EpisodeRaw 接口），扩 `test/episodes.test.ts`

EpisodeBuilder 攒**瞬时**有序事件，`finalize()` 派生后丢弃序列，返回 `EpisodeRaw`（不含 time_outlier/severity/task_type，那些在 Accumulator 定）。

- [ ] **Step 1: 写失败测试**（`test/episodes.test.ts`）

```ts
import { describe, it, expect } from 'vitest'
import { EpisodeBuilder } from '../src/episodes.js'

const T = (s: number) => new Date(2026, 5, 5, 10, 0, s)
const tok = (n: number) => ({ input: n, cached_input: 0, output: n, reasoning_output: 0, cache_creation: 0, total: 2 * n })

describe('EpisodeBuilder', () => {
  it('edit→test→error→edit 同文件 ≥3 次 → edit_ring + 派生计数', () => {
    const b = new EpisodeBuilder('s1', 'repo', 0, T(0))
    b.addTokens(tok(100)); b.mark(T(1))
    b.addTool('file', true, 'a.ts'); b.addTool('shell', false); b.addToolResult(true)  // edit, test 失败
    b.addTool('file', true, 'a.ts'); b.addTool('shell', false); b.addToolResult(true)
    b.addTool('file', true, 'a.ts'); b.addTool('shell', false); b.addToolResult(false) // 第3次后转绿
    b.mark(T(30))
    const raw = b.finalize(T(30))
    expect(raw.spiral.edit_ring).toBe(true)
    expect(raw.maxEditsPerFile).toBe(3)
    expect(raw.filesTouched).toBe(1)
    expect(raw.errorCount).toBe(2)
    expect(raw.interrupted).toBe(false)
    expect(raw.tokens.total).toBe(200)
  })
  it('连续错误 + 文件集合不扩大 → error_dense', () => {
    const b = new EpisodeBuilder('s1', 'repo', 1, T(0))
    b.addTool('shell', false); b.addToolResult(true)
    b.addTool('shell', false); b.addToolResult(true)
    b.addTool('shell', false); b.addToolResult(true)
    const raw = b.finalize(T(5))
    expect(raw.spiral.error_dense).toBe(true)
  })
  it('被打断 → interrupted', () => {
    const b = new EpisodeBuilder('s1', 'repo', 2, T(0))
    b.addTool('shell', false); b.markInterrupted()
    expect(b.finalize(T(1)).interrupted).toBe(true)
  })
  it('finalize 不泄露文件名/序列（只暴露派生计数）', () => {
    const b = new EpisodeBuilder('s1', 'repo', 0, T(0))
    b.addTool('file', true, 'secret-name.ts')
    const raw = b.finalize(T(1)) as any
    expect(JSON.stringify(raw)).not.toContain('secret-name')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/episodes.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 EpisodeBuilder**（`src/episodes.ts`）

```ts
import { type Tokens, type SpiralSignals, type TaskType, emptyTokens } from './model.js'
import { type ToolKind } from './aggregate.js'
import { classifyTask, type TaskFeatures } from './task-type.js'
import { estimateCost } from './pricing.js'

export const EDIT_RING_MIN = 3
export const ERR_RUN_MIN = 3
export const ERR_RATE_MIN = 0.5
export const ERR_CALLS_MIN = 4
export const NOPROG_MIN = 4
export const TIME_FLOOR_MS = 5 * 60 * 1000
export const MIN_SAMPLES = 5
export const EPISODES_MAX = 200
const IDLE_CAP_MS = 5 * 60 * 1000

interface SeqEvent { kind: ToolKind; isEdit: boolean; file: number | null; longRun: boolean }

export interface EpisodeRaw {
  sessionId: string; repo: string; index: number
  startMs: number; endMs: number; durationMs: number
  tokens: Tokens; cost: number
  toolCalls: number; filesTouched: number; maxEditsPerFile: number
  errorCount: number; resultCount: number; errorRate: number
  interrupted: boolean
  correctedByNext: boolean
  features: TaskFeatures
  // 类型内归一化前的 spiral（不含 time_outlier/low_confidence/severity 终值）
  spiral: Pick<SpiralSignals, 'edit_ring' | 'error_dense' | 'no_progress'>
  // 给 task 分类/百分位用
  durationSecondsRaw: number
}

export class EpisodeBuilder {
  private prevMs: number | null = null
  private durationMs = 0
  private endMs: number
  private tokens: Tokens = emptyTokens()
  private cost = 0
  private toolCalls = 0
  private seq: SeqEvent[] = []
  private fileIds = new Map<string, number>()   // basename -> 局部 id（瞬时，finalize 后丢）
  private editCounts = new Map<number, number>()
  private results: boolean[] = []               // 有序 is_error（瞬时）
  private errorCount = 0
  private interrupted = false
  private correctedByNext = false
  private model = ''
  // 分类特征累计
  private reads = 0; private edits = 0; private searches = 0; private shells = 0; private others = 0
  private docExt = 0; private codeExt = 0; private fileToolCount = 0
  private linesChanged = 0; private hasTest = false; private longRun = false

  constructor(
    private sessionId: string, private repo: string, private index: number, start: Date,
  ) { this.endMs = start.getTime(); this.startMs = start.getTime() }
  readonly startMs: number

  addTokens(d: Tokens, model?: string): void {
    this.tokens.input += d.input; this.tokens.cached_input += d.cached_input
    this.tokens.output += d.output; this.tokens.reasoning_output += d.reasoning_output
    this.tokens.cache_creation += d.cache_creation; this.tokens.total += d.total
    if (model) { this.model = model; this.cost += estimateCost(d, model).usd }
  }
  // ext: 文件扩展名（不含点，小写）；isEdit=Edit/Write/NotebookEdit
  addTool(kind: ToolKind, isEdit: boolean, fileKey?: string, ext?: string, longRun = false): void {
    this.toolCalls++
    let fid: number | null = null
    if (kind === 'file' && fileKey) {
      fid = this.fileIds.get(fileKey) ?? this.fileIds.size
      if (!this.fileIds.has(fileKey)) this.fileIds.set(fileKey, fid)
      this.fileToolCount++
      if (ext === 'md' || ext === 'mdx' || ext === 'rst' || ext === 'txt') this.docExt++
      else if (ext) this.codeExt++
      if (isEdit) { this.edits++; this.editCounts.set(fid, (this.editCounts.get(fid) ?? 0) + 1) }
      else this.reads++
    } else if (kind === 'shell') { this.shells++; if (longRun) this.longRun = true }
    else if (kind === 'search') this.searches++
    else if (kind !== 'web') this.others++
    if (longRun) this.longRun = true
    this.seq.push({ kind, isEdit, file: fid, longRun })
  }
  addToolResult(isError: boolean, isTest = false): void {
    this.results.push(isError)
    if (isError) this.errorCount++
    if (isTest) this.hasTest = true
  }
  addLines(added: number, removed: number): void { this.linesChanged += added + removed }
  markInterrupted(): void { this.interrupted = true }
  markCorrectedByNext(): void { this.correctedByNext = true }
  mark(ts: Date): void {
    const t = ts.getTime()
    if (this.prevMs !== null) { const g = t - this.prevMs; if (g > 0 && g <= IDLE_CAP_MS) this.durationMs += g }
    this.prevMs = t
    if (t > this.endMs) this.endMs = t
  }

  finalize(end: Date): EpisodeRaw {
    this.mark(end)
    const filesTouched = this.fileIds.size
    const maxEdits = this.editCounts.size ? Math.max(...this.editCounts.values()) : 0
    const resultCount = this.results.length
    const errorRate = resultCount ? this.errorCount / resultCount : 0
    // edit_ring：单文件编辑 ≥ 阈值
    const editRing = maxEdits >= EDIT_RING_MIN
    // error_dense：≥ERR_RUN_MIN 连续错误，或 错误率高且调用够多且文件集合未在错误段后扩大
    let run = 0, maxRun = 0
    for (const e of this.results) { run = e ? run + 1 : 0; if (run > maxRun) maxRun = run }
    const errorDense = maxRun >= ERR_RUN_MIN ||
      (errorRate >= ERR_RATE_MIN && resultCount >= ERR_CALLS_MIN && filesTouched <= 3)
    // no_progress：连续 ≥NOPROG_MIN 工具调用中 无新文件 且 无红转绿
    const noProgress = this.computeNoProgress()
    const durationSecondsRaw = Math.floor(this.durationMs / 1000)
    const features: TaskFeatures = {
      reads: this.reads, edits: this.edits, searches: this.searches, shells: this.shells, others: this.others,
      filesTouched, hasTest: this.hasTest, longRun: this.longRun,
      docExtRatio: this.fileToolCount ? this.docExt / this.fileToolCount : 0,
      codeExtRatio: this.fileToolCount ? this.codeExt / this.fileToolCount : 0,
      linesChanged: this.linesChanged, errorRate,
    }
    return {
      sessionId: this.sessionId, repo: this.repo, index: this.index,
      startMs: this.startMs, endMs: this.endMs, durationMs: this.durationMs,
      tokens: this.tokens, cost: this.cost,
      toolCalls: this.toolCalls, filesTouched, maxEditsPerFile: maxEdits,
      errorCount: this.errorCount, resultCount, errorRate,
      interrupted: this.interrupted, correctedByNext: this.correctedByNext,
      features, spiral: { edit_ring: editRing, error_dense: errorDense, no_progress: noProgress },
      durationSecondsRaw,
    }
  }

  private computeNoProgress(): boolean {
    // 红转绿：test 类别难在此判，简化为「错误结果后再无新文件加入」+ 连续无新文件窗口
    const seenFiles = new Set<number>()
    let windowNoNew = 0
    for (const ev of this.seq) {
      const isNewFile = ev.file !== null && !seenFiles.has(ev.file)
      if (ev.file !== null) seenFiles.add(ev.file)
      windowNoNew = isNewFile ? 0 : windowNoNew + 1
      if (windowNoNew >= NOPROG_MIN) return true
    }
    return false
  }
}
```

> 注：`readonly startMs` 需在构造里赋值；TS 严格下用 `private readonly`。实现时若报「赋值前使用」，改成构造函数参数属性或普通字段即可——以 typecheck 通过为准。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/episodes.test.ts`
Expected: PASS（4 例）。隐私用例（不含 secret-name）必须绿。

- [ ] **Step 5: typecheck + Commit**

```bash
npm run typecheck && git add src/episodes.ts test/episodes.test.ts
git commit -m "feat(episodes): EpisodeBuilder with transient seq + spiral derivation (ADR 0032/0034)"
```

---

## Task 4: episodes.ts — EpisodeAccumulator（多回合派生 + 类型内基线 + summary）

**Files:** Modify `src/episodes.ts`（加 `EpisodeAccumulator`），扩 `test/episodes.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { EpisodeAccumulator } from '../src/episodes.js'
// 复用上方 T/tok
describe('EpisodeAccumulator', () => {
  it('类型内 p90：同耗时在不同类型基线下 time_outlier 判定不同', () => {
    const acc = new EpisodeAccumulator()
    // 5 个短 implement + 1 个长 implement → 长的应 time_outlier
    for (let i = 0; i < 5; i++) {
      const b = new EpisodeBuilder('s', 'r', i, T(0))
      b.addTool('file', true, 'a.ts', 'ts'); b.addTool('file', true, 'b.ts', 'ts'); b.addTool('file', true, 'c.ts', 'ts')
      b.addToolResult(false, true); b.mark(T(60))
      acc.add(b.finalize(T(60)))
    }
    const long = new EpisodeBuilder('s', 'r', 5, T(0))
    long.addTool('file', true, 'a.ts', 'ts'); long.addTool('file', true, 'b.ts', 'ts'); long.addTool('file', true, 'c.ts', 'ts')
    long.addToolResult(false, true); long.mark(new Date(2026, 5, 5, 12, 0, 0))  // 2h
    acc.add(long.finalize(new Date(2026, 5, 5, 12, 0, 0)))
    const { details, summary } = acc.build()
    const longDetail = details.find((d) => d.index === 5)!
    expect(longDetail.task_type).toBe('implement')
    expect(longDetail.spiral.time_outlier).toBe(true)
    expect(summary.episodes).toBe(6)
    expect(summary.task_mix.implement).toBeCloseTo(1, 5)
  })
  it('end_type 与 autonomy/intervention', () => {
    const acc = new EpisodeAccumulator()
    const a = new EpisodeBuilder('s', 'r', 0, T(0)); a.addTool('shell', false); a.markInterrupted()
    acc.add(a.finalize(T(1)))
    const b = new EpisodeBuilder('s', 'r', 1, T(0)); b.addTool('shell', false); b.markCorrectedByNext()
    acc.add(b.finalize(T(1)))
    const { details, summary } = acc.build()
    expect(details.find((d) => d.index === 0)!.end_type).toBe('interrupted')
    expect(details.find((d) => d.index === 1)!.end_type).toBe('corrected')
    expect(summary.autonomy_rate).toBeCloseTo(0.5, 5)  // 2 回合 1 个无打断
    expect(['micro-manager', 'balanced', 'free-range']).toContain(summary.intervention_style)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/episodes.test.ts`
Expected: FAIL（EpisodeAccumulator 不存在）。

- [ ] **Step 3: 实现 EpisodeAccumulator**（追加到 `src/episodes.ts`）

```ts
import { type EpisodeDetail, type EpisodeSummary, type SpiralSignals, type TaskType } from './model.js'

function p90(sorted: number[]): number {
  if (!sorted.length) return Infinity
  const idx = Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)
  return sorted[idx]
}
function isoLocal(ms: number): string { return new Date(ms).toISOString() }

export class EpisodeAccumulator {
  private raws: import('./episodes.js').EpisodeRaw[] = []
  add(raw: import('./episodes.js').EpisodeRaw): void { this.raws.push(raw) }
  get count(): number { return this.raws.length }

  build(): { details: EpisodeDetail[]; summary: EpisodeSummary } {
    // 1) 分类
    const typed = this.raws.map((r) => ({ raw: r, ...classifyTask(r.features) }))
    // 2) 类型内时长 p90（最小样本回退全局）
    const byType = new Map<TaskType, number[]>()
    for (const t of typed) {
      const a = byType.get(t.type) ?? []; a.push(t.raw.durationMs); byType.set(t.type, a)
    }
    const globalDur = [...this.raws.map((r) => r.durationMs)].sort((x, y) => x - y)
    const p90ByType = new Map<TaskType, { v: number; low: boolean }>()
    for (const [k, arr] of byType) {
      if (arr.length >= MIN_SAMPLES) p90ByType.set(k, { v: p90([...arr].sort((x, y) => x - y)), low: false })
      else p90ByType.set(k, { v: p90(globalDur), low: true })
    }
    // 3) 终值 spiral + EpisodeDetail
    const details: EpisodeDetail[] = typed.map(({ raw, type, confidence }) => {
      const base = p90ByType.get(type)!
      const timeOutlier = raw.durationMs > base.v && raw.durationMs > TIME_FLOOR_MS
      const spiral: SpiralSignals = {
        edit_ring: raw.spiral.edit_ring, error_dense: raw.spiral.error_dense,
        no_progress: raw.spiral.no_progress, time_outlier: timeOutlier, low_confidence: base.low,
        severity: 0,
      }
      spiral.severity =
        (spiral.edit_ring ? 2 : 0) + (spiral.error_dense ? 2 : 0) +
        (spiral.no_progress ? 1 : 0) + (spiral.time_outlier ? 1 : 0)
      const endType: EpisodeDetail['end_type'] =
        raw.interrupted ? 'interrupted' : raw.correctedByNext ? 'corrected' : 'natural'
      return {
        session_id: raw.sessionId, repo: raw.repo, index: raw.index,
        start_ts: isoLocal(raw.startMs), end_ts: isoLocal(raw.endMs),
        duration_seconds: Math.floor(raw.durationMs / 1000),
        tokens: raw.tokens, estimated_cost_usd: raw.cost,
        tool_calls: raw.toolCalls, files_touched: raw.filesTouched, max_edits_per_file: raw.maxEditsPerFile,
        error_count: raw.errorCount, error_rate: Math.round(raw.errorRate * 1e4) / 1e4,
        interrupted: raw.interrupted, end_type: endType,
        task_type: type, task_type_confidence: Math.round(confidence * 100) / 100, spiral,
      }
    })
    // 4) summary
    const n = details.length
    const interrupted = details.filter((d) => d.interrupted).length
    const corrected = details.filter((d) => d.end_type === 'corrected').length
    const spiralN = details.filter((d) => d.spiral.severity > 0).length
    const mix: Record<string, number> = {}
    for (const d of details) mix[d.task_type] = (mix[d.task_type] ?? 0) + 1
    for (const k of Object.keys(mix)) mix[k] = Math.round((mix[k] / Math.max(1, n)) * 1e4) / 1e4
    const interruptedRate = n ? interrupted / n : 0
    const correctedRate = n ? corrected / n : 0
    const style: EpisodeSummary['intervention_style'] =
      interruptedRate + correctedRate >= 0.35 ? 'micro-manager'
        : interruptedRate + correctedRate <= 0.1 ? 'free-range' : 'balanced'
    let deepest: EpisodeSummary['deepest_pit']
    for (const d of details) {
      if (d.spiral.severity <= 0) continue
      const score = d.spiral.severity * d.tokens.total
      if (!deepest || score > deepest.severity * deepest.tokens)
        deepest = { session_id: d.session_id, index: d.index, severity: d.spiral.severity, tokens: d.tokens.total, task_type: d.task_type }
    }
    const summary: EpisodeSummary = {
      episodes: n,
      autonomy_rate: n ? Math.round((1 - interruptedRate) * 1e4) / 1e4 : 0,
      interrupted_rate: Math.round(interruptedRate * 1e4) / 1e4,
      corrected_rate: Math.round(correctedRate * 1e4) / 1e4,
      intervention_style: style, spiral_episodes: spiralN, task_mix: mix,
    }
    if (deepest) summary.deepest_pit = deepest
    return { details, summary }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/episodes.test.ts`
Expected: PASS（全部）。

- [ ] **Step 5: typecheck + Commit**

```bash
npm run typecheck && git add src/episodes.ts test/episodes.test.ts
git commit -m "feat(episodes): EpisodeAccumulator within-type baseline + summary (ADR 0033/0034)"
```

---

## Task 5: aggregate.ts 集成（beginEpisode + 转发 + assemble）

**Files:** Modify `src/aggregate.ts`，扩 `test/aggregate.test.ts`

- [ ] **Step 1: 写失败测试**（接 `Aggregator`，直接驱动 episode 接口）

```ts
import { Aggregator } from '../src/aggregate.js'
it('--scope episode 出 episodes_detail + 主报告恒附 episode_summary', () => {
  const agg = new Aggregator('claude-code', 'episode')
  const t0 = new Date('2026-06-05T03:00:00Z')
  agg.beginEpisode('s1', 'repo', t0, false)
  agg.applyTokens({ input: 100, cached_input: 0, output: 50, reasoning_output: 0, cache_creation: 0, total: 150 }, 'claude-opus-4-8', 'repo', 's1', t0)
  agg.markActive(t0)
  agg.applyTool('file', undefined, { isEdit: true, fileKey: 'a.ts', ext: 'ts' })
  agg.applyToolResult('Edit', false, null)
  const r = agg.assemble({ fromYmd: '2026-06-05', toYmd: '2026-06-05', desc: 'd' }, 'glob')
  expect(r.episode_summary!.episodes).toBe(1)
  expect(r.episodes_detail!.length).toBe(1)
  expect(r.episodes_detail![0].tokens.total).toBe(150)
})
it('默认 scope=global：有 episode_summary、无 episodes_detail（契约加性）', () => {
  const agg = new Aggregator('claude-code')  // global
  const t0 = new Date('2026-06-05T03:00:00Z')
  agg.beginEpisode('s1', 'repo', t0, false)
  agg.applyTokens({ input: 10, cached_input: 0, output: 5, reasoning_output: 0, cache_creation: 0, total: 15 }, 'claude-opus-4-8', 'repo', 's1', t0)
  const r = agg.assemble({ fromYmd: '2026-06-05', toYmd: '2026-06-05', desc: 'd' }, 'glob')
  expect(r.episode_summary).toBeDefined()
  expect(r.episodes_detail).toBeUndefined()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/aggregate.test.ts`
Expected: FAIL（`beginEpisode`/`applyTool` 第三参不存在）。

- [ ] **Step 3: 改 aggregate.ts**

3a. `Scope` 加 `'episode'`：
```ts
export type Scope = 'global' | 'project' | 'session' | 'episode'
```

3b. import EpisodeAccumulator/EpisodeBuilder + 类型，并加字段：
```ts
import { EpisodeAccumulator, EpisodeBuilder, EPISODES_MAX } from './episodes.js'
// 类内：
private episodes = new EpisodeAccumulator()
private curEpisode: EpisodeBuilder | null = null
private epIndexBySession = new Map<string, number>()
```

3c. 新方法（class 内）：
```ts
beginEpisode(session: string, repo: string, ts: Date, correctsPrev: boolean): void {
  if (this.curEpisode) {
    if (correctsPrev && !this.curEpisode.isInterrupted) this.curEpisode.markCorrectedByNext()
    this.episodes.add(this.curEpisode.finalize(ts))
  }
  const idx = this.epIndexBySession.get(session) ?? 0
  this.epIndexBySession.set(session, idx + 1)
  this.curEpisode = new EpisodeBuilder(session || '(unknown)', repo || '(unknown)', idx, ts)
}
endEpisodeBoundary(ts: Date): void {   // 文件/rollout 末尾
  if (this.curEpisode) { this.episodes.add(this.curEpisode.finalize(ts)); this.curEpisode = null }
}
```
> 给 `EpisodeBuilder` 加 `get isInterrupted()` 读 `this.interrupted`。

3d. 在已有方法末尾转发（**不改原行为**）：
- `applyTokens(...)` 末尾：`this.curEpisode?.addTokens(d, model)`
- `applyToolResult(...)` 末尾：`this.curEpisode?.addToolResult(isError)`（test 类别：`category === 'test'` 时传 `true`）
- `markInterrupted()`：`this.curEpisode?.markInterrupted()`
- `markActive(ts)` 末尾：`this.curEpisode?.mark(ts)`
- `applyEdit(a, r, um)` 末尾：`this.curEpisode?.addLines(a, r)`

3e. `applyTool` 扩签名并转发：
```ts
applyTool(kind: ToolKind, command?: string, ep?: { isEdit?: boolean; fileKey?: string; ext?: string; longRun?: boolean }): void {
  // ...原有逻辑不变...
  this.curEpisode?.addTool(kind, ep?.isEdit ?? false, ep?.fileKey, ep?.ext, ep?.longRun ?? false)
}
```

3f. assemble 收尾（`return report` 前）：
```ts
if (this.curEpisode) { this.episodes.add(this.curEpisode.finalize(new Date(this.prevActive ?? Date.parse(report.generated_for) ?? 0))); this.curEpisode = null }
const built = this.episodes.build()
report.episode_summary = built.summary
if (this.scope === 'episode') report.episodes_detail = built.details
  .sort((a, b) => (b.spiral.severity - a.spiral.severity) || (b.tokens.total - a.tokens.total))
  .slice(0, EPISODES_MAX)
```
> `Scope!=global` 时 `report.scope` 已设；`'episode'` 同样写入 `report.scope='episode'`（改 assemble 里 `this.scope !== 'global'` 分支或单独处理：episode 不产 projects/sessions_detail，仅设 scope 标签 + episodes_detail）。确保 `--scope episode` 不进 project/session 桶逻辑。

> finalize 用的 end 时间：优先 `this.curEpisode` 内部 endMs；这里传一个兜底 Date 即可，因 EpisodeBuilder.finalize 内部 `mark(end)` 只在 end>endMs 时推进。可改为给 EpisodeBuilder 加无参 `finalizeOpen()` 用内部 endMs，避免造 Date。实现时以 typecheck/test 通过为准。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `npx vitest run test/aggregate.test.ts && npm test`
Expected: 新例 PASS；**现有全部测试仍绿**（契约/口径未破）。

- [ ] **Step 5: Commit**

```bash
git add src/aggregate.ts src/episodes.ts test/aggregate.test.ts
git commit -m "feat(aggregate): wire EpisodeAccumulator, beginEpisode + forwarding, assemble summary/details (ADR 0032)"
```

---

## Task 6: claude-code.ts parser 钩子

**Files:** Modify `src/parsers/claude-code.ts`，加 fixture `test/fixtures/claude/episodes.jsonl`，扩 `test/claude-code.test.ts`

边界：非 sidechain 且 `userText` 非空的 user 记录。corrected：新 prompt 命中纠错词（复用 `src/prompt-signals.ts` 的纠错口径——若无导出，本地内联一个小正则 `/\b(actually|sorry|wait|wrong|no,)\b|不对|不是|错了|重来|撤销/i`）。file 工具传 `fileKey`(basename)+`ext`。

- [ ] **Step 1: 写 fixture**（多回合：正常 / 被打断 / 纠错跟进 / edit-ring）

```jsonl
{"type":"user","sessionId":"e1","cwd":"/Users/x/repo","timestamp":"2026-06-05T03:00:00Z","uuid":"u1","message":{"role":"user","content":"implement the parser"}}
{"type":"assistant","sessionId":"e1","cwd":"/Users/x/repo","timestamp":"2026-06-05T03:00:10Z","uuid":"a1","requestId":"r1","message":{"id":"m1","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},"content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"/Users/x/repo/parser.ts"}}]}}
{"type":"user","sessionId":"e1","cwd":"/Users/x/repo","timestamp":"2026-06-05T03:00:20Z","uuid":"u2","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","is_error":false,"content":"ok"}]},"toolUseResult":{"structuredPatch":[{"lines":["+a","+b"]}]}}
{"type":"user","sessionId":"e1","cwd":"/Users/x/repo","timestamp":"2026-06-05T03:01:00Z","uuid":"u3","message":{"role":"user","content":"actually that's wrong, redo it"}}
{"type":"assistant","sessionId":"e1","cwd":"/Users/x/repo","timestamp":"2026-06-05T03:01:10Z","uuid":"a2","requestId":"r2","message":{"id":"m2","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":80,"output_tokens":40,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},"content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"npm test"}}]}}
{"type":"user","sessionId":"e1","cwd":"/Users/x/repo","timestamp":"2026-06-05T03:01:20Z","uuid":"u4","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t2","is_error":false,"content":"ok"}]},"toolUseResult":{"interrupted":true}}
```

- [ ] **Step 2: 写失败测试**（`test/claude-code.test.ts` 追加）

```ts
import { parseClaudeCode } from '../src/parsers/claude-code.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
it('episode 切分：边界=user-text、corrected/interrupted 归因', () => {
  const r = parseClaudeCode(join(FX, 'claude-episodes-dir'), { fromYmd: '2026-06-05', toYmd: '2026-06-05', desc: 'd' }, 'episode')
  expect(r.episode_summary!.episodes).toBe(2)
  const eps = r.episodes_detail!
  expect(eps.find((e) => e.index === 0)!.end_type).toBe('corrected')  // 被下一条 "actually wrong" 标记
  expect(eps.find((e) => e.index === 1)!.end_type).toBe('interrupted')
})
```
> fixture 放 `test/fixtures/claude-episodes-dir/episodes.jsonl`（parseClaudeCode 收目录）。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run test/claude-code.test.ts`
Expected: FAIL（episodes 为 0：parser 还没调 beginEpisode）。

- [ ] **Step 4: 改 parser**

4a. 顶部加纠错正则常量；引入 `basename`/已用 `extOf`。
4b. 在 `rec.type === 'user'` 且 `!sidechain` 分支里、`const text = userText(rec.message)` 之后：
```ts
if (text) {
  const corrects = CORRECTION_RE.test(text)
  agg.beginEpisode(session, repo, ts, corrects)
}
```
（放在 `agg.applyPrompt(text)` 附近；仅在有真实文本时切边界。）
4c. file 工具传 fileKey/ext（在 assistant 的 tool_use 循环，Edit/Write/Read/NotebookEdit 分支）：
```ts
const fp = typeof inp.file_path === 'string' ? inp.file_path : ''
const ext = extOf(fp)
agg.applyTool('file', undefined, { isEdit: name !== 'Read', fileKey: fp ? fp.split('/').pop() : undefined, ext })
```
（Bash 分支可加 `{ longRun: /\b(train|fit|pytest|jest|vitest|build|benchmark)\b/.test(cmd) }` 作 experiment/test 弱信号——保守，可后调。）
4d. 文件循环末尾（`for (const file ...)` 结束处，`resetActive` 同级）调 `agg.endEpisodeBoundary(ts(最后一条)?)`——简化为在整个 `feedClaudeCode` 末尾调 `agg.endEpisodeBoundary(new Date())`；assemble 也兜底 finalize，二者择一，避免重复 finalize（用 curEpisode null 判重）。

- [ ] **Step 5: 跑测试确认通过 + 全量回归**

Run: `npx vitest run test/claude-code.test.ts && npm test`
Expected: PASS；现有 Claude 解析测试不变（token/dedup/prompt 信号口径未动）。

- [ ] **Step 6: Commit**

```bash
git add src/parsers/claude-code.ts test/fixtures/claude-episodes-dir/ test/claude-code.test.ts
git commit -m "feat(parser/claude): episode boundary on user-text + corrected/interrupted + file identity (ADR 0032)"
```

---

## Task 7: codex.ts parser 钩子

**Files:** Modify `src/parsers/codex.ts`，加 fixture，扩 `test/codex.test.ts`

边界：`turn_context`。Codex 无用户文本 → 不传 corrects（恒 false）；end_type 只 natural/interrupted。

- [ ] **Step 1: fixture**（`test/fixtures/codex-episodes/sessions/2026/06/05/rollout-ep.jsonl`，两个 turn_context）

```jsonl
{"type":"session_meta","timestamp":"2026-06-05T03:00:00Z","payload":{"id":"cx1","cwd":"/Users/x/repo","source":"cli"}}
{"type":"turn_context","timestamp":"2026-06-05T03:00:01Z","payload":{"model":"gpt-5.1-codex"}}
{"type":"event_msg","timestamp":"2026-06-05T03:00:02Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":50,"reasoning_output_tokens":0,"total_tokens":150}}}}
{"type":"response_item","timestamp":"2026-06-05T03:00:03Z","payload":{"type":"function_call","name":"shell","call_id":"c1","arguments":"{\"command\":[\"bash\",\"-lc\",\"npm test\"]}"}}
{"type":"response_item","timestamp":"2026-06-05T03:00:04Z","payload":{"type":"function_call_output","call_id":"c1","output":"{\"metadata\":{\"exit_code\":1}}"}}
{"type":"turn_context","timestamp":"2026-06-05T03:05:00Z","payload":{"model":"gpt-5.1-codex"}}
{"type":"event_msg","timestamp":"2026-06-05T03:05:01Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":40,"cached_input_tokens":0,"output_tokens":20,"reasoning_output_tokens":0,"total_tokens":60}}}}
{"type":"response_item","timestamp":"2026-06-05T03:05:02Z","payload":{"type":"function_call","name":"shell","call_id":"c2","arguments":"{\"command\":[\"bash\",\"-lc\",\"ls\"]}"}}
{"type":"response_item","timestamp":"2026-06-05T03:05:03Z","payload":{"type":"function_call_output","call_id":"c2","output":"{\"metadata\":{\"interrupted\":true}}"}}
```

- [ ] **Step 2: 写失败测试**

```ts
import { parseCodex } from '../src/parsers/codex.js'
it('Codex episode 切分：边界=turn_context、interrupted 归因、无 corrected', () => {
  const r = parseCodex(join(FX2, 'codex-episodes'), { fromYmd: '2026-06-05', toYmd: '2026-06-05', desc: 'd' }, 'episode')
  expect(r.episode_summary!.episodes).toBe(2)
  expect(r.episode_summary!.corrected_rate).toBe(0)
  const eps = r.episodes_detail!
  expect(eps.find((e) => e.index === 1)!.end_type).toBe('interrupted')
})
```
> `parseCodex(home, window, scope)` 的 home 指向含 `sessions/` 的目录。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run test/codex.test.ts`
Expected: FAIL（episodes=0）。

- [ ] **Step 4: 改 parser**

在 `case 'turn_context':` 开头（非 sidechain、窗口判断后）调：
```ts
if (!sidechain && inWin(ts)) agg.beginEpisode(sessionId || '(unknown)', repo, ts, false)
```
> 注意：`turn_context` 当前在 `curModel` 赋值处；`sessionId`/`repo` 在 session_meta 后已知（turn_context 晚于 session_meta）。窗口外 turn_context 不切边界。
> rollout 末尾（`for (const line ...)` 结束、`applyBillingRollout` 附近）调 `agg.endEpisodeBoundary(ts最后)`，或在 `feedCodex` 每文件末尾 `agg.endEpisodeBoundary(...)`，避免跨 rollout 桥接。
> file 工具：Codex 经 shell 改文件、无结构化 Edit，故 isEdit 恒 false、不传 fileKey（edit_ring 在 Codex 基本不触发，符合设计不对称）。`longRun`：shell 命令含 train/pytest 等可传 `{longRun:true}`。

- [ ] **Step 5: 跑测试确认通过 + 全量回归**

Run: `npx vitest run test/codex.test.ts && npm test`
Expected: PASS；现有 Codex 测试（token/billing/执行画像）不变。

- [ ] **Step 6: Commit**

```bash
git add src/parsers/codex.ts test/fixtures/codex-episodes/ test/codex.test.ts
git commit -m "feat(parser/codex): episode boundary on turn_context (ADR 0032)"
```

---

## Task 8: CLI `--scope episode` + 文本概览 + i18n

**Files:** Modify `src/cli.ts`、`src/emit/text.ts`、`src/i18n.ts`，扩 `test/cli.test.ts`

- [ ] **Step 1: 写失败测试**（`test/cli.test.ts` 追加 scope 校验）

```ts
// 取 cli 校验 scope 的现有用例风格，新增：'episode' 应被接受
it('--scope episode 合法', () => {
  expect(() => validateScope('episode')).not.toThrow()  // 用 cli 实际导出的校验函数/路径
})
```
> 若 cli 用 cac 直接解析，改为断言 `buildReport({ platform, window, scope: 'episode' })` 不抛、产出 `episodes_detail`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL（episode 不在允许集）。

- [ ] **Step 3: 改 CLI**

在 `--scope` 的校验白名单（cli.ts 内 `['global','project','session']`）加 `'episode'`；帮助文案补 `episode`。`src/index.ts` 的 `buildReport`/`Scope` 透传已兼容（类型已扩）。

- [ ] **Step 4: 文本概览（emit/text.ts）+ i18n（i18n.ts）**

i18n.ts en/zh 加键：`episodes`/`autonomy`/`intervention_style`/`spiral_episodes`/`deepest_pit`/`task_mix`。emit/text.ts 在合适位置（错误/卡顿段后）渲染一段「Episodes」概览：episodes 数、autonomy_rate%、intervention_style、spiral_episodes、task_mix top3。仅在 `report.episode_summary` 存在时渲染。

- [ ] **Step 5: 跑测试 + typecheck + i18n 回归**

Run: `npm test && npm run typecheck`
Expected: PASS；`test/i18n-cli.test.ts` 的「--lang en 无中文」闸门仍绿（新文案 en/zh 双填）。

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/emit/text.ts src/i18n.ts test/cli.test.ts
git commit -m "feat(cli): --scope episode + text episode overview + i18n (ADR 0032)"
```

---

## Task 9: 隐私回归 + 契约回归 + 真实数据冒烟

**Files:** Modify `test/privacy.test.ts`

- [ ] **Step 1: 写隐私回归**

```ts
it('episodes_detail/episode_summary 不含文本/路径/文件名/diff', () => {
  // 用含 file_path 的 fixture 跑 --scope episode，断言 JSON 不含 basename、不含命令全行、不含路径分隔片段
  const r = parseClaudeCode(join(FX, 'claude-episodes-dir'), W, 'episode')
  const s = JSON.stringify({ a: r.episodes_detail, b: r.episode_summary })
  expect(s).not.toContain('parser.ts')      // 文件名不泄
  expect(s).not.toContain('/Users/')        // 路径不泄
  expect(s).not.toMatch(/npm test|redo it/) // 命令/ prompt 原文不泄
})
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run test/privacy.test.ts`
Expected: PASS（若失败，说明某处把 basename/路径漏进输出，回到 Task 3/6 修）。

- [ ] **Step 3: 全量回归 + docs lint + ccusage 对账**

Run: `npm test && npm run typecheck && node tools/check_adrs.mjs && npm run verify:ccusage`
Expected: 全绿。`verify:ccusage` 证明 token/成本口径**未被 episode 改动污染**（关键）。

- [ ] **Step 4: 真实数据冒烟（本机，只读）**

Run: `npx tsx src/cli.ts report --scope episode --days 7 --json | head -c 1500`
人工核对：`episode_summary` 合理、`episodes_detail` 无文本/路径/文件名；`report --days 7`（默认 global）输出与改动前一致（契约不破）。

- [ ] **Step 5: Commit**

```bash
git add test/privacy.test.ts
git commit -m "test(privacy): episode output leaks no text/path/filename/diff (ADR 0016/0017)"
```

---

## Task 10: 收尾

- [ ] **Step 1: 自检**：spec §2–§7 每条都有对应 Task；阈值常量集中在 `episodes.ts`；类型名在各 Task 一致（`EpisodeDetail`/`SpiralSignals`/`EpisodeSummary`/`TaskFeatures`）。
- [ ] **Step 2: 最终全绿**：`npm test && npm run typecheck && node tools/check_adrs.mjs && npm run verify:ccusage`。
- [ ] **Step 3:** 合并/PR 决策走 `superpowers:finishing-a-development-branch`。

---

## 自检记录（spec 覆盖）

- spec §1 架构（episodes.ts/边界/转发/仅主会话/时长口径）→ Task 3/4/5/6/7。
- spec §2 字段 → Task 1（类型）+ Task 4（填充）。
- spec §3 任务分型 + 类型内归一化 → Task 2 + Task 4。
- spec §4 spiral + 最深的坑 + summary → Task 3（子信号）+ Task 4（time_outlier/severity/summary）。
- spec §5 契约 `--scope episode` + 加性 → Task 5/8 + Task 9 契约回归。
- spec §6 隐私 → Task 3（瞬时即弃）+ Task 9 回归。
- spec §7 测试 → Task 2/3/4/5/6/7/9。
- 阈值待校准（ADR 0034 OQ1）：Task 2/3 注明「只调阈值到测试绿」，Task 9 真实冒烟二次校准。
</content>
