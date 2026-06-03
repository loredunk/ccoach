// test/error-signals.test.ts
import { describe, it, expect } from 'vitest'
import { classifyError } from '../src/errors.js'
import { parseClaudeCode } from '../src/parsers/claude-code.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('classifyError（固定白名单类别）', () => {
  it('按错误特征归类', () => {
    expect(classifyError('<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>')).toBe('not-read')
    expect(classifyError('fatal: not a git repository\nExit code 128')).toBe('git')
    expect(classifyError('npm error code E404\nExit code 1')).toBe('build')
    expect(classifyError('FAIL test/x.test.ts\n 1 failed')).toBe('test')
    expect(classifyError('EACCES: permission denied, open /etc/x')).toBe('permission')
    expect(classifyError('connect ETIMEDOUT 1.2.3.4:443')).toBe('timeout')
    expect(classifyError('getaddrinfo ENOTFOUND registry.npmjs.org')).toBe('network')
    expect(classifyError('some unknown gobbledygook')).toBe('other')
  })
})

describe('parseClaudeCode error_signals', () => {
  it('工具失败率 / 中断 / api / 按工具 / 按类别（主会话、去重）', () => {
    const e = parseClaudeCode('test/fixtures/claude-errors', window).error_signals
    expect(e.tool_calls).toBe(3) // t1,t2 错 + t3 成功；sidechain 的不计
    expect(e.tool_errors).toBe(2)
    expect(e.error_rate).toBeCloseTo(2 / 3, 4)
    expect(e.interrupted).toBe(1) // u3 interrupted；sidechain u4 不计
    expect(e.api_errors).toBe(1)
    expect(e.by_tool).toEqual(expect.arrayContaining([
      { command: 'Bash', count: 1 },
      { command: 'Edit', count: 1 },
    ]))
    expect(e.by_category).toEqual(expect.arrayContaining([
      { command: 'git', count: 1 },
      { command: 'not-read', count: 1 },
    ]))
  })
  it('隐私：不含原始 stderr / 错误文本 / sidechain 内容 / 密钥', () => {
    const j = JSON.stringify(parseClaudeCode('test/fixtures/claude-errors', window))
    expect(j).not.toContain('fatal: not a git repository')
    expect(j).not.toContain('not been read')
    expect(j).not.toContain('sk-shouldnotleak')
    expect(j).not.toContain('sidechain error')
  })
})
