// ADR 0045: the HTML behavior panel shows MCP Top + Skills Top with source attribution.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-ignore — skill 层 .mjs 无类型声明
import { buildClaude } from '../skills/ccoach-insight/scripts/merge_dual_platform.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RENDER = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts', 'render_dual_platform.mjs')

function renderMerged(merged: object, lang = 'en'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-ms-'))
  try {
    const dataPath = path.join(dir, 'm.json'); const insPath = path.join(dir, 'i.json'); const outPath = path.join(dir, 'o.html')
    writeFileSync(dataPath, JSON.stringify(merged))
    writeFileSync(insPath, JSON.stringify({ executive_summary: 'x', insights: [], recommendations: [] }))
    execFileSync('node', [RENDER, '--data', dataPath, '--insights', insPath, '--lang', lang, '--output', outPath])
    return readFileSync(outPath, 'utf8')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const ccRaw = {
  tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 },
  cache_hit_rate: 0.2, sessions: 2, active_days: 1, estimated_cost_usd: 1.5,
  model_tokens: [{ model: 'claude-opus-4-8', tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, estimated_cost_usd: 1.5, priced: true }],
  models_timeline: [{ model: 'claude-opus-4-8', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 200, days: [{ date: '2026-06-01', tokens: 200 }] }],
  prompt_signals: { prompts: 2 }, endpoints: [],
  tools: { total_calls: 5, shell_calls: 1, web_searches: 0, file_changes: 1, top_commands: [], mcp: { total_calls: 3, top_tools: [{ name: 'mcp__playwright__browser_navigate', server: 'playwright', tool: 'browser_navigate', count: 3 }], top_servers: [{ name: 'playwright', count: 3 }] } },
  skills: [{ command: 'superpowers:brainstorming', count: 2, plugin: 'superpowers' }, { command: 'tdd', count: 1 }],
}

describe('render: MCP Top + Skills Top (ADR 0045)', () => {
  it('Claude panel shows MCP tool with server + skill with plugin', () => {
    const cc = buildClaude(ccRaw)
    const html = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { claude_code: cc }, combined: { total_cost_usd: 1.5, total_tokens: 200, total_sessions: 2 } })
    expect(html).toContain('MCP Top')
    expect(html).toContain('browser_navigate')
    expect(html).toContain('playwright')
    expect(html).toContain('Skills Top')
    expect(html).toContain('brainstorming (superpowers)')
    expect(html).toContain('tdd')           // bare skill (no plugin)
    expect(html).not.toContain('tdd (')     // bare skill shows no plugin parens
  })

  it('no MCP/Skills data → no MCP Top / Skills Top headings', () => {
    const ccBare = buildClaude({ ...ccRaw, tools: { total_calls: 1, shell_calls: 1, web_searches: 0, file_changes: 0, top_commands: [] }, skills: [] })
    const html = renderMerged({ generated_at: '2026-06-06', window: { desc: 'today' }, platforms: { claude_code: ccBare }, combined: { total_cost_usd: 1.5, total_tokens: 200, total_sessions: 2 } })
    expect(html).not.toContain('MCP Top')
    expect(html).not.toContain('Skills Top')
  })
})
