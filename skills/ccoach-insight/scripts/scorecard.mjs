#!/usr/bin/env node
// Compute a gamified, shareable scorecard from the merged dual-platform JSON.
//
// Reads the merged JSON (from merge_dual_platform.mjs) plus the i18n copy table
// (references/scorecard-copy.json) and grades four independent axes — Prompt Skill,
// Spending Style, Engineering Sense, Diligence — into tier labels + roast lines in
// the chosen language. The personality-summary paragraph is NOT produced here; the
// model writes that in the user's language (ADR 0008 D3 / 0009).
//
// Pure Node ≥18 (ESM, no external deps, offline). Tier scoring is heuristic and
// deterministic. Relative rank is a LOCAL ESTIMATE (labelled as such), never a real
// percentile.
//
// Privacy: consumes only aggregate numbers (incl. prompt_signals); no prompt text.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_COPY = path.join(HERE, '..', 'references', 'scorecard-copy.json')

const load = (p) => JSON.parse(readFileSync(p, 'utf8'))
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const round = (x, n = 0) => {
  const f = 10 ** n
  return Math.round(Number(x) * f) / f
}
const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)

// Python-style truthiness for chained `a or b or {}` (empty object/array == falsy).
const truthy = (v) => {
  if (v == null) return false
  if (typeof v === 'object') return Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0
  return Boolean(v)
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) o[a.slice(2)] = argv[++i]
  }
  return o
}

// Defensive nested getter returning a number (default 0).
function f(d, ...path_) {
  let cur = d
  for (const p of path_) {
    if (!isObj(cur)) return 0
    cur = cur[p]
  }
  return typeof cur === 'number' ? cur : 0
}

// Return tier index 0..4 (0 best) for Prompt Skill.
export function scorePrompt(ps) {
  const n = Math.trunc(Number(ps.prompts ?? 0) || 0)
  if (n === 0) return 2 // no data -> neutral 'Apprentice', avoid unfair roast
  let q =
    0.30 * (ps.structured_ratio ?? 0) +
    0.25 * (ps.constraint_ratio ?? 0) +
    0.20 * (ps.file_ref_ratio ?? 0) +
    0.25 * (1 - (ps.correction_rate ?? 0))
  const avg = (ps.avg_len ?? 0) || 0
  if (avg > 1500 || avg < 12) q -= 0.12
  if (q >= 0.62) return 0
  if (q >= 0.45) return 1
  if (q >= 0.30) return 2
  if (q >= 0.16) return 3
  return 4
}

// Cost share of opus-class models on the host platform, 0..1.
function opusShare(cc) {
  const models = cc.models ?? []
  let tot = 0
  for (const m of models) if (isObj(m)) tot += f(m, 'cost')
  if (tot <= 0) return 0
  let opus = 0
  for (const m of models) {
    if (isObj(m) && String(m.model ?? '').toLowerCase().includes('opus')) opus += f(m, 'cost')
  }
  return opus / tot
}

// Return tier index 0..3 (0 best) for Spending Style.
export function scoreSpending(combined, cc) {
  const cost = f(combined, 'total_cost_usd')
  const tokens = f(combined, 'total_tokens')
  const sessions = f(combined, 'total_sessions') || 1
  const avgTok = sessions ? tokens / sessions : tokens
  // Opus-on-trivial: expensive model dominates but per-session work is small.
  if (opusShare(cc) >= 0.6 && avgTok < 8000) return 3
  if (cost >= 30) return 2
  if (cost >= 5) return 1
  return 0
}

// Return tier index 0..3 (0 best) for Engineering Sense.
export function scoreEngineering(cc) {
  const beh = cc.behavior ?? {}
  const cats = beh.tool_categories ?? {}
  const fileOps = f(cats, 'file')
  const loop = f(cats, 'shell') + f(cats, 'web') + f(cats, 'search')
  const loopRatio = loop / (fileOps + 1)
  const repos = (beh.repos ?? []).length
  const sessions = f(cc, 'sessions') || 1
  const reposPerSession = sessions ? repos / sessions : repos
  if (reposPerSession >= 2.0 || (repos >= 4 && sessions <= 2)) return 3 // Archaeologist
  if (loopRatio >= 4) return 2 // Cowboy
  if (loopRatio >= 1.5) return 1 // Engineer
  return 0 // Architect
}

// Return tier index 0..3 (0 best) for Diligence.
export function scoreDiligence(combined, cc) {
  const beh = cc.behavior ?? {}
  const hours = beh.hours ?? []
  let total = 0
  for (const h of hours) total += f(h, 'count')
  let late = 0
  for (const h of hours) {
    if (!isObj(h)) continue
    const hr = h.hour ?? 12
    if (hr >= 22 || hr <= 5) late += f(h, 'count')
  }
  const lateShare = total ? late / total : 0
  const activeDays = f(cc, 'active_days')
  const sessions = f(combined, 'total_sessions')
  if (activeDays <= 1 && sessions <= 2) return 3 // Weekend Warrior (low activity)
  if (lateShare >= 0.35) return 1 // Crunch Lord
  if (activeDays >= 5) return 0 // Workhorse
  return 2 // Zen Coder
}

// Generic per-locale lookup: `${lang}_name` / `${lang}_roast`, falling back to en then zh.
// Adding a new locale needs no code change — just add {lang}_name/{lang}_roast to each tier.
function pick(copy, axisKey, idx, lang) {
  const tiers = copy.axes[axisKey].tiers
  idx = clamp(idx, 0, tiers.length - 1)
  const t = tiers[idx]
  const name = t[`${lang}_name`] ?? t.en_name ?? t.zh_name
  const roast = t[`${lang}_roast`] ?? t.en_roast ?? t.zh_roast
  return { name, roast, i: idx, count: tiers.length }
}

export function build(data, copy, lang) {
  lang = lang || 'en' // 默认英文（ADR 0025/0026）；任意 locale 透传，缺失键逐键回退（pick / ui 各自 fallback）
  const ui = copy.ui[lang] ?? copy.ui.en ?? copy.ui.zh
  const platforms = data.platforms ?? {}
  // 宿主平台：dual 时取 Claude（行为不变）；单平台时取在场平台（ADR 0042）。
  const cc = platforms.claude_code ?? platforms.codex ?? {}
  const combined = data.combined ?? {}
  const ps = truthy(cc.prompt_signals)
    ? cc.prompt_signals
    : truthy(combined.prompt_signals)
      ? combined.prompt_signals
      : {}

  const axesSpec = [
    ['prompt', 'axis_prompt', scorePrompt(ps)],
    ['spending', 'axis_spending', scoreSpending(combined, cc)],
    ['engineering', 'axis_engineering', scoreEngineering(cc)],
    ['diligence', 'axis_diligence', scoreDiligence(combined, cc)],
  ]

  const axes = []
  const goodness = []
  const names = []
  for (const [key, uiLabel, idx] of axesSpec) {
    const { name, roast, i, count } = pick(copy, key, idx, lang)
    axes.push({ key, label: ui[uiLabel], tier: name, roast, tier_index: i, tier_count: count })
    goodness.push(count > 1 ? (count - 1 - i) / (count - 1) : 1.0)
    names.push(name)
  }

  const good = goodness.length ? goodness.reduce((a, b) => a + b, 0) / goodness.length : 0
  const rankPct = Math.trunc(clamp(round(good * 100), 3, 97))

  return {
    lang,
    ui,
    scorecard_label: ui.scorecard,
    title_label: ui.title_label,
    axes,
    // placeholder composite title; the model may rewrite into a sentence
    title: names.join(' × '),
    rank_pct: rankPct,
    rank_label: ui.beats_pct.replace('{pct}', String(rankPct)),
    rank_is_estimate: true,
    estimate_note: ui.estimate_note,
    privacy_note: ui.local_privacy_note,
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.data) {
    process.stderr.write('missing --data (merged dual-platform JSON)\n')
    process.exit(2)
  }
  const lang = a.lang || 'en' // 默认英文（ADR 0025/0026）；任意 locale 透传，build/pick 内逐键回退
  const data = load(a.data)
  const copy = load(a.copy ?? DEFAULT_COPY)
  const card = build(data, copy, lang)

  const out = JSON.stringify(card, null, 2)
  if (a.output) {
    writeFileSync(a.output, out)
    console.log(`wrote ${a.output}`)
    for (const ax of card.axes) console.log(`  ${ax.label}: ${ax.tier}`)
    console.log(`  ${card.rank_label} (${card.rank_is_estimate ? 'estimate' : ''})`)
  } else {
    console.log(out)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
