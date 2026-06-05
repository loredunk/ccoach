import { describe, it, expect } from 'vitest'
import { EpisodeBuilder, EpisodeAccumulator } from '../src/episodes.js'

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
    const raw = b.finalize(T(1)) as unknown
    expect(JSON.stringify(raw)).not.toContain('secret-name')
  })
})

// gap-capped 活跃时长：首个 mark 设基线，后续 ≤5min 间隔累加 → 用多 mark 模拟真实持续活动
function markDuration(b: EpisodeBuilder, durSec: number): number {
  b.mark(T(0))
  let acc = 0, cur = 0
  while (acc < durSec) { const step = Math.min(300, durSec - acc); cur += step; acc += step; b.mark(T(cur)) }
  return cur
}
function implEp(idx: number, durSec: number, acc: EpisodeAccumulator): void {
  const b = new EpisodeBuilder('s', 'r', idx, T(0))
  b.addTool('file', true, `a${idx}.ts`, 'ts')
  b.addTool('file', true, `b${idx}.ts`, 'ts')
  b.addTool('file', true, `c${idx}.ts`, 'ts')
  b.addToolResult(false, true)
  const end = markDuration(b, durSec)
  acc.add(b.finalize(T(end)))
}
function expEp(idx: number, durSec: number, acc: EpisodeAccumulator): void {
  const b = new EpisodeBuilder('s', 'r', idx, T(0))
  b.addTool('shell', false, undefined, undefined, true)
  b.addTool('shell', false, undefined, undefined, true)
  b.addToolResult(false)
  const end = markDuration(b, durSec)
  acc.add(b.finalize(T(end)))
}

describe('EpisodeAccumulator', () => {
  it('类型内 p90：同样 400s 在 implement 基线判 outlier、在 experiment 基线不判（去偏）', () => {
    const acc = new EpisodeAccumulator()
    for (let i = 0; i < 9; i++) implEp(i, 60, acc)
    implEp(9, 400, acc)            // implement 异类（慢）
    for (let i = 10; i < 15; i++) expEp(i, 600, acc)
    expEp(15, 400, acc)            // experiment 同样 400s
    const { details, summary } = acc.build()
    const implLong = details.find((d) => d.index === 9)!
    const expSame = details.find((d) => d.index === 15)!
    expect(implLong.task_type).toBe('implement')
    expect(expSame.task_type).toBe('experiment')
    expect(implLong.spiral.time_outlier).toBe(true)   // 400 > implement p90(≈60)
    expect(expSame.spiral.time_outlier).toBe(false)   // 400 < experiment p90(≈600)
    expect(summary.episodes).toBe(16)
  })
  it('最小样本回退：类型内 < MIN_SAMPLES → low_confidence', () => {
    const acc = new EpisodeAccumulator()
    for (let i = 0; i < 6; i++) implEp(i, 60, acc)
    expEp(6, 600, acc)   // experiment 仅 1 个 < 5 → 退全局基线
    const { details } = acc.build()
    expect(details.find((d) => d.index === 6)!.spiral.low_confidence).toBe(true)
    expect(details.find((d) => d.index === 0)!.spiral.low_confidence).toBe(false) // implement 6≥5
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
    expect(summary.autonomy_rate).toBeCloseTo(0.5, 5)
    expect(['micro-manager', 'balanced', 'free-range']).toContain(summary.intervention_style)
  })
})

describe('EpisodeAccumulator · 评审修复', () => {
  it('Finding 1：空回合（无 token、无工具）不计入', () => {
    const acc = new EpisodeAccumulator()
    acc.add(new EpisodeBuilder('s', 'r', 0, T(0)).finalize(T(0)))   // 空回合（连发消息/aborted turn/末尾空 prompt）
    const work = new EpisodeBuilder('s', 'r', 1, T(0)); work.addTool('shell', false)
    acc.add(work.finalize(T(1)))
    expect(acc.build().summary.episodes).toBe(1)
  })
})
describe('EpisodeBuilder · 评审修复', () => {
  it('Finding 2：纯探索（多次 search/read、无错误无编辑）不判 no_progress', () => {
    const b = new EpisodeBuilder('s', 'r', 0, T(0))
    b.addTool('search', false); b.addTool('search', false); b.addTool('search', false); b.addTool('search', false)
    b.addTool('file', false, 'x.ts', 'ts')
    expect(b.finalize(T(5)).spiral.no_progress).toBe(false)
  })
  it('Finding 2：反复改同几个文件、无新文件 → 仍判 no_progress', () => {
    const b = new EpisodeBuilder('s', 'r', 0, T(0))
    b.addTool('file', true, 'a.ts', 'ts')
    b.addTool('file', true, 'a.ts', 'ts'); b.addTool('file', true, 'a.ts', 'ts')
    b.addTool('file', true, 'a.ts', 'ts'); b.addTool('file', true, 'a.ts', 'ts')
    expect(b.finalize(T(5)).spiral.no_progress).toBe(true)
  })
})
