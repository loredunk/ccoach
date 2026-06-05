import { type Tokens, type SpiralSignals, emptyTokens } from './model.js'
import type { ToolKind } from './aggregate.js'
import { type TaskFeatures } from './task-type.js'
import { estimateCost } from './pricing.js'

// 阈值常量（ADR 0034 OQ1：草案，待真实数据校准）
export const EDIT_RING_MIN = 3
export const ERR_RUN_MIN = 3
export const ERR_RATE_MIN = 0.5
export const ERR_CALLS_MIN = 4
export const NOPROG_MIN = 4
export const TIME_FLOOR_MS = 5 * 60 * 1000
export const MIN_SAMPLES = 5
export const EPISODES_MAX = 200
const IDLE_CAP_MS = 5 * 60 * 1000

// 文档/纯文本扩展名（用于 docs 分型与 codeExtRatio 区分）
const DOC_EXTS = new Set(['md', 'mdx', 'rst', 'txt', 'adoc'])

interface SeqEvent { kind: ToolKind; isEdit: boolean; file: number | null }

// 单回合派生（类型内归一化前）：不含 time_outlier/low_confidence/severity 终值，也不含 task_type。
export interface EpisodeRaw {
  sessionId: string; repo: string; index: number
  startMs: number; endMs: number; durationMs: number
  tokens: Tokens; cost: number
  toolCalls: number; filesTouched: number; maxEditsPerFile: number
  errorCount: number; resultCount: number; errorRate: number
  interrupted: boolean
  correctedByNext: boolean
  features: TaskFeatures
  spiral: Pick<SpiralSignals, 'edit_ring' | 'error_dense' | 'no_progress'>
  durationSecondsRaw: number
}

// 攒当前回合的有序事件；finalize 派生后丢弃序列与文件 basename（ADR 0032 D5 / 0017 瞬时即弃）。
export class EpisodeBuilder {
  private startMs: number
  private endMs: number
  private prevMs: number | null = null
  private durationMs = 0
  private tokens: Tokens = emptyTokens()
  private cost = 0
  private toolCalls = 0
  private seq: SeqEvent[] = []
  private fileIds = new Map<string, number>()   // basename -> 局部 id（瞬时）
  private editCounts = new Map<number, number>() // 局部 id -> 编辑次数
  private results: boolean[] = []                // 有序 is_error（瞬时）
  private errorCount = 0
  private interrupted = false
  private correctedByNext = false
  // 分类特征累计
  private reads = 0; private edits = 0; private searches = 0; private shells = 0; private others = 0
  private docExt = 0; private codeExt = 0; private fileToolCount = 0
  private linesChanged = 0; private hasTest = false; private longRun = false

  constructor(
    private readonly sessionId: string,
    private readonly repo: string,
    private readonly index: number,
    start: Date,
  ) {
    this.startMs = start.getTime()
    this.endMs = this.startMs
  }

  get isInterrupted(): boolean { return this.interrupted }

  addTokens(d: Tokens, model?: string): void {
    this.tokens.input += d.input; this.tokens.cached_input += d.cached_input
    this.tokens.output += d.output; this.tokens.reasoning_output += d.reasoning_output
    this.tokens.cache_creation += d.cache_creation; this.tokens.total += d.total
    if (model) this.cost += estimateCost(d, model).usd
  }

  // ext: 文件扩展名（不含点，小写）；isEdit=Edit/Write/NotebookEdit（Read=false）
  addTool(kind: ToolKind, isEdit: boolean, fileKey?: string, ext?: string, longRun = false): void {
    this.toolCalls++
    let fid: number | null = null
    if (kind === 'file' && fileKey) {
      fid = this.fileIds.get(fileKey) ?? this.fileIds.size
      if (!this.fileIds.has(fileKey)) this.fileIds.set(fileKey, fid)
      this.fileToolCount++
      if (ext && DOC_EXTS.has(ext)) this.docExt++
      else if (ext) this.codeExt++
      if (isEdit) { this.edits++; this.editCounts.set(fid, (this.editCounts.get(fid) ?? 0) + 1) }
      else this.reads++
    } else if (kind === 'shell') {
      this.shells++
    } else if (kind === 'search') {
      this.searches++
    } else if (kind !== 'web') {
      this.others++
    }
    if (longRun) this.longRun = true
    this.seq.push({ kind, isEdit, file: fid })
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
    if (Number.isNaN(t)) return
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
    const editRing = maxEdits >= EDIT_RING_MIN
    let run = 0, maxRun = 0
    for (const e of this.results) { run = e ? run + 1 : 0; if (run > maxRun) maxRun = run }
    const errorDense = maxRun >= ERR_RUN_MIN ||
      (errorRate >= ERR_RATE_MIN && resultCount >= ERR_CALLS_MIN && filesTouched <= 3)
    const noProgress = this.computeNoProgress()
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
      durationSecondsRaw: Math.floor(this.durationMs / 1000),
    }
  }

  // 连续 ≥NOPROG_MIN 次工具调用未引入新文件 → 原地打转（红转绿在错误段难判，简化为新文件停滞窗口）。
  private computeNoProgress(): boolean {
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
