// test/merge-extras.test.ts — skill 层透传 + 渲染 billing/endpoint/codex_specific/claude_specific
// （ADR 0022 D1-D4 / 0023 D1-D2）。验证 ccoach 的新字段经 merge 进合并 JSON、再经 render 进 HTML。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-ignore — skill 层 .mjs 无类型声明（运行时导入，仅用于透传单测）
import { buildClaude, buildCodex } from '../skills/ccoach-insight/scripts/merge_dual_platform.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RENDER = path.resolve(HERE, '..', 'skills', 'ccoach-insight', 'scripts', 'render_dual_platform.mjs')

// 合成 ccoach codex 报告（含 billing / codex_specific / endpoints）。
function codexReport(endpoint: Record<string, unknown>) {
  return {
    tokens: { input: 100, output: 50, cached_input: 40, reasoning_output: 10, total: 200 },
    model_tokens: [{ model: 'gpt-5.4', tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 10, cache_creation: 0, total: 200 }, estimated_cost_usd: 0.1, priced: true }],
    models_timeline: [{ model: 'gpt-5.4', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 200, estimated_cost_usd: 0.1, days: [{ date: '2026-06-01', tokens: 200 }] }],
    cache_hit_rate: 0.4, reasoning_ratio: 0.2,
    billing: { by_plan_tier: { plus: 150 }, unclassified: 50, sessions_with_plan: 1, sessions_unclassified: 1, confidence: 'spoofable-by-relay' },
    codex_specific: { effort: { high: 5, medium: 1 }, approval_policy: { 'on-request': 6 }, sandbox: { 'workspace-write': 6 }, collaboration_mode: { default: 6 }, originators: { codex_cli_rs: 1 }, compactions: 2, aborted_turns: 1, context_window: 258400, git_repo_identity: true, personality: { pragmatic: 6 } },
    endpoints: [endpoint],
  }
}
function ccBehavior(endpoint: Record<string, unknown>) {
  return {
    tokens: { input: 100, output: 50, cached_input: 40, cache_creation: 10, total: 200 },
    claude_specific: { web_search_requests: 3, web_fetch_requests: 2 },
    endpoints: [endpoint],
  }
}
const ccDaily = { totals: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 40, cacheCreationTokens: 10, totalTokens: 200, totalCost: 0 }, daily: [{ date: '2026-06-01', totalCost: 0, totalTokens: 200, modelBreakdowns: [] }] }
const ccSession = { sessions: [] }

describe('merge：billing/codex_specific/endpoint/claude_specific 透传（ADR 0022/0023）', () => {
  it('buildCodex 透传 billing / codex_specific / 对应平台 endpoint', () => {
    const cx = buildCodex(codexReport({ platform: 'codex', endpoint: 'official', official_host: 'chatgpt.com', relay_suspected: false, auth_mode: 'chatgpt', billing_mode: 'subscription', confidence: 'high', basis: [] }), null)
    expect(cx.billing.by_plan_tier).toEqual({ plus: 150 })
    expect(cx.codex_specific.effort).toEqual({ high: 5, medium: 1 })
    expect(cx.endpoint.billing_mode).toBe('subscription')
  })
  it('buildClaude 透传 claude_specific / 对应平台 endpoint', () => {
    const cc = buildClaude(ccDaily, ccSession, ccBehavior({ platform: 'claude-code', endpoint: 'official', official_host: 'api.anthropic.com', relay_suspected: false, auth_mode: 'oauth-subscription', subscription_type: 'max', billing_mode: 'subscription', confidence: 'high', basis: [] }))
    expect(cc.claude_specific).toEqual({ web_search_requests: 3, web_fetch_requests: 2 })
    expect(cc.endpoint.subscription_type).toBe('max')
  })
})

describe('render：新区块进 HTML（官方 + 中转两路）', () => {
  function renderWith(cxEp: Record<string, unknown>, ccEp: Record<string, unknown>): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge-'))
    try {
      const cx = buildCodex(codexReport(cxEp), null)
      const cc = buildClaude(ccDaily, ccSession, ccBehavior(ccEp))
      const merged = { title: 't', generated_at: '2026-06-04', window: { desc: 'w' }, platforms: { claude_code: cc, codex: cx }, combined: { total_cost_usd: 0, total_tokens: 400, total_sessions: 0 } }
      const dataPath = path.join(dir, 'merged.json')
      const insPath = path.join(dir, 'insights.json')
      const outPath = path.join(dir, 'out.html')
      writeFileSync(dataPath, JSON.stringify(merged))
      writeFileSync(insPath, JSON.stringify({ executive_summary: 'x', insights: [], recommendations: [] }))
      // 用 --lang zh 渲染：本测试断言中文标签，默认语言已翻英（ADR 0025），故显式指定 zh。
      execFileSync('node', [RENDER, '--data', dataPath, '--insights', insPath, '--lang', 'zh', '--output', outPath])
      return readFileSync(outPath, 'utf8')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('官方端点：渲染端点卡 + plan tier 拆分 + 执行画像 + 官方直连', () => {
    const html = renderWith(
      { platform: 'codex', endpoint: 'official', official_host: 'chatgpt.com', relay_suspected: false, auth_mode: 'chatgpt', billing_mode: 'subscription', confidence: 'high', basis: [] },
      { platform: 'claude-code', endpoint: 'official', official_host: 'api.anthropic.com', relay_suspected: false, auth_mode: 'oauth-subscription', subscription_type: 'max', billing_mode: 'subscription', confidence: 'high', basis: [] },
    )
    expect(html).toContain('端点 / 计费模式')
    expect(html).toContain('官方直连')
    expect(html).toContain('计费拆分（订阅 plan tier）')
    expect(html).toContain('plan: plus')
    expect(html).toContain('未分类（无 plan_type）')
    expect(html).toContain('执行画像（Codex 独有）')
    expect(html).toContain('订阅档')
    expect(html).not.toContain('used_percent') // 隐私：不输出配额%
  })

  it('中转端点：渲染 ⚠️ 疑似中转 + 自定义/中转端点 + 计费 API/中转', () => {
    const html = renderWith(
      { platform: 'codex', endpoint: 'custom', relay_suspected: true, auth_mode: 'apikey', billing_mode: 'api_or_relay', confidence: 'high', basis: [] },
      { platform: 'claude-code', endpoint: 'custom', relay_suspected: true, auth_mode: 'auth-token', billing_mode: 'api_or_relay', confidence: 'high', basis: [] },
    )
    expect(html).toContain('疑似中转')
    expect(html).toContain('自定义 / 中转端点')
    expect(html).toContain('API / 中转')
  })
})
