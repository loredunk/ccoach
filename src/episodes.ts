import {
  type Tokens, type SpiralSignals, type TaskType,
  type EpisodeDetail, type EpisodeSummary,
  type EffortCalibrationRow, type ContextRot, type ContextRotBucket, emptyTokens,
} from './model.js'
import type { ToolKind } from './aggregate.js'
import { classifyTask, type TaskFeatures } from './task-type.js'
import { estimateCost, normalizeModel } from './pricing.js'

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
  // Effort 证据（ADR 0053）：白名单标签/布尔，无内容。
  effort: string | null         // Codex turn_context.effort
  model: string | null          // 回合内 token 主导模型（normalize 后）
  thinkingDirective: boolean    // Claude：prompt 显式调高思考强度（派生布尔）
  compacted: boolean            // Codex：回合内发生过上下文压缩
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
  // Effort 证据（ADR 0053）
  private effort: string | null = null
  private modelTokens = new Map<string, number>() // normalize 后模型 -> 回合内 token（取主导）
  private thinkingDirective = false
  private compacted = false

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
    if (model) {
      this.cost += estimateCost(d, model).usd
      const nm = normalizeModel(model)
      if (nm) this.modelTokens.set(nm, (this.modelTokens.get(nm) ?? 0) + d.total)
    }
  }

  setEffort(label: string): void { if (label) this.effort = label }
  markThinkingDirective(): void { this.thinkingDirective = true }
  markCompacted(): void { this.compacted = true }

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
      effort: this.effort, model: this.dominantModel(), thinkingDirective: this.thinkingDirective, compacted: this.compacted,
    }
  }

  private dominantModel(): string | null {
    let best: string | null = null
    let bestT = -1
    for (const [m, t] of this.modelTokens) if (t > bestT) { bestT = t; best = m }
    return best
  }

  // 无后续边界时收尾（文件/rollout 末尾、或 assemble 兜底）：以内部最后活动时间为终点，确定性、不引入墙钟。
  finalizeOpen(): EpisodeRaw { return this.finalize(new Date(this.endMs)) }

  // 连续 ≥NOPROG_MIN 次工具调用未引入新文件 → 原地打转。仅当回合在「尝试改东西」（有编辑或有错误）时才算；
  // 纯探索（read/search、无错误无编辑）是正常进展、不算 spiral（spec §4.1「无新文件且无红转绿」的保守落地）。
  private computeNoProgress(): boolean {
    if (this.edits === 0 && this.errorCount === 0) return false
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

// 收集已 finalize 的 episode，做类型内归一化 + 派生 EpisodeDetail/EpisodeSummary（ADR 0033/0034）。
function p90(sorted: number[]): number {
  if (!sorted.length) return Infinity
  const idx = Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)
  return sorted[idx]
}

export class EpisodeAccumulator {
  private raws: EpisodeRaw[] = []
  // 跳过空回合（无 token、无工具）——用户连发消息 / Codex 连续 turn_context / 文件末尾空 prompt 会开出无活动回合，
  // 计入会稀释 task_mix、污染 autonomy/interrupted 率。也跳过非法时间戳（健壮性，避免 build 抛 Invalid time value）。
  add(raw: EpisodeRaw): void {
    if (!Number.isFinite(raw.startMs)) return
    if (raw.toolCalls === 0 && raw.tokens.total === 0) return
    this.raws.push(raw)
  }
  get count(): number { return this.raws.length }

  build(): { details: EpisodeDetail[]; summary: EpisodeSummary } {
    // 1) 分类
    const typed = this.raws.map((r) => ({ raw: r, ...classifyTask(r.features) }))
    // 2) 类型内时长 p90（最小样本回退全局）
    const byType = new Map<TaskType, number[]>()
    for (const t of typed) { const a = byType.get(t.type) ?? []; a.push(t.raw.durationMs); byType.set(t.type, a) }
    const globalDur = this.raws.map((r) => r.durationMs).sort((x, y) => x - y)
    const p90ByType = new Map<TaskType, { v: number; low: boolean }>()
    for (const [k, arr] of byType) {
      if (arr.length >= MIN_SAMPLES) p90ByType.set(k, { v: p90([...arr].sort((x, y) => x - y)), low: false })
      else p90ByType.set(k, { v: p90(globalDur), low: true })
    }
    // 3) 终值 spiral + EpisodeDetail
    const details: EpisodeDetail[] = typed.map(({ raw, type, confidence }) => {
      const baseLine = p90ByType.get(type)!
      const timeOutlier = raw.durationMs > baseLine.v && raw.durationMs > TIME_FLOOR_MS
      const spiral: SpiralSignals = {
        edit_ring: raw.spiral.edit_ring, error_dense: raw.spiral.error_dense,
        no_progress: raw.spiral.no_progress, time_outlier: timeOutlier, low_confidence: baseLine.low, severity: 0,
      }
      spiral.severity =
        (spiral.edit_ring ? 2 : 0) + (spiral.error_dense ? 2 : 0) +
        (spiral.no_progress ? 1 : 0) + (spiral.time_outlier ? 1 : 0)
      const endType: EpisodeDetail['end_type'] =
        raw.interrupted ? 'interrupted' : raw.correctedByNext ? 'corrected' : 'natural'
      const d: EpisodeDetail = {
        session_id: raw.sessionId, repo: raw.repo, index: raw.index,
        start_ts: new Date(raw.startMs).toISOString(), end_ts: new Date(raw.endMs).toISOString(),
        duration_seconds: Math.floor(raw.durationMs / 1000),
        tokens: raw.tokens, estimated_cost_usd: raw.cost,
        tool_calls: raw.toolCalls, files_touched: raw.filesTouched, max_edits_per_file: raw.maxEditsPerFile,
        error_count: raw.errorCount, error_rate: Math.round(raw.errorRate * 1e4) / 1e4,
        interrupted: raw.interrupted, end_type: endType,
        task_type: type, task_type_confidence: Math.round(confidence * 100) / 100, spiral,
      }
      // Effort 证据（ADR 0053）：可选字段，仅在有值/为真时输出（契约加性）。
      if (raw.effort) d.effort = raw.effort
      if (raw.model) d.model = raw.model
      if (raw.thinkingDirective) d.thinking_directive = true
      if (raw.compacted) d.compacted = true
      return d
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
    // 校准/曲线在全量 details 上算（episodes_detail 输出按 severity 截断，会偏置；summary 聚合不偏）。
    const calib = buildEffortCalibration(details)
    if (calib.length) summary.effort_calibration = calib
    if (n) summary.context_rot = buildContextRot(details)
    return { details, summary }
  }
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4

// Effort 校准行（ADR 0053）：按 (dial, value, task_type) 分组全量回合。
// dial=effort：Codex turn 档；dial=model：模型梯度（两平台，Claude 侧 effort 证据）；
// dial=thinking：Claude 思考指令 on/off（仅限 claude 模型回合，避免把 Codex 回合混进 off 组）。
function buildEffortCalibration(details: EpisodeDetail[]): EffortCalibrationRow[] {
  const groups = new Map<string, { dial: EffortCalibrationRow['dial']; value: string; task: TaskType; eps: EpisodeDetail[] }>()
  const put = (dial: EffortCalibrationRow['dial'], value: string, d: EpisodeDetail): void => {
    const key = `${dial} ${value} ${d.task_type}`
    let g = groups.get(key)
    if (!g) { g = { dial, value, task: d.task_type, eps: [] }; groups.set(key, g) }
    g.eps.push(d)
  }
  const anyThinking = details.some((d) => d.thinking_directive)
  for (const d of details) {
    if (d.effort) put('effort', d.effort, d)
    if (d.model) put('model', d.model, d)
    if (anyThinking && d.model?.startsWith('claude')) put('thinking', d.thinking_directive ? 'on' : 'off', d)
  }
  const rows: EffortCalibrationRow[] = []
  for (const g of groups.values()) {
    const n = g.eps.length
    const mean = (f: (d: EpisodeDetail) => number): number => g.eps.reduce((s, d) => s + f(d), 0) / n
    rows.push({
      dial: g.dial, value: g.value, task_type: g.task, episodes: n,
      spiral_rate: round4(g.eps.filter((d) => d.spiral.severity > 0).length / n),
      corrected_rate: round4(g.eps.filter((d) => d.end_type === 'corrected').length / n),
      avg_duration_seconds: Math.round(mean((d) => d.duration_seconds)),
      avg_total_tokens: Math.round(mean((d) => d.tokens.total)),
      avg_reasoning_tokens: Math.round(mean((d) => d.tokens.reasoning_output)),
      low_confidence: n < MIN_SAMPLES,
    })
  }
  rows.sort((a, b) => a.dial < b.dial ? -1 : a.dial > b.dial ? 1
    : a.value < b.value ? -1 : a.value > b.value ? 1
      : a.task_type < b.task_type ? -1 : a.task_type > b.task_type ? 1 : 0)
  return rows
}

// 上下文衰减曲线（ADR 0053）：按会话内回合序号分固定桶（0–4/5–9/10–14/15–19/20+），
// rot_rate = spiral 或 corrected 的占比；拐点 = 首个足样本桶 rot_rate ≥ max(2×baseline, baseline+0.15)。
const ROT_EDGES = [0, 5, 10, 15, 20]
function buildContextRot(details: EpisodeDetail[]): ContextRot {
  const buckets: ContextRotBucket[] = []
  for (let i = 0; i < ROT_EDGES.length; i++) {
    const from = ROT_EDGES[i]
    const to = i + 1 < ROT_EDGES.length ? ROT_EDGES[i + 1] - 1 : null
    const eps = details.filter((d) => d.index >= from && (to === null || d.index <= to))
    if (!eps.length) continue
    const n = eps.length
    const spiral = eps.filter((d) => d.spiral.severity > 0).length
    const corrected = eps.filter((d) => d.end_type === 'corrected').length
    const rot = eps.filter((d) => d.spiral.severity > 0 || d.end_type === 'corrected').length
    buckets.push({
      index_from: from, index_to: to, episodes: n,
      spiral_rate: round4(spiral / n), corrected_rate: round4(corrected / n),
      rot_rate: round4(rot / n),
      avg_error_rate: round4(eps.reduce((s, d) => s + d.error_rate, 0) / n),
    })
  }
  const sampled = buckets.filter((b) => b.episodes >= MIN_SAMPLES)
  const baseline = sampled.length ? sampled[0].rot_rate : 0
  let inflection: number | null = null
  const threshold = Math.max(2 * baseline, baseline + 0.15)
  for (const b of sampled.slice(1)) {
    if (b.rot_rate >= threshold) { inflection = b.index_from; break }
  }
  return {
    buckets,
    baseline_rot_rate: round4(baseline),
    inflection_index: inflection,
    low_confidence: sampled.length < 2,
  }
}
