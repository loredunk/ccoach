// Scorecard regression (去 Python：.mjs + vitest，取代 tools/test_scorecard.py)。
// 跑 skill 的 scorecard.mjs（zh + en）与 render_dual_platform.mjs，对承诺的不变量做断言：
//   - 四轴齐全且每轴有非空段位标签 + 非空 roast
//   - zh 与 en 段位本地化（不相等）
//   - 渲染 HTML 含成绩卡 + 品牌 + 数字带，且不出现百分位、不泄配额% / 密钥
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
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
// percentile/rank was removed — the report must never claim "beats X% of users" / "超过了 X% 的用户"
const RANK_RE = /超过了\s*\d+\s*%|beats\s+\d+\s*%/i
const AXES = new Set(['prompt', 'spending', 'engineering', 'diligence'])

type Axis = { key: string; tier: string; roast: string }

function runNode(script: string, args: string[]): void {
  execFileSync('node', [path.join(SKILL, script), ...args], { encoding: 'utf8' })
}

function scorecard(lang: string, out: string): { axes: Axis[] } {
  runNode('scorecard.mjs', ['--data', DATA, '--lang', lang, '--output', out])
  return JSON.parse(readFileSync(out, 'utf8'))
}

describe('scorecard 回归（.mjs，去 Python）', () => {
  it('四轴有段位+roast、zh/en 本地化、HTML 有成绩卡/品牌/数字带、无百分位、不泄配额%/密钥', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-sc-'))
    try {
      const zh = scorecard('zh', path.join(d, 'zh.json'))
      const en = scorecard('en', path.join(d, 'en.json'))

      for (const [card, lang] of [
        [zh, 'zh'],
        [en, 'en'],
      ] as const) {
        expect(new Set(card.axes.map((a) => a.key)), `[${lang}] axes`).toEqual(AXES)
        for (const a of card.axes) {
          expect(a.tier, `[${lang}] ${a.key} tier`).toBeTruthy()
          expect(a.roast, `[${lang}] ${a.key} roast`).toBeTruthy()
        }
        // rank 字段已彻底移除
        expect('rank_pct' in card, `[${lang}] no rank_pct`).toBe(false)
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
      expect(html, 'card has the brand top-left').toContain("class='sc-brand'")
      expect(html, 'card has the hero stat band').toContain("class='sc-band'")
      expect(RANK_RE.test(html), 'no percentile rank in HTML').toBe(false)
      for (const blob of [JSON.stringify(zh), JSON.stringify(en), html]) {
        expect(QUOTA_RE.test(blob), 'no quota-percentage claim').toBe(false)
        expect(SECRET_RE.test(blob), 'no secret-like token').toBe(false)
      }
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('Codex-only merged JSON → 成绩卡评宿主(Codex)数据，不塌（ADR 0042）', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-sc-cx-'))
    try {
      const codexOnly = {
        platforms: {
          codex: {
            cost_usd: 12, active_days: 6, sessions: 8, tokens: { total: 500000 },
            models: [{ model: 'gpt-5.4', cost: 12 }],
            behavior: { tool_categories: { shell: 10, file: 30 }, repos: [{ repo: 'a' }, { repo: 'b' }], hours: [{ hour: 14, count: 20 }], sessions: 8 },
            prompt_signals: { prompts: 5, avg_len: 300, structured_ratio: 0.6, constraint_ratio: 0.5, file_ref_ratio: 0.4, correction_rate: 0.1 },
          },
        },
        combined: { total_cost_usd: 12, total_tokens: 500000, total_sessions: 8, prompt_signals: {} },
      }
      const dataPath = path.join(d, 'codex-only.json')
      writeFileSync(dataPath, JSON.stringify(codexOnly))
      const out = path.join(d, 'card.json')
      execFileSync('node', [path.join(SKILL, 'scorecard.mjs'), '--data', dataPath, '--lang', 'en', '--output', out], { encoding: 'utf8' })
      const card = JSON.parse(readFileSync(out, 'utf8'))
      expect(new Set(card.axes.map((a: { key: string }) => a.key))).toEqual(AXES)
      for (const a of card.axes) expect(a.tier, `${a.key} tier`).toBeTruthy()
      const dil = card.axes.find((a: { key: string }) => a.key === 'diligence')
      // 宿主=Codex 时 active_days=6 → Workhorse(0)；旧逻辑(host={}) active_days=0 → 会落到 index 2
      expect(dil.tier_index).toBe(0)
      const eng = card.axes.find((a: { key: string }) => a.key === 'engineering')
      // 宿主=Codex：2 repos / 8 sessions → reposPerSession 0.25 → Architect(0)，不是 Archaeologist(3)
      expect(eng.tier_index).toBe(0)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})
