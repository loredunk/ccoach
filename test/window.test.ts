// test/window.test.ts
import { describe, it, expect } from 'vitest'
import { resolveWindow, inLocalRange } from '../src/window.js'

const now = new Date('2026-06-02T10:00:00Z')

describe('resolveWindow', () => {
  it('--date 单日', () => {
    const w = resolveWindow({ date: '2026-05-30' }, now)
    expect(w.desc).toBe('2026-05-30')
    expect(w.fromYmd).toBe('2026-05-30')
    expect(w.toYmd).toBe('2026-05-30')
  })
  it('--days N 含今天', () => {
    const w = resolveWindow({ days: 3 }, now)
    expect(w.fromYmd).toBe('2026-05-31')
    expect(w.toYmd).toBe('2026-06-02')
  })
  it('默认=今天', () => {
    const w = resolveWindow({}, now)
    expect(w.fromYmd).toBe('2026-06-02')
    expect(w.toYmd).toBe('2026-06-02')
  })
  it('--date 非法报错', () => {
    expect(() => resolveWindow({ date: 'nope' }, now)).toThrow(/YYYY-MM-DD/)
  })
})

describe('inLocalRange', () => {
  it('按本地日期边界（含端点）判定', () => {
    const w = resolveWindow({ date: '2026-05-30' }, now)
    expect(inLocalRange(new Date('2026-05-30T23:59:00Z'), w)).toBe(true)
    expect(inLocalRange(new Date('2026-05-31T12:00:00Z'), w)).toBe(false)
  })
})
