// deepinsight cover-scorecard 回归：render_deepinsight.mjs 现在可在 masthead 正下方渲染与
// ccoach-insight 完全一致的封面成绩卡（数据走 --usage 合并 JSON + --scorecard scorecard.json）。
// 断言承诺的不变量：
//   - 给了 --usage + --scorecard → 报告含成绩卡 section，且位于 </header> 之后、TL;DR 之前
//   - 不给这两个参数 → 报告与从前一致，无成绩卡（向后兼容）
//   - 渲染出的卡片内容与 insight 渲染器一致（仅单引号实体编码不同：&#x27; ↔ &#39;，浏览器等价）
//   - 不出现百分位 / 配额% / 密钥样式串
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEEP = path.resolve(HERE, '..', 'skills', 'ccoach-deepinsight', 'scripts')
const INSIGHT = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts')
const FIX = path.join(HERE, 'fixtures', 'scorecard')
const USAGE = path.join(FIX, 'merged_sample.json')
const INSIGHTS = path.join(FIX, 'insights_sample.json')

const QUOTA_RE = /配额[^。\n]{0,8}\d+\s*%|quota[^.\n]{0,8}\d+\s*%/i
const SECRET_RE = /sk-[A-Za-z0-9]{6,}|ghp_[A-Za-z0-9]{6,}/
const RANK_RE = /超过了\s*\d+\s*%|beats\s+\d+\s*%/i

const REPORT = {
  project: '<demo>',
  platform: 'claude-code',
  lang: 'en',
  window: 'last 30 days',
  generated_at: '2026-06-15',
  tldr: 'Most churn traced to one oversized module.',
  passes: [
    {
      id: '01',
      kind: 'PROJECT',
      title: 'Repeated edits in one file',
      verdict: { label: 'structural hotspot', tone: 'churn', note: 'edited again and again' },
      findings: [
        {
          title: 'Oversized module',
          category: 'code_structure',
          confidence: 'high',
          root_cause: 'One file threads several layers.',
          fix: 'Split it along the seams.',
        },
      ],
    },
  ],
  honesty: ['task_mix is partly uncalibrated.'],
  privacy: 'Local, read-only.',
}

// scorecard.mjs ships fixture roasts + a fallback title; the model rewrites them at runtime. Pin
// them to fixed strings so both renderers receive identical model-authored fields.
function authoredScorecard(out: string): void {
  execFileSync('node', [path.join(DEEP, 'scorecard.mjs'), '--data', USAGE, '--lang', 'en', '--output', out], { encoding: 'utf8' })
  const sc = JSON.parse(readFileSync(out, 'utf8'))
  sc.title = 'The Midnight High-Roller'
  sc.title_is_fallback = false
  const roasts = ['Light on structure.', 'A high-spend stretch.', 'More shell than edits.', 'Often **late at night**.']
  sc.axes.forEach((a: { roast: string; roast_is_fixture: boolean }, i: number) => {
    a.roast = roasts[i]
    a.roast_is_fixture = false
  })
  writeFileSync(out, JSON.stringify(sc, null, 2))
}

const cardSection = (html: string): string => {
  const s = html.indexOf("<section class='scorecard'>")
  const e = html.indexOf('</section>', s)
  return s < 0 || e < 0 ? '' : html.slice(s, e + '</section>'.length)
}

describe('deepinsight cover scorecard', () => {
  it('renders the card below the masthead with --usage + --scorecard, omits it otherwise, no leaks', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-di-'))
    try {
      const scPath = path.join(d, 'sc.json')
      const reportPath = path.join(d, 'report.json')
      authoredScorecard(scPath)
      writeFileSync(reportPath, JSON.stringify(REPORT))

      // with the card
      const withCard = path.join(d, 'with.html')
      execFileSync(
        'node',
        [path.join(DEEP, 'render_deepinsight.mjs'), '--data', reportPath, '--usage', USAGE, '--scorecard', scPath, '--output', withCard],
        { encoding: 'utf8' },
      )
      const html = readFileSync(withCard, 'utf8')
      expect(html, 'has the scorecard section').toContain("<section class='scorecard'>")
      expect(html, 'card has the brand top-left').toContain("class='sc-brand'")
      expect(html, 'card has the hero stat band').toContain("class='sc-band'")

      // placement: </header> < scorecard section < the TL;DR paragraph
      const head = html.indexOf('</header>')
      const card = html.indexOf("<section class='scorecard'>")
      const tldr = html.indexOf('class="tldr"')
      expect(head, 'masthead present').toBeGreaterThanOrEqual(0)
      expect(card, 'card after masthead').toBeGreaterThan(head)
      expect(card, 'card before tldr').toBeLessThan(tldr)

      // no percentile / quota% / secret-like tokens
      expect(RANK_RE.test(html), 'no percentile rank').toBe(false)
      expect(QUOTA_RE.test(html), 'no quota-percentage claim').toBe(false)
      expect(SECRET_RE.test(html), 'no secret-like token').toBe(false)

      // backward compat: no flags → no card, valid report
      const noCard = path.join(d, 'no.html')
      execFileSync('node', [path.join(DEEP, 'render_deepinsight.mjs'), '--data', reportPath, '--output', noCard], { encoding: 'utf8' })
      const plain = readFileSync(noCard, 'utf8')
      expect(plain, 'no card without flags').not.toContain("<section class='scorecard'>")
      expect(plain, 'still a deep insight report').toContain('Deep')

      // content parity with the insight renderer (normalize the apostrophe entity: hex vs decimal)
      const insightHtml = path.join(d, 'insight.html')
      execFileSync(
        'node',
        [path.join(INSIGHT, 'render_dual_platform.mjs'), '--data', USAGE, '--insights', INSIGHTS, '--scorecard', scPath, '--lang', 'en', '--output', insightHtml],
        { encoding: 'utf8' },
      )
      const norm = (s: string) => s.replaceAll('&#x27;', '&#39;')
      expect(norm(cardSection(html)), 'card matches insight card').toBe(norm(cardSection(readFileSync(insightHtml, 'utf8'))))
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
