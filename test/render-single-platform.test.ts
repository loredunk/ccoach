// 单平台渲染（宿主平台默认，ADR 0042）：只画在场平台、隐藏对比区、副标题标平台范围；dual 仍两栏 + 对比。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-ignore — skill 层 .mjs 无类型声明（运行时导入）
import { buildClaude, buildCodex } from '../skills/ccoach-insight/scripts/merge_dual_platform.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RENDER = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts', 'render_dual_platform.mjs')

const ccRaw = { tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, cache_hit_rate: 0.2, sessions: 2, active_days: 1, estimated_cost_usd: 1.5, model_tokens: [{ model: 'claude-opus-4-8', tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, estimated_cost_usd: 1.5, priced: true }], models_timeline: [{ model: 'claude-opus-4-8', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 200, days: [{ date: '2026-06-01', tokens: 200 }] }], prompt_signals: { prompts: 2 }, endpoints: [] }
const cxRaw = { tokens: { input: 300, output: 100, cached_input: 80, reasoning_output: 20, total: 400 }, cache_hit_rate: 0.3, active_days: 2, sessions: 3, estimated_cost_usd: 2.0, reasoning_ratio: 0.2, model_tokens: [{ model: 'gpt-5.4', tokens: { input: 300, cached_input: 80, output: 100, reasoning_output: 20, cache_creation: 0, total: 400 }, estimated_cost_usd: 2.0, priced: true }], models_timeline: [{ model: 'gpt-5.4', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 400, days: [{ date: '2026-06-01', tokens: 400 }] }], prompt_signals: { prompts: 3 }, endpoints: [] }

function renderMerged(merged: object, lang = 'en'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-rs-'))
  try {
    const dataPath = path.join(dir, 'm.json'); const insPath = path.join(dir, 'i.json'); const outPath = path.join(dir, 'o.html')
    writeFileSync(dataPath, JSON.stringify(merged))
    writeFileSync(insPath, JSON.stringify({ executive_summary: 'x', insights: [], recommendations: [] }))
    execFileSync('node', [RENDER, '--data', dataPath, '--insights', insPath, '--lang', lang, '--output', outPath])
    return readFileSync(outPath, 'utf8')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('render: single-platform (ADR 0042)', () => {
  it('Claude-only → CC panel, no comparison, no Codex panel', () => {
    const cc = buildClaude(ccRaw)
    const html = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { claude_code: cc }, combined: { total_cost_usd: 1.5, total_tokens: 200, total_sessions: 2 } })
    expect(html).toContain('<h2>Claude Code</h2>')
    expect(html).not.toContain('Platform Comparison')
    expect(html).not.toContain('<h2>Codex</h2>')
    expect(html).toContain('Platform: Claude Code')
    // REQ1: single-platform report must NOT show a dual-platform behavior heading
    expect(html).not.toContain('symmetric across platforms')
    expect(html).toContain('Usage Behavior Profile')
    const zhHtml = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { claude_code: cc }, combined: { total_cost_usd: 1.5, total_tokens: 200, total_sessions: 2 } }, 'zh')
    expect(zhHtml).not.toContain('两平台对称')
    expect(zhHtml).toContain('使用行为画像')
  })
  it('Codex-only → Codex panel, no comparison, no Claude panel', () => {
    const cx = buildCodex(cxRaw)
    const html = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { codex: cx }, combined: { total_cost_usd: 2.0, total_tokens: 400, total_sessions: 3 } })
    expect(html).toContain('<h2>Codex</h2>')
    expect(html).not.toContain('Platform Comparison')
    expect(html).not.toContain('<h2>Claude Code</h2>')
    expect(html).toContain('Platform: Codex')
  })
  it('dual → both panels + comparison (regression)', () => {
    const cc = buildClaude(ccRaw); const cx = buildCodex(cxRaw)
    const html = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { claude_code: cc, codex: cx }, combined: { total_cost_usd: 3.5, total_tokens: 600, total_sessions: 2 } })
    expect(html).toContain('<h2>Claude Code</h2>')
    expect(html).toContain('<h2>Codex</h2>')
    expect(html).toContain('Platform Comparison')
    expect(html).toContain('Platform: Claude Code + Codex')
  })
})
