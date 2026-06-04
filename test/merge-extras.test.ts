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
// 合成 ccoach claude-code 报告（含 tokens / model_tokens / models_timeline / claude_specific / endpoints）。
// ADR 0030 后 buildClaude 直接吃 ccoach report，不再吃 ccusage 的 cc-daily/cc-session。
function ccReport(endpoint: Record<string, unknown>) {
  return {
    tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 },
    cache_hit_rate: 0.2857,
    sessions: 1,
    estimated_cost_usd: 0,
    model_tokens: [{ model: 'claude-opus-4-8', tokens: { input: 100, cached_input: 40, output: 50, reasoning_output: 0, cache_creation: 10, total: 200 }, estimated_cost_usd: 0, priced: true }],
    models_timeline: [{ model: 'claude-opus-4-8', first_day: '2026-06-01', last_day: '2026-06-01', tokens: 200, estimated_cost_usd: 0, days: [{ date: '2026-06-01', tokens: 200 }] }],
    prompt_signals: { prompts: 1, avg_len: 10, structured_ratio: 0, file_ref_ratio: 0, constraint_ratio: 0, correction_rate: 0 },
    claude_specific: { web_search_requests: 3, web_fetch_requests: 2 },
    endpoints: [endpoint],
  }
}

describe('merge：billing/codex_specific/endpoint/claude_specific 透传（ADR 0022/0023）', () => {
  it('buildCodex 透传 billing / codex_specific / 对应平台 endpoint', () => {
    const cx = buildCodex(codexReport({ platform: 'codex', endpoint: 'official', official_host: 'chatgpt.com', relay_suspected: false, auth_mode: 'chatgpt', billing_mode: 'subscription', confidence: 'high', basis: [] }))
    expect(cx.billing.by_plan_tier).toEqual({ plus: 150 })
    expect(cx.codex_specific.effort).toEqual({ high: 5, medium: 1 })
    expect(cx.endpoint.billing_mode).toBe('subscription')
  })
  it('buildClaude 透传 claude_specific / 对应平台 endpoint', () => {
    const cc = buildClaude(ccReport({ platform: 'claude-code', endpoint: 'official', official_host: 'api.anthropic.com', relay_suspected: false, auth_mode: 'oauth-subscription', subscription_type: 'max', billing_mode: 'subscription', confidence: 'high', basis: [] }))
    expect(cc.claude_specific).toEqual({ web_search_requests: 3, web_fetch_requests: 2 })
    expect(cc.endpoint.subscription_type).toBe('max')
  })
})

describe('render：新区块进 HTML（官方 + 中转两路）', () => {
  function renderWith(cxEp: Record<string, unknown>, ccEp: Record<string, unknown>): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-merge-'))
    try {
      const cx = buildCodex(codexReport(cxEp))
      const cc = buildClaude(ccReport(ccEp))
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

describe('render：sparkline 画每日 token（非平线回归，ADR 0030）', () => {
  // 回归守卫：daily_series 现在只带 tokens（cost 为 per-model 联网价、无每日成本），
  // sparkline 必须画 token；若误画 cost(=0) 会退化成基线平线（评审发现的回归）。
  it('多天 token 有变化时 sparkline polyline 不是平线', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-spark-'))
    try {
      const ccReportMultiDay = {
        tokens: { input: 600, cached_input: 0, output: 300, reasoning_output: 0, cache_creation: 0, total: 900 },
        cache_hit_rate: 0, sessions: 3, active_days: 3, estimated_cost_usd: 0,
        model_tokens: [{ model: 'claude-opus-4-8', tokens: { input: 600, cached_input: 0, output: 300, reasoning_output: 0, cache_creation: 0, total: 900 }, estimated_cost_usd: 0, priced: true }],
        models_timeline: [{
          model: 'claude-opus-4-8', first_day: '2026-06-01', last_day: '2026-06-03', tokens: 900, estimated_cost_usd: 0,
          days: [{ date: '2026-06-01', tokens: 100 }, { date: '2026-06-02', tokens: 700 }, { date: '2026-06-03', tokens: 100 }],
        }],
        prompt_signals: {}, endpoints: [],
      }
      const cc = buildClaude(ccReportMultiDay)
      // daily_series 必须带每日 token、且有变化
      expect(cc.daily_series.map((d: { tokens: number }) => d.tokens)).toEqual([100, 700, 100])
      // 真实区间来自 models_timeline first/last（未封顶）
      expect(cc.date_range).toEqual(['2026-06-01', '2026-06-03'])
      expect(cc.active_days).toBe(3)
      const merged = { title: 't', generated_at: '2026-06-05', window: { desc: 'w' }, platforms: { claude_code: cc, codex: buildCodex({ tokens: {}, model_tokens: [] }) }, combined: { total_cost_usd: 0, total_tokens: 900, total_sessions: 3 } }
      const dataPath = path.join(dir, 'm.json'); const insPath = path.join(dir, 'i.json'); const outPath = path.join(dir, 'o.html')
      writeFileSync(dataPath, JSON.stringify(merged))
      writeFileSync(insPath, JSON.stringify({ executive_summary: 'x', insights: [], recommendations: [] }))
      execFileSync('node', [RENDER, '--data', dataPath, '--insights', insPath, '--lang', 'zh', '--output', outPath])
      const html = readFileSync(outPath, 'utf8')
      const m = html.match(/<polyline[^>]*points='([^']+)'/)
      expect(m).toBeTruthy()
      const ys = m![1].split(' ').map((p) => parseFloat(p.split(',')[1]))
      const distinct = new Set(ys.map((y) => y.toFixed(1)))
      expect(distinct.size).toBeGreaterThan(1) // 非平线：中间高、两端低
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
