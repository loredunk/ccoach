// 单平台 merge 容忍度（宿主平台默认，ADR 0042）：只给一个平台 report 也能合并；两个都给则 dual 不变。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MERGE = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts', 'merge_dual_platform.mjs')

const ccReport = {
  tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 },
  cache_hit_rate: 0.2, sessions: 2, active_days: 1, estimated_cost_usd: 1.5,
  model_tokens: [{ model: 'claude-opus-4-8', tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, estimated_cost_usd: 1.5, priced: true }],
  models_timeline: [{ model: 'claude-opus-4-8', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 200, days: [{ date: '2026-06-01', tokens: 200 }] }],
  prompt_signals: { prompts: 2, avg_len: 200, structured_ratio: 0.5, constraint_ratio: 0.5, file_ref_ratio: 0.3, correction_rate: 0.1 },
  generated_for: 'today', endpoints: [],
}
const codexReport = {
  tokens: { input: 300, output: 100, cached_input: 80, reasoning_output: 20, total: 400 },
  cache_hit_rate: 0.3, active_days: 2, sessions: 3, estimated_cost_usd: 2.0, reasoning_ratio: 0.2,
  model_tokens: [{ model: 'gpt-5.4', tokens: { input: 300, cached_input: 80, output: 100, reasoning_output: 20, cache_creation: 0, total: 400 }, estimated_cost_usd: 2.0, priced: true }],
  models_timeline: [{ model: 'gpt-5.4', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 400, days: [{ date: '2026-06-01', tokens: 400 }] }],
  prompt_signals: { prompts: 3, avg_len: 150 },
  generated_for: 'today', endpoints: [],
}

function runMerge(args: string[], dir: string): any {
  const out = path.join(dir, 'merged.json')
  execFileSync('node', [MERGE, ...args, '--output', out], { encoding: 'utf8' })
  return JSON.parse(readFileSync(out, 'utf8'))
}

describe('merge: single-platform tolerance (ADR 0042)', () => {
  it('only --cc-report → platforms has claude_code only', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge1-'))
    try {
      const ccPath = path.join(dir, 'cc.json'); writeFileSync(ccPath, JSON.stringify(ccReport))
      const m = runMerge(['--cc-report', ccPath], dir)
      expect(Object.keys(m.platforms)).toEqual(['claude_code'])
      expect(m.platforms.codex).toBeUndefined()
      expect(m.combined.total_tokens).toBe(200)
      expect(m.combined.total_cost_usd).toBe(1.5)
      expect(m.combined.total_sessions).toBe(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('only --codex-report → platforms has codex only; combined reflects codex', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge2-'))
    try {
      const cxPath = path.join(dir, 'cx.json'); writeFileSync(cxPath, JSON.stringify(codexReport))
      const m = runMerge(['--codex-report', cxPath], dir)
      expect(Object.keys(m.platforms)).toEqual(['codex'])
      expect(m.platforms.claude_code).toBeUndefined()
      expect(m.combined.total_tokens).toBe(400)
      expect(m.combined.total_sessions).toBe(3) // codex behavior sessions fallback
      expect(m.combined.prompt_signals.prompts).toBe(3)
      expect(m.platforms.codex.prompt_signals.prompts).toBe(3) // buildCodex now carries prompt_signals
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('both reports → platforms has both (dual unchanged)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge3-'))
    try {
      const ccPath = path.join(dir, 'cc.json'); writeFileSync(ccPath, JSON.stringify(ccReport))
      const cxPath = path.join(dir, 'cx.json'); writeFileSync(cxPath, JSON.stringify(codexReport))
      const m = runMerge(['--cc-report', ccPath, '--codex-report', cxPath], dir)
      expect(Object.keys(m.platforms).sort()).toEqual(['claude_code', 'codex'])
      expect(m.combined.total_tokens).toBe(600)
      expect(m.combined.total_sessions).toBe(2) // Claude-centric in dual (unchanged)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('neither report → exit non-zero', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge4-'))
    try {
      expect(() => execFileSync('node', [MERGE, '--output', path.join(dir, 'm.json')], { encoding: 'utf8' })).toThrow()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
