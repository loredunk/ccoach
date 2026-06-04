// test/i18n-report.test.ts — T15: 报告骨架 i18n（默认英文，ADR 0025）。
// 闸门：用纯 ASCII 数据渲染 --lang en 时，输出里不得出现任何 CJK/全角标点（=骨架漏译）；
// --lang zh 时应出现已知中文；未知 locale 回退默认语言（en）、不报错。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..', 'skills', 'ai-usage-html-report', 'scripts')
const RENDER_DUAL = path.join(SKILL, 'render_dual_platform.mjs')
const RENDER_ENRICHED = path.join(SKILL, 'render_enriched_codex_report.mjs')

// CJK 统一表意 + CJK 标点（含「」） + 全角字母数字标点（含（）：）。命中 = 骨架未本地化。
const CJK = /[　-〿㐀-䶿一-鿿＀-￯]/

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'ccoach-i18n-'))
}

// 富数据合并 JSON（全 ASCII），尽量触发 endpoint/billing/exec-profile/server-tools/behavior 等带文案的分支。
function mergedAscii() {
  const beh = {
    generated_for: '2026-06-04', sessions: 3, total_tool_calls: 42,
    tools_by_name: [{ name: 'Bash', count: 10 }, { name: 'Edit', count: 8 }],
    top_commands: [{ command: 'git', count: 5 }], tool_categories: { shell: 10, web: 2, file: 8, search: 3, mcp: 1, other: 1 },
    git_habits: [{ command: 'commit', count: 4 }], languages: [{ name: 'TypeScript', count: 6 }], languages_unit: 'files',
    repos: [{ repo: 'ccoach', sessions: 3, tokens: 1000, tool_calls: 0 }],
    hours: [{ hour: 9, tokens: 500, count: 5 }], sources: [{ name: 'cli', count: 3 }],
    extras: ['review cadence ok'],
  }
  const ccTokens = { input: 192128, output: 3553058, cache_read: 28000000, cache_create: 800000, total: 32545186 }
  const cxTokens = { input: 34593032, output: 153180, cache_read: 30000000, reasoning: 40000, total: 34746212 }
  return {
    title: 't', generated_at: '2026-06-04', window: { desc: '2026-06-04' },
    cost: { priced_at: '2026-06-04' },
    platforms: {
      claude_code: {
        // 故意用真实中文 source：renderer 应改用本地化的 src_claude、忽略 data.source（ADR 0025）。
        platform: 'Claude Code', source: 'ccoach + ccusage（本地解析，token/模型）· 官方在线定价', active_days: 2, sessions: 3, date_range: ['2026-06-01', '2026-06-04'],
        tokens: ccTokens, cost_usd: 1.23, cost_is_real: true, cache_hit_rate: 0.99,
        models: [{ model: 'claude-opus-4-8', cost: 1.23, tokens: { input: 192128, cached_input: 28000000, output: 3553058, reasoning_output: 0, cache_creation: 800000, total: 32545186 } }],
        daily_series: [{ date: '2026-06-04', cost: 1.23, tokens: 32545186 }],
        top_sessions: [{ project: '~/ccoach', last: '2026-06-04', cost: 1.0, tokens: 1000, models: ['claude-opus-4-8'] }],
        behavior: beh, claude_specific: { web_search_requests: 3, web_fetch_requests: 2 },
        endpoint: { platform: 'claude-code', endpoint: 'official', official_host: 'api.anthropic.com', relay_suspected: false, auth_mode: 'oauth-subscription', subscription_type: 'max', billing_mode: 'subscription', confidence: 'high', basis: [] },
      },
      codex: {
        platform: 'Codex', source: 'ccoach（本地解析，token/模型）· 官方在线定价', active_days: 1, date_range: ['2026-06-04', '2026-06-04'],
        tokens: cxTokens, cost_usd: 0.5, cost_is_real: true, cache_hit_rate: 0.86,
        models: [{ model: 'gpt-5.4', cost: 0.5, tokens: { input: 34593032, cached_input: 30000000, output: 153180, reasoning_output: 40000, cache_creation: 0, total: 34746212 } }],
        daily_series: [{ date: '2026-06-04', cost: 0.5, tokens: 34746212 }], behavior: { ...beh, languages_unit: 'sessions' },
        billing: { by_plan_tier: { plus: 30000000 }, unclassified: 4746212, sessions_with_plan: 1, sessions_unclassified: 1, confidence: 'spoofable-by-relay' },
        codex_specific: { effort: { high: 5 }, approval_policy: { 'on-request': 6 }, sandbox: { 'workspace-write': 6 }, collaboration_mode: { default: 6 }, originators: { codex_cli_rs: 1 }, compactions: 2, aborted_turns: 1, context_window: 258400, git_repo_identity: true, personality: { pragmatic: 6 } },
        endpoint: { platform: 'codex', endpoint: 'custom', relay_suspected: true, auth_mode: 'apikey', billing_mode: 'api_or_relay', confidence: 'medium', basis: [] },
      },
    },
    combined: { total_cost_usd: 1.73, total_tokens: 67291398, total_sessions: 3 },
  }
}

function renderDual(lang: string | null): string {
  const d = tmp()
  try {
    const dataPath = path.join(d, 'm.json'); const insPath = path.join(d, 'i.json'); const out = path.join(d, 'o.html')
    writeFileSync(dataPath, JSON.stringify(mergedAscii()))
    writeFileSync(insPath, JSON.stringify({ executive_summary: 'All good.', recommendations: [{ title: 'Use cache', text: 'Reuse context.', evidence: 'cache hit 99%' }], insights: [{ title: 'High cache', detail: 'Most input is cached.' }] }))
    const args = [RENDER_DUAL, '--data', dataPath, '--insights', insPath, '--output', out]
    if (lang) args.push('--lang', lang)
    execFileSync('node', args)
    return readFileSync(out, 'utf8')
  } finally { rmSync(d, { recursive: true, force: true }) }
}

function codexReportAscii() {
  return {
    generated_for: '2026-06-04', timezone: 'UTC', sessions: 3, duration: '2h', codex_home: '/home/u/.codex', source: 'glob',
    estimated_cost_usd: 0.5, cache_hit_rate: 0.86, reasoning_ratio: 0.2,
    tokens: { input: 34593032, cached_input: 30000000, output: 153180, reasoning_output: 40000, total: 34746212 },
    tools: { shell_calls: 10, web_searches: 2, file_changes: 8 },
    repos: [{ repo: 'ccoach', sessions: 3, estimated_cost_usd: 0.5, tokens: 1000, language: 'TypeScript', build_systems: ['npm'], test_commands: ['vitest'], file_change_types: [{ type: 'edit', count: 4 }] }],
    sources: [{ name: 'cli', tokens: 1000 }], languages: [{ name: 'TypeScript', tokens: 1000 }],
    git_habits: { command_count: 5, branch_count: 2, top_subcommands: [{ command: 'commit', count: 4 }], review_signals: ['reviews often'], risk_signals: [] },
    project_management: { repos_with_tests: 1, repos_with_build_system: 1, repos_with_ci: 1, documentation_changes: 2, config_changes: 1, signals: ['has CI'] },
  }
}

function renderEnriched(lang: string | null): string {
  const d = tmp()
  try {
    const repPath = path.join(d, 'r.json'); const insPath = path.join(d, 'i.json'); const out = path.join(d, 'o.html')
    writeFileSync(repPath, JSON.stringify(codexReportAscii()))
    writeFileSync(insPath, JSON.stringify({
      title: 'Codex Report', executive_summary: ['Good usage.'],
      recommendations: [{ title: 'Cache', evidence: 'hit 86%', action: 'reuse', priority: 'high' }],
      insight_ladder: [{ title: 'Cache', evidence: ['e1'], meaning: 'm', impact: 'i', drilldown: 'd', intervention: 'act' }],
      session_reviews: [{ repo: 'ccoach', session_id: 's1', summary: 'sum', token_drivers: ['t1'], prompt_issues: ['p1'], better_first_prompt: 'bf', better_followup_prompt: 'bu', next_action: 'na' }],
      project_notes: [{ repo: 'ccoach', summary: 'note', next_action: 'na' }],
    }))
    const args = [RENDER_ENRICHED, '--report', repPath, '--insights', insPath, '--output', out]
    if (lang) args.push('--lang', lang)
    execFileSync('node', args)
    return readFileSync(out, 'utf8')
  } finally { rmSync(d, { recursive: true, force: true }) }
}

describe('T15 报告骨架 i18n（ADR 0025）', () => {
  it('render_dual --lang en：骨架无残留中文/全角标点', () => {
    const html = renderDual('en')
    const m = html.match(CJK)
    expect(m, m ? `found CJK: ${JSON.stringify(html.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40))}` : '').toBeNull()
    expect(html).toContain("<html lang='en'>")
    expect(html).toContain('Executive Summary')
    expect(html).toContain('Input Tokens (incl. cache read)')
  })

  it('render_dual 默认（无 --lang）= 英文', () => {
    const html = renderDual(null)
    expect(html).not.toMatch(CJK)
    expect(html).toContain("<html lang='en'>")
  })

  it('render_dual --lang zh：仍可输出中文', () => {
    const html = renderDual('zh')
    expect(html).toContain('执行摘要')
    expect(html).toContain("<html lang='zh-CN'>")
  })

  it('render_dual 未知 locale 回退默认英文、不报错', () => {
    const html = renderDual('fr')
    expect(html).not.toMatch(CJK)
    expect(html).toContain('Executive Summary')
  })

  it('render_enriched --lang en：骨架无残留中文', () => {
    const html = renderEnriched('en')
    const m = html.match(CJK)
    expect(m, m ? `found CJK: ${JSON.stringify(html.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40))}` : '').toBeNull()
    expect(html).toContain("<html lang='en'>")
    expect(html).toContain('Executive Summary')
  })

  it('render_enriched --lang zh：仍可输出中文', () => {
    const html = renderEnriched('zh')
    expect(html).toContain('执行摘要')
    expect(html).toContain("<html lang='zh-CN'>")
  })
})
