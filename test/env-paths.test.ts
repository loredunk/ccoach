// test/env-paths.test.ts
// 锁定 env 覆盖路径（CLAUDE_CONFIG_DIR / CODEX_HOME）的解析语义，与直传 dir 等价。
// 回归背景：CLAUDE_CONFIG_DIR 会拼 `<dir>/projects`，CODEX_HOME 会拼 `<dir>/sessions`；
// 若 fixture 不是「家目录」形状（projects/ 缺失），Claude 半边会被静默吞掉、零报错。
// 该路径此前从未被测过（既有测试都走 claudeDir/codexHome 直传 opt，绕过了 env 拼接）。
import { describe, it, expect, afterEach } from 'vitest'
import { buildReport } from '../src/index.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('env path overrides (CLAUDE_CONFIG_DIR / CODEX_HOME)', () => {
  const saved = { c: process.env.CLAUDE_CONFIG_DIR, x: process.env.CODEX_HOME }
  afterEach(() => {
    if (saved.c === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = saved.c
    if (saved.x === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = saved.x
  })

  it('home-shaped fixtures load BOTH platforms via env (no claudeDir/codexHome opts)', () => {
    process.env.CLAUDE_CONFIG_DIR = 'test/fixtures/home/claude'
    process.env.CODEX_HOME = 'test/fixtures/home/codex'
    const r = buildReport({ platform: 'all', window })
    // 必须与直传 dir 等价（cli.test.ts: claude 300 + codex 5100）—— 证明 env 路径不丢半边
    expect(r.tokens.input).toBe(5400)
    expect(r.models).toEqual(expect.arrayContaining(['claude-opus-4-8', 'gpt-5.1']))
  })

  it('CLAUDE_CONFIG_DIR resolves to <dir>/projects (regression: the previously-silent half)', () => {
    process.env.CLAUDE_CONFIG_DIR = 'test/fixtures/home/claude'
    const r = buildReport({ platform: 'claude-code', window })
    expect(r.tokens.input).toBe(300)
    expect(r.models).toContain('claude-opus-4-8')
  })
})
