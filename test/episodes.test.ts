import { describe, it, expect } from 'vitest'
import { EpisodeBuilder } from '../src/episodes.js'

const T = (s: number) => new Date(2026, 5, 5, 10, 0, s)
const tok = (n: number) => ({ input: n, cached_input: 0, output: n, reasoning_output: 0, cache_creation: 0, total: 2 * n })

describe('EpisodeBuilder', () => {
  it('edit→test→error→edit 同文件 ≥3 次 → edit_ring + 派生计数', () => {
    const b = new EpisodeBuilder('s1', 'repo', 0, T(0))
    b.addTokens(tok(100)); b.mark(T(1))
    b.addTool('file', true, 'a.ts'); b.addTool('shell', false); b.addToolResult(true)  // edit, test 失败
    b.addTool('file', true, 'a.ts'); b.addTool('shell', false); b.addToolResult(true)
    b.addTool('file', true, 'a.ts'); b.addTool('shell', false); b.addToolResult(false) // 第3次后转绿
    b.mark(T(30))
    const raw = b.finalize(T(30))
    expect(raw.spiral.edit_ring).toBe(true)
    expect(raw.maxEditsPerFile).toBe(3)
    expect(raw.filesTouched).toBe(1)
    expect(raw.errorCount).toBe(2)
    expect(raw.interrupted).toBe(false)
    expect(raw.tokens.total).toBe(200)
  })
  it('连续错误 + 文件集合不扩大 → error_dense', () => {
    const b = new EpisodeBuilder('s1', 'repo', 1, T(0))
    b.addTool('shell', false); b.addToolResult(true)
    b.addTool('shell', false); b.addToolResult(true)
    b.addTool('shell', false); b.addToolResult(true)
    const raw = b.finalize(T(5))
    expect(raw.spiral.error_dense).toBe(true)
  })
  it('被打断 → interrupted', () => {
    const b = new EpisodeBuilder('s1', 'repo', 2, T(0))
    b.addTool('shell', false); b.markInterrupted()
    expect(b.finalize(T(1)).interrupted).toBe(true)
  })
  it('finalize 不泄露文件名/序列（只暴露派生计数）', () => {
    const b = new EpisodeBuilder('s1', 'repo', 0, T(0))
    b.addTool('file', true, 'secret-name.ts')
    const raw = b.finalize(T(1)) as unknown
    expect(JSON.stringify(raw)).not.toContain('secret-name')
  })
})
