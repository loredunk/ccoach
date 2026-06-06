// test/text.test.ts
import { describe, it, expect } from 'vitest'
import { firstToken, gitSubcommand, extOf, repoName, comma, GIT_SUBCMDS } from '../src/text.js'
import { emitText } from '../src/emit/text.js'
import { setLang } from '../src/i18n.js'
import { Aggregator } from '../src/aggregate.js'

describe('text utils（隐私安全）', () => {
  it('firstToken 取可执行名、剥 env 前缀与路径', () => {
    expect(firstToken('FOO=bar /usr/bin/rg -n secret')).toBe('rg')
    expect(firstToken('git commit -m "x"')).toBe('git')
    // 小写 env 前缀也要跳过，绝不把 name=value（含密钥值）带进命令名
    expect(firstToken('gh_token=ghp_secret123 gh pr create')).toBe('gh')
    expect(firstToken('x=1 ls')).toBe('ls')
  })
  it('gitSubcommand 只认白名单、未知不泄露', () => {
    expect(gitSubcommand('git commit -m x')).toBe('commit')
    expect(gitSubcommand('git --no-pager diff')).toBe('diff')
    expect(gitSubcommand('git frobnicate-secret')).toBeNull()
    expect(gitSubcommand('rg foo')).toBeNull()
    expect(GIT_SUBCMDS.has('push')).toBe(true)
  })
  it('extOf 只取扩展名', () => {
    expect(extOf('/abs/path/src/main.ts')).toBe('ts')
    expect(extOf('Makefile')).toBe('')
  })
  it('repoName 只取 basename', () => {
    expect(repoName('/Users/x/workspace/ccoach')).toBe('ccoach')
    expect(repoName('')).toBe('(unknown)')
  })
  it('comma 千分位', () => {
    expect(comma(1234567)).toBe('1,234,567')
  })
})

describe('text emit — episode/spiral plain-language notes', () => {
  function makeReport() {
    const agg = new Aggregator('claude-code')
    agg.applyTokens(
      { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 },
      'claude-opus-4-8', 'ccoach', 's1', new Date('2026-06-02T03:00:00Z'),
    )
    agg.touchSession('s1')
    const r = agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
    r.episode_summary = {
      episodes: 3,
      autonomy_rate: 0.5,
      interrupted_rate: 0,
      corrected_rate: 0,
      intervention_style: 'balanced',
      spiral_episodes: 2,
      task_mix: {},
      deepest_pit: undefined,
    }
    return r
  }

  it('prints the episode definition note and (when spirals>0) the spiral note', () => {
    setLang('en')
    const out = emitText(makeReport(), false)
    expect(out).toContain('one instruction you gave')
    expect(out).toContain('got stuck')
  })
})
