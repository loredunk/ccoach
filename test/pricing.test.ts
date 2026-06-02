// test/pricing.test.ts
import { describe, it, expect } from 'vitest'
import { estimateCost } from '../src/pricing.js'

describe('estimateCost', () => {
  it('Codex：非缓存输入×输入价 + 缓存×缓存读价 + 输出×输出价', () => {
    // gpt-5.1: input 1.25, cachedInput 0.125, output 10.0（/1e6）
    const c = estimateCost({ input: 1_000_000, cached_input: 0, output: 1_000_000,
      reasoning_output: 0, cache_creation: 0, total: 2_000_000 }, 'gpt-5.1')
    expect(c.priced).toBe(true)
    expect(c.usd).toBeCloseTo(1.25 + 10.0, 6)
  })
  it('Claude：cache_creation 用写入价、cache_read 用读取价', () => {
    const c = estimateCost({ input: 1_000_000, cached_input: 1_000_000, output: 0,
      reasoning_output: 0, cache_creation: 1_000_000, total: 3_000_000 }, 'claude-opus-4-8')
    expect(c.priced).toBe(true)
    expect(c.usd).toBeGreaterThan(0)
  })
  it('未知模型 priced=false、usd=0', () => {
    expect(estimateCost({ input: 100, cached_input: 0, output: 0, reasoning_output: 0,
      cache_creation: 0, total: 100 }, 'mystery')).toEqual({ usd: 0, priced: false })
  })
})
