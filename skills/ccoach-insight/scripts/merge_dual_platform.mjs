#!/usr/bin/env node
// Merge Claude Code + Codex usage into one dual-platform JSON. Tokens & model list are
// authoritative local facts (ccoach offline parse; ccusage cross-checks Claude per-line
// attribution). COST is NOT computed here — it's left as an offline fallback and recomputed
// by apply_pricing.mjs from official online prices the agent looks up (per actual model name).
//
// Inputs (all JSON files produced beforehand):
//   --cc-daily        ccusage claude daily --json --offline --breakdown  (Claude tokens/days/per-model attribution)
//   --cc-session      ccusage claude session --json --offline            (top sessions)
//   --cc-behavior     ccoach report --platform claude-code --json        (Claude behavior + model_tokens)
//   --codex-report    ccoach report --platform codex --json              (Codex tokens + model_tokens + behavior)
//   --codex-ccusage   ccusage codex daily --json --offline   (OPTIONAL historical sparkline; often unavailable)
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

export function aggregateCcModels(ccDaily) {
  // Aggregate Claude Code per-model totals across all days.
  const models = new Map()
  for (const day of ccDaily.daily ?? []) {
    for (const b of day.modelBreakdowns ?? []) {
      const name = b.modelName ?? 'unknown'
      let m = models.get(name)
      if (!m) {
        m = { cost: 0, input: 0, output: 0, cache_read: 0, cache_create: 0 }
        models.set(name, m)
      }
      m.cost += b.cost ?? 0
      m.input += b.inputTokens ?? 0
      m.output += b.outputTokens ?? 0
      m.cache_read += b.cacheReadTokens ?? 0
      m.cache_create += b.cacheCreationTokens ?? 0
    }
  }
  return [...models.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([model, v]) => ({ model, ...v }))
}

// Unify per-model entries into { model, tokens:{...buckets}, cost(offline fallback), priced }
// so apply_pricing.mjs can price every model the same way (online official prices).
// Claude: tokens come from ccusage's trusted per-line attribution (cache_read→cached_input,
// cache_create→cache_creation, disjoint buckets). Cost here is the ccusage offline fallback.
function unifyClaudeModels(ccModels) {
  return (ccModels ?? []).map((m) => {
    const input = m.input ?? 0, cachedInput = m.cache_read ?? 0, cacheCreation = m.cache_create ?? 0, output = m.output ?? 0
    return {
      model: m.model,
      tokens: { input, cached_input: cachedInput, output, reasoning_output: 0, cache_creation: cacheCreation, total: input + cachedInput + cacheCreation + output },
      cost: round(m.cost ?? 0, 4), // offline fallback (from ccusage); overwritten by apply_pricing
      priced: true,
    }
  })
}
// Codex: tokens come from the ccoach CLI's model_tokens[] (ccusage codex is unavailable/
// gives 0 per-model cost — the old bug). Cost here is the CLI offline fallback.
function unifyCodexModels(modelTokens) {
  return (modelTokens ?? [])
    .filter((m) => (m.tokens?.total ?? 0) > 0)
    .map((m) => ({ model: m.model, tokens: m.tokens, cost: round(m.estimated_cost_usd ?? 0, 4), priced: m.priced ?? false }))
}
// Derive a daily {date,tokens} series from a CLI report's models_timeline (fallback
// when ccusage codex history is unavailable). Sums per-day tokens across models.
function dailyFromTimeline(report) {
  const byDay = new Map()
  for (const mt of report?.models_timeline ?? []) {
    for (const d of mt.days ?? []) byDay.set(d.date, (byDay.get(d.date) ?? 0) + (d.tokens ?? 0))
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, tokens]) => ({ date, cost: 0, tokens }))
}

const cacheHitRate = (cacheRead, totalInputLike) => {
  const denom = cacheRead + totalInputLike
  return denom ? cacheRead / denom : 0
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
// the renderer's behavior shape. Claude behavior + model_tokens come from ccoach; ccusage
// supplies Claude per-line token attribution; cost is recomputed by apply_pricing (online).
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

export function buildClaude(ccDaily, ccSession, ccBehavior = null, lang = 'en') {
  const t = ccDaily.totals ?? {}
  const daily = ccDaily.daily ?? []
  const sessions = ccSession.sessions ?? []
  const models = unifyClaudeModels(aggregateCcModels(ccDaily))
  const cacheRead = t.cacheReadTokens ?? 0
  const inputT = t.inputTokens ?? 0
  const chr = cacheHitRate(cacheRead, inputT) // cache hit rate = cache_read / (cache_read + fresh input)
  const series = daily.map((d) => ({ date: d.date, cost: round(d.totalCost ?? 0, 2), tokens: d.totalTokens ?? 0 }))
  const topSessions = [...sessions].sort((a, b) => (b.totalCost ?? 0) - (a.totalCost ?? 0)).slice(0, 5)
  const top = topSessions.map((s) => ({
    project: (s.projectPath ?? '').replaceAll('-Users-mac-', '~/'),
    last: s.lastActivity,
    cost: round(s.totalCost ?? 0, 2),
    tokens: s.totalTokens ?? 0,
    models: s.modelsUsed ?? [],
  }))
  return {
    platform: 'Claude Code',
    // tokens/模型来自 ccoach 本地解析 + ccusage 逐行归属；成本由 skill 层联网官方价计算（apply_pricing）。
    source: 'ccoach + ccusage（本地解析，token/模型）· 官方在线定价',
    active_days: daily.length,
    sessions: sessions.length,
    date_range: daily.length ? [daily[0].date, daily[daily.length - 1].date] : [],
    tokens: {
      input: inputT,
      output: t.outputTokens ?? 0,
      cache_read: cacheRead,
      cache_create: t.cacheCreationTokens ?? 0,
      total: t.totalTokens ?? 0,
    },
    cost_usd: round(t.totalCost ?? 0, 2), // 离线 fallback；apply_pricing 用官方价覆盖
    cost_is_real: true,                   // 默认离线 fallback 真实；apply_pricing 按官方价覆盖
    cache_hit_rate: round(chr, 4),
    models,
    daily_series: series,
    top_sessions: top,
    behavior: claudeBehavior(ccBehavior, lang),
    prompt_signals: (ccBehavior ?? {}).prompt_signals ?? {},
    // 平台特色 + 端点/计费（ADR 0023 D2 / 0022 D2-D4）：均为派生白名单标签，不含 key/token/完整 URL。
    claude_specific: (ccBehavior ?? {}).claude_specific ?? null,
    endpoint: ((ccBehavior ?? {}).endpoints ?? []).find((e) => e.platform === 'claude-code') ?? null,
  }
}

// Codex from the ccoach CLI (authoritative tokens + per-model breakdown). ccusage codex
// is only an optional historical sparkline source — it gives 0 per-model cost (the old
// "Codex cost = 0/partial" bug came from sourcing cost there). Cost is computed later by
// apply_pricing.mjs from online official prices over the CLI's model_tokens[].
export function buildCodex(codexReport, codexCcusage = null, lang = 'en') {
  const r = codexReport ?? {}
  const tok = r.tokens ?? {}
  const afTotal = tok.total ?? 0
  const models = unifyCodexModels(r.model_tokens)

  // Daily sparkline: prefer ccusage codex history when present, else derive from the
  // CLI report's models_timeline. (ccusage codex is frequently unavailable.)
  const cdaily = codexCcusage?.daily ?? []
  const series = cdaily.length
    ? cdaily.map((d) => ({ date: d.date, cost: round(d.costUSD ?? 0, 2), tokens: d.totalTokens ?? 0 }))
    : dailyFromTimeline(r)
  const dateRange = series.length ? [series[0].date, series[series.length - 1].date] : []

  return {
    platform: 'Codex',
    // tokens/模型来自 ccoach 本地解析；成本由 skill 层联网官方价计算（apply_pricing）。
    source: 'ccoach（本地解析，token/模型）· 官方在线定价',
    active_days: series.length,
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
  // codex-ccusage is now OPTIONAL (Codex tokens/models come from ccoach; ccusage codex
  // is only a historical sparkline source and is often unavailable).
  for (const k of ['cc-daily', 'cc-session', 'codex-report', 'output']) {
    if (!a[k]) {
      process.stderr.write(`missing --${k}\n`)
      process.exit(2)
    }
  }
  const lang = a.lang || 'en' // 默认英文（ADR 0026）；与 ccoach report / scorecard / render 同传
  const ccBehavior = a['cc-behavior'] ? load(a['cc-behavior']) : null
  const codexReport = load(a['codex-report'])
  const claude = buildClaude(load(a['cc-daily']), load(a['cc-session']), ccBehavior, lang)
  const codex = buildCodex(codexReport, a['codex-ccusage'] ? load(a['codex-ccusage']) : null, lang)

  const merged = {
    title: 'Dual-Platform AI Usage Report', // 不再用于显示（renderer 按 --lang 取标题，ADR 0025）；保留字段兼容

    generated_at: todayIso(),
    window: buildWindow([codexReport, ccBehavior]),
    platforms: { claude_code: claude, codex: codex },
    combined: {
      total_cost_usd: round(claude.cost_usd + codex.cost_usd, 2),
      total_tokens: claude.tokens.total + codex.tokens.total,
      total_sessions: claude.sessions, // codex session count not in ccusage daily
      prompt_signals: (ccBehavior ?? {}).prompt_signals ?? {},
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
