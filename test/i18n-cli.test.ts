// test/i18n-cli.test.ts — T(CLI) i18n（默认英文 + --lang zh，ADR 0026）。
// 闸门：默认（en）时 CLI 文本 + 进 --json 的 habits 信号 / 窗口描述 不得含 CJK；zh 含中文；未知 locale 回退 en。
import { describe, it, expect, beforeEach } from 'vitest'
import { setLang, getLang } from '../src/i18n.js'
import { resolveWindow } from '../src/window.js'
import { buildGitHabits, buildProjectMgmt } from '../src/habits.js'
import { emitText } from '../src/emit/text.js'
import { emitJson } from '../src/emit/json.js'
import { Aggregator } from '../src/aggregate.js'

const CJK = /[　-〿㐀-䶿一-鿿＀-￯]/

// 触发 review/risk 信号 + 项目管理信号的输入。
const gitCmds = { status: 3, diff: 2, push: 1 }
const repos = [{ hasTests: false }, { hasTests: true, hasCI: true }]

// 一份较全的报告（含 token / git / 项目事实 / 来源等），用于文本 emitter CJK 闸门。
function sampleReport() {
  const agg = new Aggregator('claude-code')
  agg.applyTokens({ input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, 'claude-opus-4-8', 'ccoach', 's1', new Date('2026-06-02T03:00:00Z'))
  agg.touchSession('s1')
  agg.applyTool('shell', 'git status')
  return agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
}

beforeEach(() => setLang('en')) // 每例先复位默认

describe('CLI i18n（ADR 0026）', () => {
  it('默认即英文（getLang）', () => {
    expect(getLang()).toBe('en')
  })

  it('en：窗口描述 / habits 信号 / 文本 emitter 均无 CJK', () => {
    setLang('en')
    const win = resolveWindow({ days: 7 }, new Date('2026-06-04T12:00:00Z'))
    expect(win.desc).not.toMatch(CJK)
    expect(win.desc).toContain('last 7 days')

    const git = buildGitHabits(gitCmds, 0, 0)
    const pm = buildProjectMgmt(repos)
    const sigBlob = JSON.stringify([git.review_signals, git.risk_signals, pm.signals])
    expect(sigBlob).not.toMatch(CJK)
    expect(sigBlob).toContain('git status') // 信号内容仍可读

    const text = emitText(sampleReport(), false)
    const m = text.match(CJK)
    expect(m, m ? `CJK in CLI text: ${JSON.stringify(text.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 30))}` : '').toBeNull()
    expect(text).toContain('Local-only data')
  })

  it('zh：窗口/信号/文本可输出中文', () => {
    setLang('zh')
    expect(resolveWindow({ days: 7 }, new Date('2026-06-04T12:00:00Z')).desc).toContain('最近')
    expect(JSON.stringify(buildGitHabits(gitCmds, 0, 0))).toContain('经常检查')
    expect(buildProjectMgmt(repos).signals!.join()).toContain('活跃项目')
    expect(emitText(sampleReport(), false)).toContain('仅本机数据')
  })

  it('未知 locale 回退英文', () => {
    setLang('fr')
    expect(getLang()).toBe('en')
    expect(resolveWindow({ days: 7 }, new Date('2026-06-04T12:00:00Z')).desc).not.toMatch(CJK)
    expect(JSON.stringify(buildGitHabits(gitCmds, 0, 0))).not.toMatch(CJK)
  })

  it('emitJson 默认英文 glossary、无 CJK 信号', () => {
    setLang('en')
    const json = emitJson(sampleReport())
    const parsed = JSON.parse(json)
    expect(JSON.stringify(parsed.git_habits ?? {})).not.toMatch(CJK)
    expect(parsed.glossary._about).toContain('Local-machine data only')
  })
})
