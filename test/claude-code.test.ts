// test/claude-code.test.ts
import { describe, it, expect } from 'vitest'
import { parseClaudeCode } from '../src/parsers/claude-code.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('parseClaudeCode', () => {
  it('解析窗口内用量、跳过 sidechain 与窗口外记录', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.tokens.input).toBe(100)        // 不含 sidechain 9999、不含 5/1 的 777
    expect(r.tokens.cached_input).toBe(40)
    expect(r.tokens.cache_creation).toBe(10)
    expect(r.tokens.output).toBe(50)
    expect(r.sessions).toBe(1)
    expect(r.repos[0].repo).toBe('ccoach')
    expect(r.models).toContain('claude-opus-4-8')
  })
  it('工具与 git 习惯', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.tools.shell_calls).toBe(1)
    expect(r.tools.file_changes).toBe(1)
    expect(r.git_habits.command_count).toBe(1)
    expect(r.git_habits.top_subcommands?.[0]).toEqual({ command: 'commit', count: 1 })
  })
  it('prompt 信号仅数值、JSON 不含原文', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.prompt_signals.prompts).toBe(1)
    expect(r.prompt_signals.constraint_ratio).toBe(1)
    expect(JSON.stringify(r)).not.toContain('保留测试')
  })
})
