// Scorecard regression (去 Python：.mjs + vitest，取代 tools/test_scorecard.py)。
// 跑 skill 的 scorecard.mjs（zh + en）与 render_dual_platform.mjs，对承诺的不变量做断言：
//   - 四轴齐全且每轴有非空段位标签
//   - zh 与 en 段位本地化（不相等）
//   - rank 标注为本地估算
//   - 渲染 HTML 含成绩卡，且不泄配额% / 密钥
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts')
const FIX = path.join(HERE, 'fixtures', 'scorecard')
const DATA = path.join(FIX, 'merged_sample.json')
const INSIGHTS = path.join(FIX, 'insights_sample.json')

const QUOTA_RE = /配额[^。\n]{0,8}\d+\s*%|quota[^.\n]{0,8}\d+\s*%/i
const SECRET_RE = /sk-[A-Za-z0-9]{6,}|ghp_[A-Za-z0-9]{6,}/
const AXES = new Set(['prompt', 'spending', 'engineering', 'diligence'])

function runNode(script: string, args: string[]): void {
  execFileSync('node', [path.join(SKILL, script), ...args], { encoding: 'utf8' })
}

function scorecard(lang: string, out: string): { axes: { key: string; tier: string }[]; rank_is_estimate: boolean } {
  runNode('scorecard.mjs', ['--data', DATA, '--lang', lang, '--output', out])
  return JSON.parse(readFileSync(out, 'utf8'))
}

describe('scorecard 回归（.mjs，去 Python）', () => {
  it('四轴有段位、zh/en 本地化、估算标注、HTML 有成绩卡、不泄配额%/密钥', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-sc-'))
    try {
      const zh = scorecard('zh', path.join(d, 'zh.json'))
      const en = scorecard('en', path.join(d, 'en.json'))

      for (const [card, lang] of [
        [zh, 'zh'],
        [en, 'en'],
      ] as const) {
        expect(new Set(card.axes.map((a) => a.key)), `[${lang}] axes`).toEqual(AXES)
        for (const a of card.axes) expect(a.tier, `[${lang}] ${a.key} tier`).toBeTruthy()
        expect(card.rank_is_estimate, `[${lang}] rank estimate`).toBe(true)
      }

      const zt = zh.axes.map((a) => a.tier)
      const et = en.axes.map((a) => a.tier)
      expect(zt, 'zh/en tiers localized').not.toEqual(et)

      const htmlPath = path.join(d, 'r.html')
      runNode('render_dual_platform.mjs', [
        '--data', DATA, '--insights', INSIGHTS, '--scorecard', path.join(d, 'zh.json'),
        '--lang', 'zh', '--output', htmlPath,
      ])
      const html = readFileSync(htmlPath, 'utf8')
      expect(html, 'rendered HTML has scorecard section').toContain("class='scorecard'")
      for (const blob of [JSON.stringify(zh), JSON.stringify(en), html]) {
        expect(QUOTA_RE.test(blob), 'no quota-percentage claim').toBe(false)
        expect(SECRET_RE.test(blob), 'no secret-like token').toBe(false)
      }
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
