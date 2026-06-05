// test/privacy.test.ts
import { describe, it, expect } from 'vitest'
import { buildReport } from '../src/index.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('隐私红线', () => {
  const out = JSON.stringify(
    buildReport({ platform: 'all', window, claudeDir: 'test/fixtures/claude', codexHome: 'test/fixtures/codex' }),
  )
  it('不含 prompt 原文', () => {
    expect(out).not.toContain('保留测试')
  })
  it('不含绝对路径，只含 basename', () => {
    expect(out).not.toContain('/home/u/work')
    expect(out).toContain('ccoach')
  })
  it('不含密钥样式 / 完整命令行 / sidechain 命令', () => {
    expect(out).not.toMatch(/sk-[A-Za-z0-9]{6,}/)
    expect(out).not.toContain('commit -m') // 命令只留首 token / git 子命令
    expect(out).not.toContain('rm -rf') // sidechain 工具命令不泄露
  })
  it('rate_limits 恒 null', () => {
    expect(JSON.parse(out).rate_limits).toBeNull()
  })
})

describe('隐私红线 · episodes', () => {
  const r = buildReport({
    platform: 'claude-code',
    window: { fromYmd: '2026-06-05', toYmd: '2026-06-05', desc: 'd' },
    scope: 'episode',
    claudeDir: 'test/fixtures/claude-episodes-dir',
  })
  const out = JSON.stringify({ episodes_detail: r.episodes_detail, episode_summary: r.episode_summary })
  it('episodes 输出不含文件名 / 路径 / prompt 原文 / 命令全行', () => {
    expect(r.episodes_detail!.length).toBeGreaterThan(0)
    expect(out).not.toContain('parser.ts')            // 文件名不泄
    expect(out).not.toContain('/Users/')              // 绝对路径不泄
    expect(out).not.toMatch(/npm test/)               // 命令原文不泄
    expect(out).not.toMatch(/redo it|implement the parser/) // prompt 原文不泄
  })
})
