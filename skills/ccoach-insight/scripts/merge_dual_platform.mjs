#!/usr/bin/env node
// Merge Claude Code + Codex usage into one dual-platform JSON. Both platforms' tokens & model
// list are authoritative local facts from ccoach's offline parse — ccusage is NOT used at skill
// runtime (it stays a dev/CI cross-check only; ccoach's own per-model attribution now matches
// ccusage within ~0.04%, see ADR 0030). COST is NOT computed here — it's left as an offline
// fallback and recomputed by apply_pricing.mjs from official online prices the agent looks up
// (per actual model name).
//
// Inputs (all JSON files produced beforehand by ccoach):
//   --cc-report       ccoach report --platform claude-code --json   (Claude tokens + model_tokens + models_timeline + behavior)
//   --cc-sessions     ccoach sessions --platform claude-code --top N (OPTIONAL; top sessions by token, numeric only — no prompt text)
//   --codex-report    ccoach report --platform codex --json         (Codex tokens + model_tokens + behavior)
//   --output          merged dual-platform JSON path
//
// Both platforms expose a unified `behavior` block (tools / git_habits /
// languages / repos / hours / sources) so the renderer can show them symmetrically.
//
// Privacy: only aggregate counts/costs are read. No prompt text, session content,
// file paths beyond project basenames, or secrets are touched.
//
// Pure Node ≥18 (ESM, no external deps, offline).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const load = (p) => JSON.parse(readFileSync(p, 'utf8'))
const round = (x, n = 0) => {
  const f = 10 ** n
  return Math.round(Number(x) * f) / f
}
const comma = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0).toLocaleString('en-US')

function todayIso() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) o[a.slice(2)] = argv[++i]
  }
  return o
}

// Unify ccoach's model_tokens[] into { model, tokens:{...buckets}, cost(offline fallback), priced }
// so apply_pricing.mjs can price every model the same way (online official prices). Platform-neutral
// — Claude (disjoint buckets, cache_creation>0) and Codex (cached⊆input) share the same shape.
// Cost here is the CLI offline fallback; apply_pricing overwrites it with official online prices.
function unifyModelTokens(modelTokens) {
  return (modelTokens ?? [])
    .filter((m) => (m.tokens?.total ?? 0) > 0)
    .map((m) => ({ model: m.model, tokens: m.tokens, cost: round(m.estimated_cost_usd ?? 0, 4), priced: m.priced ?? false }))
}

// Top Claude sessions by token (numeric only — repo/tokens/models; NO prompt text, NO cost:
// per-session cost is no longer sourced since cost is per-model official-online). From
// `ccoach sessions --platform claude-code --top N` (privacy: aggregate counts only).
function topClaudeSessions(sessionsJson, n = 5) {
  const list = sessionsJson?.sessions ?? (Array.isArray(sessionsJson) ? sessionsJson : [])
  return [...list]
    .sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))
    .slice(0, n)
    .map((s) => ({
      project: s.repo ?? '(unknown)',
      last: typeof s.last === 'string' ? s.last.slice(0, 10) : '', // date only
      tokens: s.tokens ?? 0,
      models: (s.models ?? []).filter((m) => m && m !== '<synthetic>'),
    }))
}
// Derive a daily {date,tokens} series from a CLI report's models_timeline (used for both
// platforms' sparklines). Sums per-day tokens across models. Note: models_timeline caps
// days[] to the last ~31 days and models to the top 10 by token, so very wide windows show a
// recent/top-model sparkline — first_day/last_day/totals stay exact (ADR 0030).
function dailyFromTimeline(report) {
  const byDay = new Map()
  for (const mt of report?.models_timeline ?? []) {
    for (const d of mt.days ?? []) byDay.set(d.date, (byDay.get(d.date) ?? 0) + (d.tokens ?? 0))
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, tokens]) => ({ date, cost: 0, tokens }))
}

// True activity date range from models_timeline's per-model first_day/last_day — these are the
// real full-window endpoints (uncapped; only days[] is capped to ~31). Used for date_range so wide
// windows aren't truncated to the sparkline's last-31-day view (ADR 0030 fix from review).
function rangeFromTimeline(report) {
  let lo = null
  let hi = null
  for (const mt of report?.models_timeline ?? []) {
    if (mt.first_day && (lo === null || mt.first_day < lo)) lo = mt.first_day
    if (mt.last_day && (hi === null || mt.last_day > hi)) hi = mt.last_day
  }
  return lo && hi ? [lo, hi] : []
}

// Known git subcommands; anything else (e.g. a leaked path captured by a parser)
// is dropped from the rendered git-habits list so no absolute path or arbitrary
// token reaches the report.
const GIT_SUBCMDS = new Set([
  'add', 'commit', 'push', 'pull', 'fetch', 'diff', 'status', 'log',
  'checkout', 'branch', 'merge', 'rebase', 'stash', 'show', 'reset',
  'clone', 'switch', 'restore', 'tag', 'cherry-pick', 'revert',
  'rev-parse', 'remote', 'init', 'blame',
])

// Reduce command labels to a safe basename token (strip any path), drop anything
// still containing a slash so no absolute path reaches the report.
function cleanCommands(cmds) {
  const out = []
  for (const c of cmds ?? []) {
    const base = ((c.command ?? '').trim().split('/').pop()) ?? ''
    if (!base || base.includes('/')) continue
    out.push({ command: base, count: c.count ?? 0 })
  }
  return out
}

// Keep only recognised git subcommands (privacy: drop leaked paths/tokens).
function cleanGit(subs) {
  const out = []
  for (const s of subs ?? []) {
    const cmd = (s.command ?? '').toLowerCase()
    if (GIT_SUBCMDS.has(cmd)) out.push({ command: cmd, count: s.count ?? 0 })
  }
  return out
}

// Normalize hour list to [{hour, tokens, count}] (sparse hours kept).
function normHours(hours, countKey = null) {
  const out = []
  for (const h of hours ?? []) {
    const fallback = countKey === null ? (h.tokens ?? 0) : (h[countKey] ?? 0)
    out.push({ hour: h.hour ?? 0, tokens: h.tokens ?? 0, count: h.count ?? fallback })
  }
  return out
}

// i18n for the few behavior `extras` prefixes composed here (default English, ADR 0026).
// (git/pm signals come already-localized from `ccoach report --lang`; these are merge-added labels.)
const MERGE_I18N = {
  en: { perm: 'Permission modes: ', sep: ', ', subagent: (n) => `${n} subagent messages`, reasoning: (p) => `reasoning ${p}% of output` },
  zh: { perm: '权限模式: ', sep: '、', subagent: (n) => `子代理消息 ${n} 条`, reasoning: (p) => `推理 token 占比 ${p}%` },
}
const mlang = (lang) => MERGE_I18N[lang] ?? MERGE_I18N.en

// Normalize `ccoach report --platform claude-code --json` (a unified Report) into
// the renderer's behavior shape. Claude tokens / model_tokens / behavior all come from ccoach
// (offline local parse); cost is recomputed by apply_pricing from official online prices.
export function claudeBehavior(r, lang = 'en') {
  if (!r) return null
  const tools = r.tools ?? {}
  const cats = tools.categories ?? {
    shell: tools.shell_calls ?? 0, web: tools.web_searches ?? 0, file: tools.file_changes ?? 0,
  }
  const git = r.git_habits ?? {}
  const pm = r.project_management ?? {}
  const env = r.environment ?? {}
  // Drop any signal containing a path-like token so no absolute path leaks.
  const safe = (sigs, n) => (sigs ?? []).filter((s) => !String(s).includes('/')).slice(0, n)
  const L = mlang(lang)
  const extras = []
  const pmodes = env.permission_modes ?? []
  if (pmodes.length) extras.push(L.perm + pmodes.slice(0, 4).map((p) => `${p.command}×${p.count}`).join(L.sep))
  if (env.subagent_messages) extras.push(L.subagent(env.subagent_messages))
  extras.push(...safe(git.review_signals, 3), ...safe(git.risk_signals, 2), ...safe(pm.signals, 3))
  return {
    generated_for: r.generated_for ?? null,
    sessions: r.sessions ?? 0,
    total_tool_calls: tools.total_calls ?? 0,
    tools_by_name: (tools.by_name ?? []).map((x) => ({ name: x.name, count: x.count })),
    top_commands: cleanCommands(tools.top_commands ?? []),
    tool_categories: cats,
    git_habits: cleanGit(git.top_subcommands ?? []),
    languages: (r.file_languages ?? []).slice(0, 10).map((l) => ({ name: l.name, count: l.files ?? 0 })),
    languages_unit: 'files', // 中性键；renderer 按 --lang 本地化（ADR 0025）
    repos: (r.repos ?? []).slice(0, 10).map((x) => ({
      repo: x.repo, sessions: x.sessions ?? 0, tokens: x.tokens ?? 0, tool_calls: 0,
    })),
    hours: normHours(r.hours ?? []),
    sources: (r.sources ?? []).map((s) => ({ name: s.name, count: s.sessions ?? 0 })),
    extras,
  }
}

// Normalize ccoach report --json into the unified behavior shape.
export function codexBehavior(r, lang = 'en') {
  if (!r) return null
  const tools = r.tools ?? {}
  const cats = { shell: tools.shell_calls ?? 0, web: tools.web_searches ?? 0, file: tools.file_changes ?? 0 }
  const repos = (r.repos ?? []).slice(0, 10).map((x) => ({
    repo: x.repo, sessions: x.sessions ?? 0, tokens: x.tokens ?? 0, tool_calls: 0,
  }))
  const git = r.git_habits ?? {}
  const pm = r.project_management ?? {}
  // Drop any signal containing a path-like token so no absolute path leaks.
  const safe = (sigs, n) => (sigs ?? []).filter((s) => !String(s).includes('/')).slice(0, n)
  const extras = [...safe(git.review_signals, 3), ...safe(git.risk_signals, 2), ...safe(pm.signals, 3)]
  if (r.reasoning_ratio) extras.push(mlang(lang).reasoning((r.reasoning_ratio * 100).toFixed(1)))
  return {
    generated_for: r.generated_for ?? null,
    sessions: r.sessions ?? 0,
    total_tool_calls: tools.total_calls ?? 0,
    tools_by_name: [], // ccoach doesn't break tools down by name
    top_commands: cleanCommands(tools.top_commands ?? []),
    tool_categories: cats,
    git_habits: cleanGit(git.top_subcommands ?? []),
    languages: (r.languages ?? []).slice(0, 10).map((l) => ({ name: l.name, count: l.sessions ?? 0 })),
    languages_unit: 'sessions', // 中性键；renderer 按 --lang 本地化（ADR 0025）
    repos,
    hours: normHours(r.hours ?? []),
    sources: (r.sources ?? []).map((s) => ({ name: s.name, count: s.sessions ?? 0 })),
    extras,
  }
}

// Claude Code from the ccoach CLI (authoritative tokens + per-model breakdown, offline local
// parse). ccusage is no longer used at skill runtime: ccoach's own model_tokens[] matches
// ccusage's per-line attribution within ~0.04% (ADR 0030; the ~20% gap in ADR 0019 D4 predated
// the streaming "final/max usage" dedup fix). Cost here is the CLI offline fallback; apply_pricing
// overwrites it with official online prices. Daily sparkline derives from models_timeline (same as
// Codex); top sessions come from `ccoach sessions --top N` (numeric only — no prompt text, no cost).
export function buildClaude(report, sessions = null, lang = 'en') {
  const r = report ?? {}
  const tok = r.tokens ?? {}
  const models = unifyModelTokens(r.model_tokens)
  const series = dailyFromTimeline(r)
  const range = rangeFromTimeline(r)
  const dateRange = range.length ? range : series.length ? [series[0].date, series[series.length - 1].date] : []
  return {
    platform: 'Claude Code',
    // tokens/模型来自 ccoach 本地解析；成本由 skill 层联网官方价计算（apply_pricing）。
    source: 'ccoach（本地解析，token/模型）· 官方在线定价',
    active_days: r.active_days ?? series.length,
    sessions: r.sessions ?? 0,
    date_range: dateRange,
    tokens: {
      input: tok.input ?? 0,
      output: tok.output ?? 0,
      cache_read: tok.cached_input ?? 0,  // Claude: cached_input = cache_read（互斥桶）
      cache_create: tok.cache_creation ?? 0,
      total: tok.total ?? 0,
    },
    cost_usd: round(r.estimated_cost_usd ?? 0, 2), // 离线 fallback；apply_pricing 用官方价覆盖
    cost_is_real: true,                            // 默认离线 fallback；apply_pricing 按官方价覆盖
    cache_hit_rate: round(r.cache_hit_rate ?? 0, 4),
    models,
    daily_series: series,
    top_sessions: topClaudeSessions(sessions),
    behavior: claudeBehavior(r, lang),
    prompt_signals: r.prompt_signals ?? {},
    episode_summary: r.episode_summary ?? null, // 回合概览（ADR 0032/0034）：自主度/干预风格/任务构成/最深的坑
    // 平台特色 + 端点/计费（ADR 0023 D2 / 0022 D2-D4）：均为派生白名单标签，不含 key/token/完整 URL。
    claude_specific: r.claude_specific ?? null,
    endpoint: (r.endpoints ?? []).find((e) => e.platform === 'claude-code') ?? null,
  }
}

// Codex from the ccoach CLI (authoritative tokens + per-model breakdown, offline local parse).
// Cost is computed later by apply_pricing.mjs from online official prices over the CLI's
// model_tokens[]. Daily sparkline derives from the report's models_timeline (same as Claude).
export function buildCodex(codexReport, lang = 'en') {
  const r = codexReport ?? {}
  const tok = r.tokens ?? {}
  const afTotal = tok.total ?? 0
  const models = unifyModelTokens(r.model_tokens)

  // Daily sparkline derived from the CLI report's models_timeline.
  const series = dailyFromTimeline(r)
  const range = rangeFromTimeline(r)
  const dateRange = range.length ? range : series.length ? [series[0].date, series[series.length - 1].date] : []

  return {
    platform: 'Codex',
    // tokens/模型来自 ccoach 本地解析；成本由 skill 层联网官方价计算（apply_pricing）。
    source: 'ccoach（本地解析，token/模型）· 官方在线定价',
    active_days: r.active_days ?? series.length,
    date_range: dateRange,
    tokens: {
      input: tok.input ?? 0,
      output: tok.output ?? 0,
      cache_read: tok.cached_input ?? 0,
      reasoning: tok.reasoning_output ?? 0,
      total: afTotal,
    },
    cost_usd: round(r.estimated_cost_usd ?? 0, 2), // 离线 fallback；apply_pricing 用官方价覆盖
    cost_is_real: true,                            // 默认离线 fallback；apply_pricing 按官方价覆盖
    cache_hit_rate: round(r.cache_hit_rate ?? 0, 4),
    models,
    daily_series: series,
    behavior: codexBehavior(r, lang),
    episode_summary: r.episode_summary ?? null, // 回合概览（ADR 0032/0034）
    // 计费维度 + 执行画像 + 端点（ADR 0022 D1-D4 / 0023 D1）：均为派生计数/白名单标签，不含敏感内容。
    billing: r.billing ?? null,
    codex_specific: r.codex_specific ?? null,
    endpoint: (r.endpoints ?? []).find((e) => e.platform === 'codex') ?? null,
  }
}

// Build a unified统计窗口 block from a CLI report's generated_for (= window.desc),
// e.g. "today" / "最近 7 天 (…)" / "2026-05-01 至 2026-06-03" / a bare date.
function buildWindow(reports) {
  const desc = reports.map((r) => r?.generated_for).find(Boolean) ?? null
  let kind = 'today', from = null, to = null
  if (desc) {
    const range = desc.match(/(\d{4}-\d{2}-\d{2})\s*[至到~\-]\s*(\d{4}-\d{2}-\d{2})/)
    const single = desc.match(/^(\d{4}-\d{2}-\d{2})$/)
    if (range) { kind = 'range'; from = range[1]; to = range[2] }
    else if (/最近\s*\d+\s*天/.test(desc)) { kind = 'days'; const m = desc.match(/(\d{4}-\d{2}-\d{2})/g); if (m) { from = m[0]; to = m[m.length - 1] } }
    else if (single) { kind = 'date'; from = to = single[1] }
    else kind = 'today'
  }
  return { desc, kind, from, to }
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  // Required: --cc-report / --codex-report (both ccoach offline parses) + --output.
  // --cc-sessions is OPTIONAL (top Claude sessions table; degrades to empty if absent).
  for (const k of ['cc-report', 'codex-report', 'output']) {
    if (!a[k]) {
      process.stderr.write(`missing --${k}\n`)
      process.exit(2)
    }
  }
  const lang = a.lang || 'en' // 默认英文（ADR 0026）；与 ccoach report / scorecard / render 同传
  const ccReport = load(a['cc-report'])
  const codexReport = load(a['codex-report'])
  const ccSessions = a['cc-sessions'] ? load(a['cc-sessions']) : null
  const claude = buildClaude(ccReport, ccSessions, lang)
  const codex = buildCodex(codexReport, lang)

  const merged = {
    title: 'Dual-Platform AI Usage Report', // 不再用于显示（renderer 按 --lang 取标题，ADR 0025）；保留字段兼容

    generated_at: todayIso(),
    window: buildWindow([codexReport, ccReport]),
    platforms: { claude_code: claude, codex: codex },
    combined: {
      total_cost_usd: round(claude.cost_usd + codex.cost_usd, 2),
      total_tokens: claude.tokens.total + codex.tokens.total,
      total_sessions: claude.sessions, // Claude 会话数（Codex 会话数在其面板单列）
      prompt_signals: ccReport.prompt_signals ?? {},
    },
  }
  writeFileSync(a.output, JSON.stringify(merged, null, 2))
  console.log(`wrote ${a.output}`)
  console.log(`  统计窗口: ${merged.window.desc ?? '(unknown)'}`)
  console.log(`  Claude Code: ${claude.sessions} sessions, $${claude.cost_usd}, ${comma(claude.tokens.total)} tokens`)
  console.log(`  Codex: ${codex.active_days} days, $${codex.cost_usd}, ${comma(codex.tokens.total)} tokens (empty=${codex.tokens.total === 0})`)
  console.log('  注：成本为离线 fallback；跑 apply_pricing.mjs 用联网官方价覆盖。')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
