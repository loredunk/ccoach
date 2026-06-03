// test/cli.test.ts
import { describe, it, expect } from 'vitest'
import { buildReport } from '../src/index.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('buildReport', () => {
  it('platform=all 合并两平台 token', () => {
    const r = buildReport({ platform: 'all', window,
      claudeDir: 'test/fixtures/claude', codexHome: 'test/fixtures/codex' })
    expect(r.platform).toBe('all')
    expect(r.tokens.input).toBe(5400) // claude 300（含 sidechain、去重后）+ codex 5100（主会话 100 + 子代理 rollout 5000）
    expect(r.models).toEqual(expect.arrayContaining(['claude-opus-4-8', 'gpt-5.1']))
  })
  it('platform=claude-code 只含 Claude', () => {
    const r = buildReport({ platform: 'claude-code', window, claudeDir: 'test/fixtures/claude' })
    expect(r.tokens.input).toBe(300)
  })
})
