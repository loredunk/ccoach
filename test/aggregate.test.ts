// test/aggregate.test.ts
import { describe, it, expect } from 'vitest'
import { Aggregator } from '../src/aggregate.js'

describe('Aggregator', () => {
  it('累计 token/成本、派生 cache_hit_rate，assemble 出 Report', () => {
    const agg = new Aggregator('claude-code')
    const t = new Date('2026-06-02T03:00:00Z')
    agg.applyTokens({ input: 100, cached_input: 40, output: 50, reasoning_output: 0,
      cache_creation: 0, total: 150 }, 'claude-opus-4-8', 'ccoach', 's1', t)
    agg.touchSession('s1')
    const r = agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
    expect(r.tokens.input).toBe(100)
    expect(r.tokens.total).toBe(150)
    expect(r.cache_hit_rate).toBeCloseTo(40 / 140, 6)   // 统一口径：cached/(cached+非缓存输入)
    expect(r.sessions).toBe(1)
    expect(r.repos[0].repo).toBe('ccoach')
    expect(r.estimated_cost_usd).toBeGreaterThan(0)
    expect(r.rate_limits).toBeNull()
    expect(r.glossary?._about).toContain('仅本机')
  })
  it('活跃时长只累计 ≤5min 的相邻间隔', () => {
    const agg = new Aggregator('codex')
    const base = new Date('2026-06-02T03:00:00Z')
    agg.markActive(base)
    agg.markActive(new Date(base.getTime() + 2 * 60 * 1000))   // +2min → 计入
    agg.markActive(new Date(base.getTime() + 60 * 60 * 1000))  // +60min → 不计
    expect(agg.durationSeconds()).toBe(120)
  })
})
