// test/model.test.ts
import { describe, it, expect } from 'vitest'
import { REPORT_GLOSSARY, emptyTokens, type Report } from '../src/model.js'

describe('model', () => {
  it('glossary 含核心口径键且声明仅本机/不含配额', () => {
    expect(REPORT_GLOSSARY._about).toContain('仅本机')
    expect(REPORT_GLOSSARY._about).toContain('rate_limits')
    expect(REPORT_GLOSSARY).toHaveProperty('cache_hit_rate')
    expect(REPORT_GLOSSARY).toHaveProperty('estimated_cost_usd')
  })
  it('emptyTokens 全零', () => {
    expect(emptyTokens()).toEqual({
      input: 0, cached_input: 0, output: 0, reasoning_output: 0,
      cache_creation: 0, total: 0,
    })
  })
})
