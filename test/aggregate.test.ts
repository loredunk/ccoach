// test/aggregate.test.ts
import { describe, it, expect } from 'vitest'
import { Aggregator } from '../src/aggregate.js'

describe('Aggregator', () => {
  it('累计 token/成本、派生 cache_hit_rate，assemble 出 Report', () => {
    const agg = new Aggregator('claude-code')
    const t = new Date('2026-06-02T03:00:00Z')
    agg.applyTokens({ input: 100, cached_input: 40, output: 50, reasoning_output: 0,
      cache_creation: 0, total: 150 }, 'claude-opus-4-8', 'ccoach', 's1', t)
    agg.applyTokens({ input: 10, cached_input: 5, output: 8, reasoning_output: 2,
      cache_creation: 3, total: 21 }, 'gpt-5.4', 'ccoach', 's1', t)
    agg.touchSession('s1')
    const r = agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
    expect(r.tokens.input).toBe(110)
    expect(r.tokens.total).toBe(171)
    // model_tokens 每类桶之和 == 顶层 tokens（供 skill 层联网官方价计价的基石，ADR 0019）
    const mt = r.model_tokens!
    for (const k of ['input', 'cached_input', 'output', 'reasoning_output', 'cache_creation', 'total'] as const) {
      expect(mt.reduce((a, m) => a + m.tokens[k], 0)).toBe(r.tokens[k])
    }
    expect(mt.find((m) => m.model === 'claude-opus-4-8')!.priced).toBe(true)
    // 统一口径 cached/(cached+非缓存输入)：claude 互斥桶 fresh=100 + codex fresh=(10-5)=5；cached=40+5
    expect(r.cache_hit_rate).toBeCloseTo(45 / 150, 6)
    expect(r.sessions).toBe(1)
    expect(r.repos[0].repo).toBe('ccoach')
    expect(r.estimated_cost_usd).toBeGreaterThan(0)
    expect(r.rate_limits).toBeNull()
    expect(r.glossary?._about).toContain('Local-machine data only')
  })
  it('活跃时长只累计 ≤5min 的相邻间隔', () => {
    const agg = new Aggregator('codex')
    const base = new Date('2026-06-02T03:00:00Z')
    agg.markActive(base)
    agg.markActive(new Date(base.getTime() + 2 * 60 * 1000))   // +2min → 计入
    agg.markActive(new Date(base.getTime() + 60 * 60 * 1000))  // +60min → 不计
    expect(agg.durationSeconds()).toBe(120)
  })
  it('--json 输出封顶防 token 爆炸（repos / models_timeline.days）', () => {
    const agg = new Aggregator('claude-code')
    const t0 = Date.UTC(2026, 0, 1)
    const tok = (n: number) => ({ input: n, cached_input: 0, output: 0, reasoning_output: 0, cache_creation: 0, total: n })
    for (let i = 0; i < 60; i++) agg.applyTokens(tok(i + 1), 'claude-opus-4-8', 'repo' + i, 's', new Date(t0))
    for (let d = 0; d < 40; d++) agg.applyTokens(tok(1), 'gpt-5.1', 'r', 's', new Date(t0 + d * 86400000))
    const r = agg.assemble({ fromYmd: '2026-01-01', toYmd: '2026-12-31', desc: 'd' }, 'glob')
    expect(r.repos.length).toBeLessThanOrEqual(50) // 60 个 repo → 封顶 50
    const mt = r.models_timeline!.find((m) => m.model === 'gpt-5.1')!
    expect(mt.days.length).toBeLessThanOrEqual(31) // 40 天 → days[] 封顶 31
    expect(mt.tokens).toBe(40) // 但 tokens 仍为真实全量
    expect(mt.first_day).toBe('2026-01-01') // first_day 不受 days[] 截断影响
  })
})
