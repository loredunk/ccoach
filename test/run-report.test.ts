// test/run-report.test.ts
// CLI 默认命令核心（选项 → buildReport → emit）的可测接缝。
// 重点锁 --claude-dir / --codex-home：直传数据目录、消除 CLAUDE_CONFIG_DIR 的 `+/projects` 隐式拼接坑。
import { describe, it, expect } from 'vitest'
import { runReport } from '../src/run-report.js'

describe('runReport (CLI default-command core)', () => {
  it('--claude-dir / --codex-home thread directly to buildReport — both platforms, no /projects footgun', () => {
    const out = runReport({
      json: true,
      platform: 'all',
      date: '2026-06-02',
      claudeDir: 'test/fixtures/claude', // projects 目录直传（jsonl 在根下，无需 home 形状）
      codexHome: 'test/fixtures/codex',  // home（内部读 <dir>/sessions）
    })
    const j = JSON.parse(out)
    expect(j.tokens.input).toBe(5400) // 与 cli.test.ts 直传 dir 一致：claude 300 + codex 5100
    expect(j.models).toEqual(expect.arrayContaining(['claude-opus-4-8', 'gpt-5.1']))
  })

  it('--claude-dir alone loads only Claude from the projects dir directly', () => {
    const out = runReport({
      json: true,
      platform: 'claude-code',
      date: '2026-06-02',
      claudeDir: 'test/fixtures/claude',
    })
    const j = JSON.parse(out)
    expect(j.tokens.input).toBe(300)
    expect(j.models).toContain('claude-opus-4-8')
  })

  it('rejects an invalid --platform', () => {
    expect(() => runReport({ json: true, platform: 'bogus' })).toThrow(/invalid --platform/)
  })
})
