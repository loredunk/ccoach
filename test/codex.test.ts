// test/codex.test.ts
import { describe, it, expect } from 'vitest'
import { parseCodex } from '../src/parsers/codex.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('parseCodex（glob）', () => {
  it('用 last_token_usage 累计、识别模型与 repo', () => {
    const r = parseCodex('test/fixtures/codex', window)
    expect(r.tokens.input).toBe(100)
    expect(r.tokens.cached_input).toBe(40)
    expect(r.tokens.reasoning_output).toBe(10)
    expect(r.tokens.total).toBe(150)
    expect(r.models).toContain('gpt-5.1')
    expect(r.repos[0].repo).toBe('ccoach')
    expect(r.git_habits.top_subcommands?.[0]).toEqual({ command: 'status', count: 1 })
  })
  it('跳过 subagent 文件', () => {
    const r = parseCodex('test/fixtures/codex', window)
    expect(r.tokens.input).toBe(100) // subagent 的用量未计入
  })
})
