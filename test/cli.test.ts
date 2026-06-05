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

describe('buildReport · episode scope', () => {
  const w = { fromYmd: '2026-06-05', toYmd: '2026-06-05', desc: 'd' }
  it('--scope episode 产出 episodes_detail + episode_summary', () => {
    const r = buildReport({ platform: 'claude-code', window: w, scope: 'episode', claudeDir: 'test/fixtures/claude-episodes-dir' })
    expect(r.scope).toBe('episode')
    expect(r.episode_summary!.episodes).toBe(2)
    expect(r.episodes_detail!.length).toBe(2)
  })
  it('默认 global 加性：有 episode_summary、无 episodes_detail', () => {
    const g = buildReport({ platform: 'claude-code', window: w, claudeDir: 'test/fixtures/claude-episodes-dir' })
    expect(g.episodes_detail).toBeUndefined()
    expect(g.episode_summary).toBeDefined()
  })
})
