// test/verify-tolerance.test.ts
import { describe, it, expect } from 'vitest'
import { withinTolerance } from '../scripts/verify-ccusage.js'

describe('withinTolerance', () => {
  it('token 必须完全相等', () => {
    expect(withinTolerance({ tokens: 100, cost: 1.0 }, { tokens: 100, cost: 1.0 })).toBe(true)
    expect(withinTolerance({ tokens: 100, cost: 1.0 }, { tokens: 101, cost: 1.0 })).toBe(false)
  })
  it('成本允许 1% 相对误差（费率表/四舍五入差异）', () => {
    expect(withinTolerance({ tokens: 100, cost: 1.000 }, { tokens: 100, cost: 1.005 })).toBe(true)
    expect(withinTolerance({ tokens: 100, cost: 1.000 }, { tokens: 100, cost: 1.2 })).toBe(false)
  })
})
