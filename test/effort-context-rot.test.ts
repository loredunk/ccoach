// test/effort-context-rot.test.ts — episode 级 effort 证据 + effort 校准 + 上下文衰减曲线 + 文件 churn（ADR 0053/0054）
import { describe, it, expect } from 'vitest'
import { EpisodeBuilder, EpisodeAccumulator, MIN_SAMPLES } from '../src/episodes.js'
import { parseCodex } from '../src/parsers/codex.js'
import { parseClaudeCode } from '../src/parsers/claude-code.js'

const T = (s: number) => new Date(2026, 5, 5, 10, 0, s)
const tok = (n: number, reasoning = 0) => ({ input: n, cached_input: 0, output: n, reasoning_output: reasoning, cache_creation: 0, total: 2 * n })

// 简单回合：可指定 effort / model / 是否 spiral（edit_ring）
function ep(opts: {
  session?: string; index: number; effort?: string; model?: string
  thinking?: boolean; spiral?: boolean; reasoning?: number
}): EpisodeBuilder {
  const b = new EpisodeBuilder(opts.session ?? 's', 'r', opts.index, T(0))
  b.addTokens(tok(100, opts.reasoning ?? 0), opts.model)
  if (opts.effort) b.setEffort(opts.effort)
  if (opts.thinking) b.markThinkingDirective()
  if (opts.spiral) {
    b.addTool('file', true, 'x.ts', 'ts'); b.addTool('file', true, 'x.ts', 'ts'); b.addTool('file', true, 'x.ts', 'ts')
  } else {
    b.addTool('shell', false)
  }
  b.mark(T(1))
  return b
}

describe('effort_calibration (episode_summary)', () => {
  it('按 (dial=effort, value, task_type) 分组，MIN_SAMPLES 之下标 low_confidence', () => {
    const acc = new EpisodeAccumulator()
    for (let i = 0; i < MIN_SAMPLES; i++) acc.add(ep({ index: i, effort: 'high' }).finalizeOpen())
    acc.add(ep({ index: 9, effort: 'medium' }).finalizeOpen()) // 1 个 < MIN_SAMPLES
    const { summary } = acc.build()
    const rows = summary.effort_calibration!
    const high = rows.find((r) => r.dial === 'effort' && r.value === 'high')!
    const med = rows.find((r) => r.dial === 'effort' && r.value === 'medium')!
    expect(high.episodes).toBe(MIN_SAMPLES)  // 同形回合 → 同 task_type 一行
    expect(high.low_confidence).toBe(false)
    expect(high.spiral_rate).toBe(0)
    expect(med.low_confidence).toBe(true)
    expect(high.task_type).toBe(med.task_type) // 政策对比的前提：同 task_type 行可比
  })
  it('dial=model：两平台模型梯度；dial=thinking：仅 claude 模型回合、且只在出现过指令时给', () => {
    const acc = new EpisodeAccumulator()
    for (let i = 0; i < 3; i++) acc.add(ep({ index: i, model: 'claude-opus-4-8', thinking: i === 0 }).finalizeOpen())
    acc.add(ep({ index: 3, model: 'gpt-5.1-codex', effort: 'high' }).finalizeOpen())
    const { summary } = acc.build()
    const rows = summary.effort_calibration!
    expect(rows.some((r) => r.dial === 'model' && r.value === 'claude-opus-4-8')).toBe(true)
    expect(rows.some((r) => r.dial === 'model' && r.value === 'gpt-5.1-codex')).toBe(true)
    const thinkingRows = rows.filter((r) => r.dial === 'thinking')
    expect(thinkingRows.length).toBeGreaterThan(0)
    // gpt 回合不得混入 thinking off 组
    const offN = thinkingRows.filter((r) => r.value === 'off').reduce((s, r) => s + r.episodes, 0)
    const onN = thinkingRows.filter((r) => r.value === 'on').reduce((s, r) => s + r.episodes, 0)
    expect(onN).toBe(1)
    expect(offN).toBe(2)
  })
  it('无任何档位 → 不输出 effort_calibration', () => {
    const acc = new EpisodeAccumulator()
    acc.add(ep({ index: 0 }).finalizeOpen())
    expect(acc.build().summary.effort_calibration).toBeUndefined()
  })
})

describe('context_rot (episode_summary)', () => {
  it('回合序号分桶；后段 rot 率跃升 → inflection_index', () => {
    const acc = new EpisodeAccumulator()
    // 两个会话 × 序号 0–4（干净）+ 序号 5–9（全 spiral）→ 每桶 10 样本
    for (const s of ['s1', 's2']) {
      for (let i = 0; i < 5; i++) acc.add(ep({ session: s, index: i }).finalizeOpen())
      for (let i = 5; i < 10; i++) acc.add(ep({ session: s, index: i, spiral: true }).finalizeOpen())
    }
    const rot = acc.build().summary.context_rot!
    expect(rot.buckets.length).toBe(2)
    expect(rot.buckets[0]).toMatchObject({ index_from: 0, index_to: 4, episodes: 10 })
    expect(rot.buckets[0].rot_rate).toBe(0)
    expect(rot.buckets[1].rot_rate).toBe(1)
    expect(rot.baseline_rot_rate).toBe(0)
    expect(rot.inflection_index).toBe(5)
    expect(rot.low_confidence).toBe(false)
  })
  it('样本不足 → low_confidence、无拐点', () => {
    const acc = new EpisodeAccumulator()
    acc.add(ep({ index: 0 }).finalizeOpen())
    acc.add(ep({ index: 6, spiral: true }).finalizeOpen())
    const rot = acc.build().summary.context_rot!
    expect(rot.low_confidence).toBe(true)
    expect(rot.inflection_index).toBeNull()
  })
})

const cxWindow = { fromYmd: '2026-06-05', toYmd: '2026-06-05', desc: '2026-06-05' }
const clWindow = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('codex parser → episode effort/compacted', () => {
  const r = parseCodex('test/fixtures/codex-effort', cxWindow, 'episode') as any
  it('turn_context.effort 挂到 episode；压缩事件标记 compacted', () => {
    const eps = r.episodes_detail as any[]
    expect(eps.length).toBe(2)
    const first = eps.find((e) => e.index === 0)!
    const second = eps.find((e) => e.index === 1)!
    expect(first.effort).toBe('high')
    expect(first.compacted).toBe(true)
    expect(first.model).toBe('gpt-5.1-codex')
    expect(second.effort).toBe('medium')
    expect(second.compacted).toBeUndefined()
    // session 级分布保持不变
    expect(r.codex_specific.effort).toEqual({ high: 1, medium: 1 })
    expect(r.episode_summary.effort_calibration.some((row: any) => row.dial === 'effort' && row.value === 'high')).toBe(true)
  })
})

describe('claude parser → thinking_directive / model / file_churn', () => {
  it('ultrathink prompt → thinking_directive；回合主导 model；普通 prompt 不标', () => {
    const r = parseClaudeCode('test/fixtures/claude-effort', clWindow, 'episode') as any
    const eps = r.episodes_detail as any[]
    expect(eps.length).toBe(2)
    const first = eps.find((e) => e.index === 0)!
    const second = eps.find((e) => e.index === 1)!
    expect(first.thinking_directive).toBe(true)
    expect(first.model).toBe('claude-opus-4-8')
    expect(second.thinking_directive).toBeUndefined()
    expect(second.model).toBe('claude-sonnet-4-6')
    const rows = r.episode_summary.effort_calibration as any[]
    expect(rows.some((row) => row.dial === 'thinking' && row.value === 'on')).toBe(true)
  })
  it('--scope project → file_churn（仅 basename、集中度）', () => {
    const r = parseClaudeCode('test/fixtures/claude-effort', clWindow, 'project') as any
    const proj = (r.projects as any[])[0]
    expect(proj.file_churn).toBeTruthy()
    expect(proj.file_churn.files).toBe(2)            // a.ts + README.md
    expect(proj.file_churn.edits).toBe(3)            // a.ts ×2 + README ×1
    expect(proj.file_churn.top[0]).toMatchObject({ file: 'a.ts', edits: 2, sessions: 1 })
    expect(proj.file_churn.top3_share).toBe(1)
    // 绝不含路径/目录
    expect(JSON.stringify(proj.file_churn)).not.toContain('/home/u')
  })
})

describe('codex parser → file_churn', () => {
  it('patch_apply_end 跨会话累计、basename 口径', () => {
    const r = parseCodex('test/fixtures/codex-edits', cxWindow, 'project') as any
    const proj = (r.projects as any[])[0]
    expect(proj.file_churn.files).toBe(1)
    expect(proj.file_churn.edits).toBe(3)
    expect(proj.file_churn.top[0]).toMatchObject({ file: 'a.ts', edits: 3, sessions: 1 })
  })
})
