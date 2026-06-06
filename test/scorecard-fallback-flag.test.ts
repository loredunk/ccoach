// ADR 0044: scorecard.mjs ships fallback markers so the renderer can detect that the
// persona title / roasts were not rewritten by the model before rendering.
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

function buildCard(out: string): { title: string; title_is_fallback: boolean; axes: { key: string; roast_is_fixture: boolean }[] } {
  execFileSync('node', [path.join(SKILL, 'scorecard.mjs'), '--data', DATA, '--lang', 'en', '--output', out], { encoding: 'utf8' })
  return JSON.parse(readFileSync(out, 'utf8'))
}

describe('scorecard fallback flags (ADR 0044)', () => {
  it('raw scorecard marks title_is_fallback and every roast roast_is_fixture', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccoach-fb-'))
    try {
      const card = buildCard(path.join(d, 'c.json'))
      expect(card.title).toContain(' × ')           // deterministic A × B × C × D join
      expect(card.title_is_fallback).toBe(true)
      expect(card.axes.length).toBe(4)
      expect(new Set(card.axes.map((a: { key: string }) => a.key))).toEqual(new Set(['prompt', 'spending', 'engineering', 'diligence']))
      for (const ax of card.axes) expect(ax.roast_is_fixture).toBe(true)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})
