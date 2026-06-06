// test/claude-noise.test.ts
import { describe, it, expect } from 'vitest'
import { parseClaudeCode } from '../src/parsers/claude-code.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('parseClaudeCode — machine-injected user records are not prompts/episodes', () => {
  it('only the real instruction counts; isMeta / command-stub / interrupt are excluded', () => {
    const r = parseClaudeCode('test/fixtures/claude-noise', window)
    expect(r.prompt_signals.prompts).toBe(1) // not 4
    expect(r.episode_summary?.episodes).toBe(1) // the one real instruction, with token activity
  })

  it('the excluded records leave no raw text in the JSON', () => {
    const j = JSON.stringify(parseClaudeCode('test/fixtures/claude-noise', window))
    expect(j).not.toContain('system-reminder')
    expect(j).not.toContain('command-name')
    expect(j).not.toContain('Request interrupted')
    expect(j).not.toContain('local-command-stdout')
  })
})
