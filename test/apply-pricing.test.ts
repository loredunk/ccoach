// apply_pricing.mjs 回归：成本由 skill 层联网官方价确定性计算（ADR 0019）。
// 断言 Claude 互斥桶 vs Codex cached⊆input 两套口径、未命中回退、cost_is_real 标记、combined 求和。
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOD = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts', 'apply_pricing.mjs')
const { priceModel, applyPricing } = await import(MOD)

describe('priceModel', () => {
  it('Claude 家族走互斥桶（input/cached_input/cache_creation 各按各价，不相减）', () => {
    const tokens = { input: 1e6, cached_input: 1e6, output: 1e6, cache_creation: 1e6 }
    const price = { input: 5, cached_input: 0.5, output: 25, cache_creation: 6.25 }
    // 1e6 token 各 1 个百万 → 5 + 0.5 + 25 + 6.25
    expect(priceModel(tokens, price)).toBeCloseTo(36.75, 6)
  })

  it('Codex/gpt 走 cached⊆input（非缓存部分按 input 价，cached 按缓存价）', () => {
    const tokens = { input: 1e6, cached_input: 4e5, output: 1e6 } // 无 cache_creation
    const price = { input: 2.5, cached_input: 0.25, output: 15 }
    // nonCached=0.6M*2.5 + cached=0.4M*0.25 + output=1M*15 = 1.5 + 0.1 + 15
    expect(priceModel(tokens, price)).toBeCloseTo(16.6, 6)
  })
})

describe('applyPricing', () => {
  const makeData = () => ({
    platforms: {
      claude_code: { models: [
        { model: 'claude-opus-4-8', tokens: { input: 1e6, cached_input: 1e6, output: 1e6, cache_creation: 1e6, total: 4e6 }, cost: 999, priced: true },
        { model: 'claude-haiku-4-5', tokens: { input: 1e6, cached_input: 0, output: 1e6, cache_creation: 0, total: 2e6 }, cost: 7.5, priced: true }, // 故意无官方价 → 回退
        { model: '<synthetic>', tokens: { input: 0, cached_input: 0, output: 0, cache_creation: 0, total: 0 }, cost: 0, priced: false },
      ] },
      codex: { models: [
        { model: 'gpt-5.4', tokens: { input: 1e6, cached_input: 4e5, output: 1e6, reasoning_output: 0, cache_creation: 0, total: 24e5 }, cost: 1, priced: true },
      ] },
    },
    combined: { total_cost_usd: 0 },
  })
  const pricing = { queried_at: '2026-06-03', models: {
    'claude-opus-4-8': { input: 5, cached_input: 0.5, output: 25, cache_creation: 6.25, source: 'anthropic' },
    'gpt-5.4': { input: 2.5, cached_input: 0.25, output: 15, source: 'openai' },
  } }

  it('按官方价重写成本、标 cost_basis/priced_at、combined 求和', () => {
    const d = applyPricing(makeData(), pricing)
    const cc = d.platforms.claude_code, cx = d.platforms.codex
    expect(cc.models[0].cost).toBeCloseTo(36.75, 4) // opus 互斥桶
    expect(cx.models[0].cost).toBeCloseTo(16.6, 4)  // gpt-5.4 subset
    expect(cc.cost_basis).toBe('official-online')
    expect(cc.priced_at).toBe('2026-06-03')
    expect(d.combined.total_cost_usd).toBeCloseTo(cc.cost_usd + cx.cost_usd, 2)
  })

  it('未查到官方价的模型回退离线 fallback 并标 partial / unpriced_models', () => {
    const d = applyPricing(makeData(), pricing)
    const cc = d.platforms.claude_code, cx = d.platforms.codex
    expect(cc.models[1].cost).toBeCloseTo(7.5, 4)          // haiku 保留离线 fallback
    expect(cc.cost_is_real).toBe('partial')
    expect(cc.unpriced_models).toContain('claude-haiku-4-5')
    expect(cx.cost_is_real).toBe(true)                      // codex 全命中
    expect(cx.unpriced_models).toBeUndefined()
  })

  it('total=0 的占位模型（<synthetic>）成本归零、不计入 unpriced', () => {
    const d = applyPricing(makeData(), pricing)
    const synth = d.platforms.claude_code.models[2]
    expect(synth.cost).toBe(0)
    expect(d.platforms.claude_code.unpriced_models ?? []).not.toContain('<synthetic>')
  })
})
