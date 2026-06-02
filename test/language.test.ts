// test/language.test.ts
import { describe, it, expect } from 'vitest'
import { extToLanguage, dominantLanguage } from '../src/language.js'

describe('language', () => {
  it('extToLanguage 映射扩展名（大小写无关）', () => {
    expect(extToLanguage('ts')).toBe('TypeScript')
    expect(extToLanguage('GO')).toBe('Go')
    expect(extToLanguage('xyz')).toBeUndefined()
  })
  it('dominantLanguage 取主导编程语言、忽略文档/配置/数据', () => {
    expect(dominantLanguage({ ts: 5, md: 9, json: 3 })).toBe('TypeScript') // md/json 不算"语言"
    expect(dominantLanguage(new Map([['go', 2], ['ts', 3]]))).toBe('TypeScript')
    expect(dominantLanguage({ md: 4 })).toBeUndefined() // 仅文档 → 无主导语言
    expect(dominantLanguage({})).toBeUndefined()
  })
})
