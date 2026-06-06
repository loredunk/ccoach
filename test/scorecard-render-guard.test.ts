// ADR 0044: the renderer must DETECT a still-fallback persona title / fixture roast,
// emit a stderr warning, and leave a visible HTML marker — but still render (offline/test 兜底, ADR 0029).
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts')
const FIX = path.join(HERE, 'fixtures', 'scorecard')
const DATA = path.join(FIX, 'merged_sample.json')
const INSIGHTS = path.join(FIX, 'insights_sample.json')
const RENDER = path.join(SKILL, 'render_dual_platform.mjs')

function buildScorecard(d: string): string {
  const out = path.join(d, 'sc.json')
  execFileSync('node', [path.join(SKILL, 'scorecard.mjs'), '--data', DATA, '--lang', 'en', '--output', out], { encoding: 'utf8' })
  return out
}
function render(d: string, scPath: string): { html: string; stderr: string } {
  const out = path.join(d, 'r.html')
  const res = spawnSync('node', [RENDER, '--data', DATA, '--insights', INSIGHTS, '--scorecard', scPath, '--lang', 'en', '--output', out], { encoding: 'utf8' })
  return { html: readFileSync(out, 'utf8'), stderr: res.stderr ?? '' }
}

describe('scorecard render-order guard (ADR 0044)', () => {
  it('fallback scorecard → HTML marker + stderr warning, still renders', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-guard-'))
    try {
      const scPath = buildScorecard(d)
      const { html, stderr } = render(d, scPath)
      expect(html).toContain("class='scorecard'")                       // still renders
      expect(html).toContain('<!-- ccoach:scorecard_title_is_fallback -->')
      expect(html).toContain('<!-- ccoach:roast_is_fixture -->')
      expect(stderr).toContain('scorecard:')                             // warned
    } finally { rmSync(d, { recursive: true, force: true }) }
  })

  it('rewritten scorecard → no marker, persona title shown, no warning', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-guard2-'))
    try {
      const scPath = buildScorecard(d)
      const card = JSON.parse(readFileSync(scPath, 'utf8'))
      card.title = '深夜烧 Opus 的劳模架构师'
      card.title_is_fallback = false
      for (const ax of card.axes) { ax.roast = 'rewritten'; ax.roast_is_fixture = false }
      writeFileSync(scPath, JSON.stringify(card))
      const { html, stderr } = render(d, scPath)
      expect(html).toContain('深夜烧 Opus 的劳模架构师')
      expect(html).not.toContain('<!-- ccoach:scorecard_title_is_fallback -->')
      expect(stderr).not.toContain('scorecard:')
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})
