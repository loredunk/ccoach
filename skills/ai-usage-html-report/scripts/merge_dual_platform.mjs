#!/usr/bin/env node
// Merge Claude Code data (from ccusage) + Codex data (from ccoach report --json,
// with ccusage codex as historical fallback) into one dual-platform usage JSON.
//
// Inputs (all JSON files produced beforehand):
//   --cc-daily        ccusage claude daily --json --offline --breakdown
//   --cc-session      ccusage claude session --json --offline
//   --cc-behavior     ccoach report --platform claude-code --json (Claude Code behavior)
//   --codex-report    ccoach report --since <date> --json  (Codex behavior+tokens)
//   --codex-ccusage   ccusage codex daily --json --offline   (historical Codex, fallback)
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

// Normalize `ccoach report --platform claude-code --json` (a unified Report) into
// the renderer's behavior shape. As of Phase-2 "采集并入 ccoach", Claude *behavior*
// comes from ccoach (not collect_claude_behavior.py); tokens/cost still from ccusage.
export function claudeBehavior(r) {
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
  const extras = []
  const pmodes = env.permission_modes ?? []
  if (pmodes.length) extras.push('权限模式: ' + pmodes.slice(0, 4).map((p) => `${p.command}×${p.count}`).join('、'))
  if (env.subagent_messages) extras.push(`子代理消息 ${env.subagent_messages} 条`)
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
    languages_unit: '文件',
    repos: (r.repos ?? []).slice(0, 10).map((x) => ({
      repo: x.repo, sessions: x.sessions ?? 0, tokens: x.tokens ?? 0, tool_calls: 0,
    })),
    hours: normHours(r.hours ?? []),
    sources: (r.sources ?? []).map((s) => ({ name: s.name, count: s.sessions ?? 0 })),
    extras,
  }
}

// Normalize ccoach report --json into the unified behavior shape.
export function codexBehavior(r) {
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
  if (r.reasoning_ratio) extras.push(`推理 token 占比 ${(r.reasoning_ratio * 100).toFixed(1)}%`)
  return {
    generated_for: r.generated_for ?? null,
    sessions: r.sessions ?? 0,
    total_tool_calls: tools.total_calls ?? 0,
    tools_by_name: [], // ccoach doesn't break tools down by name
    top_commands: cleanCommands(tools.top_commands ?? []),
    tool_categories: cats,
    git_habits: cleanGit(git.top_subcommands ?? []),
    languages: (r.languages ?? []).slice(0, 10).map((l) => ({ name: l.name, count: l.sessions ?? 0 })),
    languages_unit: '会话',
    repos,
    hours: normHours(r.hours ?? []),
    sources: (r.sources ?? []).map((s) => ({ name: s.name, count: s.sessions ?? 0 })),
    extras,
  }
}

export function buildClaude(ccDaily, ccSession, ccBehavior = null) {
  const t = ccDaily.totals ?? {}
  const daily = ccDaily.daily ?? []
  const sessions = ccSession.sessions ?? []
  const models = aggregateCcModels(ccDaily)
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
    source: 'ccusage (LiteLLM offline pricing)',
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
    cost_usd: round(t.totalCost ?? 0, 2),
    cost_is_real: true,
    cache_hit_rate: round(chr, 4),
    models,
    daily_series: series,
    top_sessions: top,
    behavior: claudeBehavior(ccBehavior),
    prompt_signals: (ccBehavior ?? {}).prompt_signals ?? {},
  }
}

// Codex from ccoach (today) + ccusage codex (history fallback).
export function buildCodex(codexReport, codexCcusage) {
  const r = codexReport
  const tok = r.tokens ?? {}
  const afTotal = tok.total ?? 0
  const afSessions = r.sessions ?? 0

  // historical from ccusage codex
  const cx = codexCcusage
  const ct = cx.totals ?? {}
  const cdaily = cx.daily ?? []
  // per-model aggregate
  const cmodels = new Map()
  for (const day of cdaily) {
    for (const [name, b] of Object.entries(day.models ?? {})) {
      let m = cmodels.get(name)
      if (!m) {
        m = { cost: 0, input: 0, output: 0, cached: 0, reasoning: 0 }
        cmodels.set(name, m)
      }
      m.cost += b.costUSD ?? 0
      m.input += b.inputTokens ?? 0
      m.output += b.outputTokens ?? 0
      m.cached += b.cachedInputTokens ?? 0
      m.reasoning += b.reasoningOutputTokens ?? 0
    }
  }
  const models = [...cmodels.entries()].sort((a, b) => b[1].input - a[1].input).map(([model, v]) => ({ model, ...v }))
  const cached = ct.cachedInputTokens ?? 0
  const inputT = ct.inputTokens ?? 0
  const chr = cacheHitRate(cached, inputT)
  const series = cdaily.map((d) => ({ date: d.date, cost: round(d.costUSD ?? 0, 2), tokens: d.totalTokens ?? 0 }))
  return {
    platform: 'Codex',
    // ccoach = authoritative for "today"; ccusage codex = history.
    codex_today: {
      generated_for: r.generated_for ?? null,
      timezone: r.timezone ?? null,
      sessions: afSessions,
      tokens: tok,
      cost_usd: r.estimated_cost_usd ?? 0,
      cache_hit_rate: r.cache_hit_rate ?? 0,
      empty: afTotal === 0,
    },
    source: 'ccoach report --json (today) + ccusage codex (history)',
    active_days: cdaily.length,
    date_range: cdaily.length ? [cdaily[0].date, cdaily[cdaily.length - 1].date] : [],
    tokens: {
      input: inputT,
      output: ct.outputTokens ?? 0,
      cache_read: cached,
      reasoning: ct.reasoningOutputTokens ?? 0,
      total: ct.totalTokens ?? 0,
    },
    cost_usd: round(ct.costUSD ?? 0, 2),
    // ccusage prices Codex at the day level via gpt-5.x fallback; per-model
    // costUSD is 0, so cost is "best-effort" not fully model-attributed.
    cost_is_real: 'partial',
    cache_hit_rate: round(chr, 4),
    models,
    daily_series: series,
    behavior: codexBehavior(r),
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  for (const k of ['cc-daily', 'cc-session', 'codex-report', 'codex-ccusage', 'output']) {
    if (!a[k]) {
      process.stderr.write(`missing --${k}\n`)
      process.exit(2)
    }
  }
  const ccBehavior = a['cc-behavior'] ? load(a['cc-behavior']) : null
  const claude = buildClaude(load(a['cc-daily']), load(a['cc-session']), ccBehavior)
  const codex = buildCodex(load(a['codex-report']), load(a['codex-ccusage']))

  const merged = {
    title: '双平台 AI 使用报告',
    generated_at: todayIso(),
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
  console.log(`  Claude Code: ${claude.sessions} sessions, $${claude.cost_usd}, ${comma(claude.tokens.total)} tokens`)
  console.log(
    `  Codex: ${codex.active_days} days, $${codex.cost_usd}, ${comma(codex.tokens.total)} tokens ` +
      `(ccoach today empty=${codex.codex_today.empty})`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
