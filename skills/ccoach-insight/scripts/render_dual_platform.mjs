#!/usr/bin/env node
// Render a dual-platform (Claude Code + Codex) AI usage HTML report from the
// merged JSON produced by merge_dual_platform.mjs.
//
//   --data <dual_platform.json> --insights <insights.json> --output <out.html>
//   [--scorecard <scorecard.json>] [--lang zh|en]
//
// Self-contained: pure Node ≥18 (ESM, no external libs, no network). Privacy:
// renders only aggregate counts/costs/model names + project basenames already
// present in --data.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_COPY = path.join(HERE, '..', 'references', 'report-copy.json')

const load = (p) => JSON.parse(readFileSync(p, 'utf8'))

// i18n: report-skeleton copy comes from references/report-copy.json, default English.
// Single-threaded per process — setI18n() picks the active locale map + the default locale for
// per-key fallback (so a partial new locale degrades gracefully instead of showing the raw key).
let I18N = {}
let I18N_DEF = {}
function setI18n(copy, lang) {
  const dual = (copy && copy.dual) || {}
  const def = (copy && copy.default) || 'en'
  I18N_DEF = dual[def] || {}
  I18N = (lang && dual[lang]) || I18N_DEF
}
// Translate a key, interpolating {name} placeholders from vars. Falls back: active → default → key.
function tr(key, vars) {
  let s = I18N[key] != null ? I18N[key] : I18N_DEF[key] != null ? I18N_DEF[key] : key
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''))
  return s
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) o[a.slice(2)] = argv[++i]
  }
  return o
}

function esc(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;')
}

function comma(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return esc(v)
  return Math.trunc(n).toLocaleString('en-US')
}

function money(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '$0.00'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.0%'
  return (n * 100).toFixed(1) + '%'
}

// Compact token count for the share-card stat band, split into { n, u } so the unit can be
// gold-emphasized separately. zh → 亿/万; en → B/M/K. Trims a trailing ".0"/".00".
function compactTokens(n, loc) {
  const v = Number(n) || 0
  const trim = (s) => s.replace(/\.?0+$/, '')
  if (loc === 'zh') {
    if (v >= 1e8) return { n: trim((v / 1e8).toFixed(2)), u: '亿' }
    if (v >= 1e4) return { n: trim((v / 1e4).toFixed(0)), u: '万' }
    return { n: String(Math.trunc(v)), u: '' }
  }
  if (v >= 1e9) return { n: trim((v / 1e9).toFixed(2)), u: 'B' }
  if (v >= 1e6) return { n: trim((v / 1e6).toFixed(0)), u: 'M' }
  if (v >= 1e3) return { n: trim((v / 1e3).toFixed(0)), u: 'K' }
  return { n: String(Math.trunc(v)), u: '' }
}

// ---- On-page glossary (回合 / 严重程度 / 卡壳) ----
// Single source of truth for the HTML term definitions, bilingual, keyed by locale.
// (.mjs can't import src/i18n.ts; the CLI/text path keeps its own copy in i18n.ts.)
// Product language only — NO internal markers (ADR numbers etc.).
const GLOSSARY = {
  zh: {
    head: '术语',
    terms: [
      ['回合 episode', '你下的一条指令 → agent 为它做的整段工作；下一条指令开启下一个回合。'],
      ['严重程度 severity', '0–6，衡量一个回合「卡壳」的程度：反复改同一文件、连环报错、原地没进展、耗时异常四类信号加权相加，0=完全顺畅，越高越像深坑。'],
      ['卡壳 spiral', 'agent 卡住、原地空转的回合——反复改同几个文件、命令一直报错、却没往前推，很烧 token。'],
    ],
  },
  en: {
    head: 'Terms',
    terms: [
      ['episode', 'One instruction you gave → the work the agent did for it; the next instruction starts the next episode.'],
      ['severity', '0-6 — how stuck an episode got, weighted from re-editing the same file, repeated errors, no progress, and time-outliers. 0 = smooth.'],
      ['spiral', 'An episode where the agent got stuck going in circles — same files re-edited, repeated errors, no progress; costly in tokens.'],
    ],
  },
}

function glossarySection(loc) {
  const g = GLOSSARY[loc] ?? GLOSSARY.en
  const items = g.terms.map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')
  return `<section class='terms'><div class='terms-k'>${esc(g.head)}</div><dl>${items}</dl></section>`
}

// --- Cross-platform token口径 helpers ---
// The two platforms store the per-platform `tokens.input` with DIFFERENT semantics:
//   Claude: tokens.input is FRESH non-cached input; cache_read / cache_create are separate
//           DISJOINT buckets (input + cache_read + cache_create + output = total).
//   Codex : tokens.input ALREADY INCLUDES cached_input (cached ⊆ input); reasoning ⊆ output;
//           input + output = total.
// So a naive head-to-head of `tokens.input` is apples-to-oranges (Claude looks tiny because its
// cache reads are excluded). These helpers normalize for display. They are display-only — the
// per-model models[].tokens consumed by apply_pricing.mjs keep the raw platform口径 and are untouched.

// Total input-side tokens (everything sent as prompt, incl. cache reads/writes), comparable
// across platforms. This is what a reader means by "how much went in".
function inputSideTotal(t, platform) {
  if (!t) return 0
  if (platform === 'codex') return Number(t.input) || 0 // Codex input already includes cached_input
  return (Number(t.input) || 0) + (Number(t.cache_read) || 0) + (Number(t.cache_create) || 0)
}

// Disjoint composition buckets that sum to tokens.total. `reasoning` is a SUBSET of output, so it
// is returned separately (shown as a note, never as an additive bar) — keeping bar shares ≤ 100%.
function tokenComposition(t, platform) {
  t = t || {}
  const cacheRead = Number(t.cache_read) || 0
  const output = Number(t.output) || 0
  if (platform === 'codex') {
    const fresh = Math.max(0, (Number(t.input) || 0) - cacheRead) // input incl cached → subtract to get fresh
    return { fresh, cacheRead, cacheCreate: 0, output, reasoning: Number(t.reasoning) || 0, total: Number(t.total) || 0 }
  }
  return { fresh: Number(t.input) || 0, cacheRead, cacheCreate: Number(t.cache_create) || 0, output, reasoning: 0, total: Number(t.total) || 0 }
}

function metric(label, value, sub = '') {
  const s = sub ? `<span class='sub'>${esc(sub)}</span>` : ''
  return `<div class='metric'><span>${esc(label)}</span><b>${esc(value)}</b>${s}</div>`
}

function barRow(label, value, total, fmt = comma) {
  const share = total ? (value / total) * 100 : 0
  return (
    `<div class='bar'><div class='blabel'>${esc(label)}</div>` +
    `<div class='btrack'><div class='bfill' style='width:${share.toFixed(1)}%'></div></div>` +
    `<div class='bval'>${fmt(value)} <span class='muted'>${share.toFixed(0)}%</span></div></div>`
  )
}

function compareMetric(label, a, b, fmt = comma, aName = 'Claude Code', bName = 'Codex') {
  const total = (a || 0) + (b || 0)
  const sa = total ? (a / total) * 100 : 0
  return (
    `<div class='cmp'><div class='cmp-label'>${esc(label)}</div>` +
    `<div class='cmp-bar'>` +
    `<div class='cmp-a' style='width:${sa.toFixed(1)}%' title='${esc(aName)}'></div>` +
    `<div class='cmp-b' style='width:${(100 - sa).toFixed(1)}%' title='${esc(bName)}'></div>` +
    `</div>` +
    `<div class='cmp-vals'><span class='ca'>${fmt(a)}</span>` +
    `<span class='cb'>${fmt(b)}</span></div></div>`
  )
}

// Unified per-model table. Both platforms now carry { model, tokens:{...}, cost }
// (cost from official online prices via apply_pricing). Codex adds a reasoning column.
function modelTable(models, kind) {
  const rows = []
  const baseHead = `<tr><th>${esc(tr('th_model'))}</th><th>${esc(tr('th_cost'))}</th><th>${esc(tr('th_input'))}</th><th>${esc(tr('th_output'))}</th>`
  const head = kind === 'codex'
    ? baseHead + `<th>${esc(tr('th_cached_input'))}</th><th>${esc(tr('th_reasoning'))}</th></tr>`
    : baseHead + `<th>${esc(tr('th_cache_read'))}</th></tr>`
  rows.push(head)
  for (const m of models ?? []) {
    const t = m.tokens ?? {}
    // Codex: the "输入" column shows FRESH input (input - cached_input) so it doesn't overlap the
    // separate "缓存输入" column (Codex's raw input includes cached). Claude input is already fresh.
    const cxFreshInput = (Number(t.input) || 0) - (Number(t.cached_input) || 0)
    const cells = kind === 'codex'
      ? `<td>${comma(cxFreshInput)}</td><td>${comma(t.output)}</td><td>${comma(t.cached_input)}</td><td>${comma(t.reasoning_output)}</td>`
      : `<td>${comma(t.input)}</td><td>${comma(t.output)}</td><td>${comma(t.cached_input)}</td>`
    rows.push(`<tr><td><b>${esc(m.model)}</b></td><td>${money(m.cost)}</td>${cells}</tr>`)
  }
  return '<table>' + rows.join('') + '</table>'
}

// Window range label that guards an empty date_range (platform with no activity in
// the requested window — e.g. Codex when it wasn't used during the window).
function rangeLabel(dr) {
  return dr && dr.length ? `${dr[0]}→${dr[dr.length - 1]}` : tr('no_activity_window')
}
// Per-platform cost note reflecting the official-online pricing basis.
function costNote(plat) {
  if (plat.cost_is_real === true) return tr('cost_official')
  if (plat.cost_is_real === 'partial') {
    const n = (plat.unpriced_models ?? []).length
    return tr('cost_official_partial', { n })
  }
  return tr('cost_offline')
}

// Horizontal mini bar list for top_commands / git / languages / repos.
function miniBars(items, labelKey, valKey, color, unit = '', top = 8) {
  items = (items ?? []).filter((i) => i[valKey]).slice(0, top)
  if (!items.length) return `<p class='muted'>${esc(tr('no_data'))}</p>`
  const mx = Math.max(...items.map((i) => i[valKey] ?? 0)) || 1
  const rows = []
  for (const it of items) {
    const v = it[valKey] ?? 0
    const share = (v / mx) * 100
    const label = esc(it[labelKey] ?? '')
    const vtxt = comma(v) + (unit ? ` ${unit}` : '')
    rows.push(
      `<div class='mbar'><div class='mlabel' title='${label}'>${label}</div>` +
        `<div class='mtrack'><div class='mfill' style='width:${share.toFixed(1)}%;` +
        `background:${color}'></div></div>` +
        `<div class='mval'>${vtxt}</div></div>`,
    )
  }
  return rows.join('')
}

// 24h activity columns using the `count` (message/tool activity).
function hoursChart(hours, color) {
  if (!hours || !hours.length) return `<p class='muted'>${esc(tr('no_hours'))}</p>`
  const byH = new Map(hours.map((h) => [h.hour, h]))
  const vals = []
  for (let h = 0; h < 24; h++) vals.push((byH.get(h) ?? {}).count ?? 0)
  const mx = Math.max(...vals) || 1
  const cols = []
  for (let h = 0; h < 24; h++) {
    const v = vals[h]
    const ht = v ? (v / mx) * 100 : 2
    cols.push(
      `<div class='hcol' title='${String(h).padStart(2, '0')}:00 · ${v}'>` +
        `<div class='hbar' style='height:${ht.toFixed(0)}%;background:${color}'></div>` +
        `<div class='hlab'>${h % 6 === 0 ? h : ''}</div></div>`,
    )
  }
  return `<div class='hours'>${cols.join('')}</div>`
}

// Per-turn (episode) summary panel for one platform: autonomy / intervention
// style / task mix / spiral count / deepest pit. All derived aggregates — no prompt text/paths.
function episodePanel(ep, platform) {
  if (!ep || !ep.episodes) {
    return `<div class='panel'><h2>${esc(tr('ep_title', { platform }))}</h2>` +
      `<p class='muted'>${esc(tr('ep_nodata'))}</p></div>`
  }
  const p = [`<div class='panel'><h2>${esc(tr('ep_title', { platform }))}</h2>`]
  p.push(metric(tr('ep_count'), comma(ep.episodes)))
  p.push(metric(tr('ep_autonomy'), pct(ep.autonomy_rate)))
  p.push(metric(tr('ep_style'), tr('ep_style_' + ep.intervention_style)))
  p.push(metric(tr('ep_spirals'), comma(ep.spiral_episodes)))
  const mix = Object.entries(ep.task_mix ?? {}).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0)
  if (mix.length) {
    const chips = mix.map(([k, v]) => `<span class='chip'>${esc(tr('task_' + k))} ${(v * 100).toFixed(0)}%</span>`).join('')
    p.push(`<h3>${esc(tr('ep_taskmix'))}</h3><div class='chips'>${chips}</div>`)
  }
  if (ep.deepest_pit) {
    const dp = ep.deepest_pit
    p.push(`<h3>${esc(tr('ep_deepest'))}</h3>`)
    p.push(`<p class='muted'>${esc(tr('ep_deepest_line', { type: tr('task_' + dp.task_type), sev: dp.severity, tok: comma(dp.tokens) }))}</p>`)
  }
  p.push('</div>')
  return p.join('')
}

// Symmetric behavior block for one platform.
// Map the language-unit token from merge ('files'/'sessions') to a localized label; pass other
// values through (older data may carry a literal unit).
function unitLabel(u) {
  if (u === 'files') return tr('lang_unit_files')
  if (u === 'sessions') return tr('lang_unit_sessions')
  return u ?? ''
}

function behaviorPanel(beh, color, platform) {
  if (!beh) {
    return (
      `<div class='panel'><h2>${esc(tr('beh_title', { platform }))}</h2>` +
      `<p class='muted'>${esc(tr('beh_nodata'))}</p></div>`
    )
  }
  const p = [`<div class='panel'><h2>${esc(tr('beh_title', { platform }))}</h2>`]
  p.push(
    `<p class='muted'>${esc(tr('beh_meta', { window: beh.generated_for, sessions: beh.sessions ?? 0, calls: comma(beh.total_tool_calls ?? 0) }))}</p>`,
  )

  // tool categories chips
  const cats = beh.tool_categories ?? {}
  if (Object.keys(cats).length) {
    const chips = Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v)
      .map(([k, v]) => `<span class='chip'>${esc(tr('cat_' + k))} ${comma(v)}</span>`)
      .join('')
    p.push(`<div class='chips'>${chips}</div>`)
  }

  // tools by name (Claude only) else top commands
  if (beh.tools_by_name && beh.tools_by_name.length) {
    p.push(`<h3>${esc(tr('beh_top_tools'))}</h3>`)
    p.push(miniBars(beh.tools_by_name, 'name', 'count', color))
  }
  p.push(`<h3>${esc(tr('beh_top_commands'))}</h3>`)
  p.push(miniBars(beh.top_commands, 'command', 'count', color))

  const mcp = beh.mcp
  if (mcp && Array.isArray(mcp.top_tools) && mcp.top_tools.length) {
    p.push(`<h3>${esc(tr('beh_mcp'))}</h3>`)
    const items = mcp.top_tools.map((x) => ({ name: `${x.tool || x.server} · ${x.server}`, count: x.count }))
    p.push(miniBars(items, 'name', 'count', color))
  }
  const sk = beh.skills ?? []
  if (sk.length) {
    p.push(`<h3>${esc(tr('beh_skills'))}</h3>`)
    const items = sk.map((x) => ({ name: x.plugin ? `${x.name} (${x.plugin})` : x.name, count: x.count }))
    p.push(miniBars(items, 'name', 'count', color))
  }

  p.push(`<h3>${esc(tr('beh_git'))}</h3>`)
  p.push(miniBars(beh.git_habits, 'command', 'count', color))

  const unit = unitLabel(beh.languages_unit)
  p.push(`<h3>${esc(tr('beh_lang', { unit }))}</h3>`)
  p.push(miniBars(beh.languages, 'name', 'count', color, unit))

  p.push(`<h3>${esc(tr('beh_repos'))}</h3>`)
  p.push(miniBars(beh.repos, 'repo', 'tokens', color))

  p.push(`<h3>${esc(tr('beh_hours'))}</h3>`)
  p.push(hoursChart(beh.hours, color))

  const src = beh.sources ?? []
  if (src.length) {
    p.push(`<h3>${esc(tr('beh_sources'))}</h3>`)
    p.push(miniBars(src, 'name', 'count', color))
  }

  const extras = beh.extras ?? []
  if (extras.length) {
    p.push(`<h3>${esc(tr('beh_signals'))}</h3><ul class='sig'>`)
    for (const e of extras) p.push(`<li>${esc(e)}</li>`)
    p.push('</ul>')
  }
  p.push('</div>')
  return p.join('')
}

function sparkline(series, color) {
  if (!series || !series.length) return ''
  // Plot per-day tokens — the series carries tokens (cost is per-model official-online,
  // applied later, never per-day), so a token-over-time curve is what's meaningful.
  const vals = series.map((s) => s.tokens ?? s.cost ?? 0)
  const mx = Math.max(...vals) || 1
  const w = 280
  const h = 46
  const n = vals.length
  let pts
  if (n === 1) {
    pts = `0,${h} ${w},${h - (vals[0] / mx) * h}`
  } else {
    const step = w / (n - 1)
    pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / mx) * h).toFixed(1)}`).join(' ')
  }
  return (
    `<svg class='spark' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>` +
    `<polyline points='${pts}' fill='none' stroke='${color}' stroke-width='2'/></svg>`
  )
}

const billingModeLabel = (m) => tr('bill_' + m) !== 'bill_' + m ? tr('bill_' + m) : m
const confidenceLabel = (c) => tr('conf_' + c) !== 'conf_' + c ? tr('conf_' + c) : c

// 端点 / 计费模式卡片（账户级当前快照）：两平台是否走官方/中转 + 计费模式。
function endpointBillingCard(cc, cx) {
  const row = (e, name) => {
    if (!e) return ''
    const host = e.official_host ? tr('ep_official', { host: esc(e.official_host) }) : e.endpoint === 'custom' ? tr('ep_custom') : tr('ep_unknown')
    const mode = billingModeLabel(e.billing_mode)
    const conf = confidenceLabel(e.confidence)
    const flag = e.relay_suspected
      ? `<span class='chip' style='background:#fef2f2;color:#991b1b'>${esc(tr('ep_relay_flag'))}</span>`
      : `<span class='chip' style='background:#ecfdf5;color:#065f46'>${esc(tr('ep_official_flag'))}</span>`
    const sub = e.subscription_type ? tr('ep_sub_tier', { tier: esc(e.subscription_type) }) : ''
    return `<div class='ep-row'><b>${esc(name)}</b> ${flag} <span class='muted'>${tr('ep_row_meta', { host, mode, conf, sub })}</span></div>`
  }
  const body = row(cc?.endpoint, 'Claude Code') + row(cx?.endpoint, 'Codex')
  if (!body) return ''
  return (
    `<section class='panel'><h2>${esc(tr('ep_card_title'))}</h2>` +
    body +
    `<p class='muted'>${esc(tr('ep_card_note'))}</p></section>`
  )
}

// Codex 计费拆分（订阅 plan tier）。
function codexBillingBreakdown(cx) {
  const b = cx?.billing
  if (!b) return ''
  const tiers = Object.entries(b.by_plan_tier ?? {}).sort((a, c) => c[1] - a[1])
  const total = tiers.reduce((a, [, v]) => a + Number(v || 0), 0) + Number(b.unclassified || 0)
  if (!total) return ''
  const rows = tiers.map(([tier, tok]) => barRow(`plan: ${tier}`, tok, total))
  if (b.unclassified) rows.push(barRow(tr('bill_unclassified'), b.unclassified, total))
  return (
    `<h3>${esc(tr('bill_breakdown_title'))}</h3>` +
    rows.join('') +
    `<p class='muted'>${esc(tr('bill_note', { conf: b.confidence ?? '' }))}</p>`
  )
}

// Codex 执行画像：effort / 审批 / 沙箱 / 协作模式 / 客户端 + 压缩 / 放弃 / 窗口 / git 身份。
function codexExecProfile(cx) {
  const cs = cx?.codex_specific
  if (!cs) return ''
  const chips = (rec) =>
    Object.entries(rec ?? {})
      .sort((a, c) => c[1] - a[1])
      .map(([k, v]) => `<span class='chip'>${esc(k)} ${comma(v)}</span>`)
      .join('')
  const blocks = []
  const add = (label, rec) => {
    if (rec && Object.keys(rec).length) blocks.push(`<div class='ex-row'><span class='ex-label'>${esc(label)}</span>${chips(rec)}</div>`)
  }
  add(tr('exec_effort'), cs.effort)
  add(tr('exec_approval'), cs.approval_policy)
  add(tr('exec_sandbox'), cs.sandbox)
  add(tr('exec_collab'), cs.collaboration_mode)
  add(tr('exec_client'), cs.originators)
  const misc = []
  if (cs.compactions) misc.push(tr('exec_compactions', { n: comma(cs.compactions) }))
  if (cs.aborted_turns) misc.push(tr('exec_aborted', { n: comma(cs.aborted_turns) }))
  if (cs.context_window) misc.push(tr('exec_ctxwin', { n: comma(cs.context_window) }))
  if (cs.personality && Object.keys(cs.personality).length) misc.push(tr('exec_personality', { names: Object.keys(cs.personality).map(esc).join('/') }))
  if (cs.git_repo_identity) misc.push(tr('exec_git_identity'))
  if (misc.length) blocks.push(`<p class='muted'>${misc.join(' · ')}</p>`)
  if (!blocks.length) return ''
  return `<h3>${esc(tr('exec_title'))}</h3>` + blocks.join('')
}

// Claude 服务端工具：web 搜索 / 抓取计数（常为 0，非零才显示）。
function claudeServerTools(cc) {
  const c = cc?.claude_specific
  if (!c || (!c.web_search_requests && !c.web_fetch_requests)) return ''
  return `<p class='muted'>${esc(tr('cc_server_tools', { s: comma(c.web_search_requests), f: comma(c.web_fetch_requests) }))}</p>`
}

// esc() a roast, then turn ONE model-marked **key phrase** into a gold highlight (the only markup
// allowed in a roast). esc runs first so ** survive; the phrase content is already escaped.
function roastHtml(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<span class='sc-hl'>$1</span>")
}

// Render the shareable cover scorecard — ONE bounded, single-screen "share unit" (dark+gold hero
// card, screenshot-ready) that carries EVERYTHING: brand, title, the headline stat band, and the
// four axes with their full roasts. `sc` is the JSON from scripts/scorecard.mjs; `stats` is the
// headline block built in render(). No separate breakdown section — the card is self-contained.
function scorecardHtml(sc, stats) {
  if (!sc) return ''
  // Render-order guard: persona title + roasts are MODEL-WRITTEN before render (SKILL.md step 6).
  // If still the deterministic fallback, leave a visible HTML marker + warn on stderr (but still
  // render — offline/test 兜底 stays valid).
  const titleFallback = sc.title_is_fallback === true || /\s×\s/.test(sc.title ?? '')
  const fixtureRoasts = (sc.axes ?? []).filter((ax) => ax.roast_is_fixture === true).length
  if (titleFallback || fixtureRoasts) {
    const bits = []
    if (titleFallback) bits.push("persona title is still the fallback 'A × B × C × D'")
    if (fixtureRoasts) bits.push(`${fixtureRoasts} roast line(s) are still the fixture 兜底`)
    process.stderr.write(
      `⚠ scorecard: ${bits.join('; ')} — not written back to /tmp/scorecard.json before render. ` +
        `Compose the persona title / rewrite roasts, then re-render.\n`,
    )
  }
  const parts = ["<section class='scorecard'>"]
  if (titleFallback) parts.push('<!-- ccoach:scorecard_title_is_fallback -->')
  // top bar: brand top-left, run/platform meta top-right
  if (stats) {
    const metaLines = (stats.meta ?? []).map((m) => esc(m)).join('<br>')
    parts.push(
      `<div class='sc-top'><span class='sc-brand'>${esc(stats.brand ?? 'ccoach')}</span>` +
        `<span class='sc-meta'>${metaLines}</span></div>`,
    )
  }
  parts.push(`<span class='sc-kicker'>${esc(tr('sc_kicker'))}</span>`)
  parts.push(`<h2 class='sc-title'>${esc(sc.title ?? '')}</h2>`)
  // headline stat band: a hero cost block + a 2-cell grid (tokens / cache), numbers gold-emphasized
  if (stats) {
    parts.push(
      "<div class='sc-band'>" +
        "<div class='sc-hero-cell'>" +
        `<div class='sc-hero-lab'>${esc(stats.heroLabel)}</div>` +
        `<div class='sc-hero-cost'>${esc(stats.heroCost)}</div>` +
        `<div class='sc-hero-sub'>${esc(stats.heroSub)}</div>` +
        '</div>' +
        "<div class='sc-grid'>" +
        `<div class='sc-cell'><div class='sc-cell-lab'>${esc(stats.tokenLabel)}</div>` +
        `<div class='sc-cell-val'>${esc(stats.tokenMantissa)} <span class='u'>${esc(stats.tokenUnit)}</span></div></div>` +
        `<div class='sc-cell'><div class='sc-cell-lab'>${esc(stats.cacheLabel)}</div>` +
        `<div class='sc-cell-val gold'>${esc(stats.cacheVal)}</div></div>` +
        '</div></div>',
    )
  }
  for (const ax of sc.axes ?? []) {
    const roastMark = ax.roast_is_fixture === true ? '<!-- ccoach:roast_is_fixture -->' : ''
    const topCls = ax.tier_index === 0 ? ' top' : ''
    parts.push(
      "<div class='sc-axis'>" +
        roastMark +
        `<span class='sc-ax-label'>${esc(ax.label)}</span>` +
        `<span class='sc-tier${topCls}'>${esc(ax.tier)}</span>` +
        `<span class='sc-roast'>${roastHtml(ax.roast ?? '')}</span>` +
        '</div>',
    )
  }
  if (sc.privacy_note) parts.push(`<p class='sc-note'>${esc(sc.privacy_note)}</p>`)
  // gold-dot footer caption (the persona title is a model-composed, for-fun estimate)
  if (stats?.caption) parts.push(`<p class='sc-share'>${esc(stats.caption)}</p>`)
  parts.push('</section>')
  return parts.join('')
}

function render(data, insights, scorecard = null, copy = null, lang = null) {
  setI18n(copy ?? { dual: { en: {} }, default: 'en' }, lang)
  const cc = data.platforms.claude_code
  const cx = data.platforms.codex
  const hasCc = !!cc
  const hasCx = !!cx
  const both = hasCc && hasCx // dual=完整对比；单平台=隐藏对比区 + 缺席面板（宿主平台默认）
  const scope = both ? 'Claude Code + Codex' : hasCc ? 'Claude Code' : 'Codex' // 产品名不本地化，仅副标题模板按 --lang 取
  const gridAttr = both ? " class='grid2'" : '' // dual=并排两栏；单平台=无 class，单面板整宽
  const comb = data.combined
  const title = tr('report_title') // 报告标题属骨架文案，按 --lang 取；忽略 merge 写入的固定 data.title
  const htmllang = tr('html_lang')
  const costMeta = data.cost?.priced_at ? tr('header_cost_priced', { at: esc(data.cost.priced_at) }) : tr('header_cost_offline')

  const p = [
    `<!doctype html><html lang='${esc(htmllang)}'><head><meta charset='utf-8'>`,
    "<meta name='viewport' content='width=device-width, initial-scale=1'>",
    // JetBrains Mono for the share-card numerals; system mono fallback keeps offline/file:// solid
    "<link rel='preconnect' href='https://fonts.googleapis.com'><link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>",
    "<link href='https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap' rel='stylesheet'>",
    `<title>${esc(title)}</title><style>`,
    CSS,
    '</style></head><body><main>',
    `<header><h1>${esc(title)}</h1>` +
      `<p class='muted'>${esc(tr('report_subtitle_scope', { scope }))}</p>` +
      `<p><b>${tr('header_meta', { window: esc(data.window?.desc ?? data.generated_at), gen: esc(data.generated_at) })}</b></p>` +
      `<p class='muted'>${tr('header_source')}${costMeta}</p></header>`,
  ]

  // locale bucket for renderer-side bilingual fragments (stat-band units, glossary)
  const loc = String(lang ?? tr('html_lang') ?? 'en').startsWith('zh') ? 'zh' : 'en'

  // shareable cover card — ONE bounded, screenshot-ready hero unit at the top, carrying the
  // brand, the persona title, the headline stat band, and the four axes with their roasts.
  if (scorecard) {
    // cachePct REUSES tokenComposition() so the band equals the token-composition bars further down.
    const present = [hasCc ? cc : null, hasCx ? cx : null].filter(Boolean)
    let bandCacheRead = 0
    let bandTotal = 0
    for (const pf of present) {
      const cmp = tokenComposition(pf.tokens, pf === cx ? 'codex' : 'claude-code')
      bandCacheRead += cmp.cacheRead
      bandTotal += cmp.total
    }
    const cacheVal = bandTotal ? pct(bandCacheRead / bandTotal) : '0.0%' // one decimal, e.g. 96.2%
    // active days is a calendar-day UNION, not additive across platforms (days overlap)
    const activeDays = both
      ? comb.active_days ?? Math.max(cc.active_days || 0, cx.active_days || 0)
      : (cc ?? cx ?? {}).active_days
    const tok = compactTokens(comb.total_tokens, loc)
    // top-right meta: window + "Claude Code · Max 订阅" (subscription only when official + subscription)
    const host = cc ?? cx ?? {}
    const ep = host.endpoint ?? {}
    const planLabel =
      ep.billing_mode === 'subscription' && ep.subscription_type && ep.relay_suspected !== true
        ? `${ep.subscription_type.charAt(0).toUpperCase() + ep.subscription_type.slice(1)} ${tr('sc_plan_suffix')}`
        : ep.billing_mode === 'api_or_relay'
          ? 'API'
          : ''
    const heroSub = ep.billing_mode === 'subscription' ? tr('sc_hero_sub_plan') : tr('sc_hero_sub_api')
    const scStats = {
      brand: 'ccoach',
      meta: [data.window?.desc ?? data.generated_at, planLabel ? `${scope} · ${planLabel}` : scope],
      heroLabel: tr('sc_hero_label', { n: activeDays }),
      heroCost: '$' + Math.trunc(Number(comb.total_cost_usd) || 0).toLocaleString('en-US'),
      heroSub,
      tokenLabel: tr('m_total_tokens'),
      tokenMantissa: tok.n,
      tokenUnit: tok.u,
      cacheLabel: tr('sc_cache_label'),
      cacheVal,
      caption: tr('sc_share_caption'),
    }
    p.push(scorecardHtml(scorecard, scStats))
  }

  // Headline metrics. The share card's stat band already carries cost/tokens/days/cache, so a
  // single-platform report drops the standalone boxes. Keep them when there's NO card (else the
  // headline numbers vanish); in dual mode keep only the per-platform cost split the combined band
  // can't show.
  if (!scorecard) {
    p.push("<section class='metrics'>")
    p.push(metric(tr('m_total_cost'), money(comb.total_cost_usd), tr('m_total_cost_sub')))
    p.push(metric(tr('m_total_tokens'), comma(comb.total_tokens)))
    if (both) {
      p.push(metric(tr('m_cc_cost'), money(cc.cost_usd), tr('active_days_sub', { n: cc.active_days })))
      p.push(metric(tr('m_cx_cost'), money(cx.cost_usd), tr('active_days_sub', { n: cx.active_days })))
    } else {
      const only = cc ?? cx ?? {} // 单平台在场者；空 platforms（不可达，merge 已 exit 2）也不抛
      p.push(metric(tr('m_active_days'), comma(only.active_days)))
    }
    p.push('</section>')
  } else if (both) {
    p.push("<section class='metrics'>")
    p.push(metric(tr('m_cc_cost'), money(cc.cost_usd), tr('active_days_sub', { n: cc.active_days })))
    p.push(metric(tr('m_cx_cost'), money(cx.cost_usd), tr('active_days_sub', { n: cx.active_days })))
    p.push('</section>')
  }

  // 端点 / 计费模式（账户级当前快照：官方 vs 中转）
  p.push(endpointBillingCard(cc, cx))

  // AI executive summary (prominent, near the top)
  const execSummary = insights.executive_summary
  if (execSummary) {
    p.push(`<section class='panel focus'><h2>${esc(tr('h_exec_summary'))}</h2>`)
    if (typeof execSummary === 'string') {
      for (const para of execSummary.split('\n').map((s) => s.trim()).filter(Boolean)) {
        p.push(`<p>${esc(para)}</p>`)
      }
    } else {
      p.push('<ul>')
      for (const item of execSummary) p.push(`<li>${esc(item)}</li>`)
      p.push('</ul>')
    }
    p.push('</section>')
  }

  // AI recommendations (each may be a string or {text, evidence})
  const recs = insights.recommendations
  if (recs) {
    p.push(`<section class='panel'><h2>${esc(tr('h_ai_recs'))}</h2><div class='cards'>`)
    for (const rec of recs) {
      if (typeof rec === 'string') {
        p.push(`<article class='card rec'><p>${esc(rec)}</p></article>`)
      } else {
        const titleHtml = rec.title ? `<strong>${esc(rec.title)}</strong>` : ''
        const text = rec.text || rec.action || ''
        const ev = rec.evidence
        const evHtml = ev ? `<p class='muted'>${esc(tr('rec_evidence'))}${esc(ev)}</p>` : ''
        p.push(`<article class='card rec'>${titleHtml}<p>${esc(text)}</p>${evHtml}</article>`)
      }
    }
    p.push('</div></section>')
  }

  // AI insights (each may be a string or {title, detail})
  const items = insights.insights ?? []
  p.push(`<section class='panel focus'><h2>${esc(tr('h_ai_insights'))}</h2>`)
  if (items.length) {
    p.push('<ul>')
    for (const it of items) {
      if (typeof it === 'string') {
        p.push(`<li>${esc(it)}</li>`)
      } else {
        const t = it.title
        const detail = it.detail ?? ''
        if (t) p.push(`<li><b>${esc(t)}</b>${detail ? esc(tr('kv_sep')) + esc(detail) : ''}</li>`)
        else p.push(`<li>${esc(detail)}</li>`)
      }
    }
    p.push('</ul>')
  } else if (!execSummary && !recs) {
    p.push(`<ul><li>${esc(tr('insights_empty'))}</li></ul>`)
  }
  p.push('</section>')

  // head-to-head comparison bars — 仅双平台渲染（单平台无对比对象）
  if (both) {
    p.push(
      `<section class='panel'><h2>${esc(tr('h_comparison'))}</h2><div class='legend'>` +
        "<span class='ldot a'></span>Claude Code" +
        "<span class='ldot b'></span>Codex</div>",
    )
    p.push(compareMetric(tr('cmp_total_cost'), cc.cost_usd, cx.cost_usd, money))
    p.push(compareMetric(tr('cmp_total_tokens'), cc.tokens.total, cx.tokens.total))
    // 输入 Token = 输入侧总量（含缓存读）——两平台口径统一，避免 Claude 因排除 cache 而虚小。
    p.push(compareMetric(tr('cmp_input'), inputSideTotal(cc.tokens, 'claude'), inputSideTotal(cx.tokens, 'codex')))
    p.push(compareMetric(tr('cmp_output'), cc.tokens.output, cx.tokens.output))
    p.push(compareMetric(tr('cmp_cache_read'), cc.tokens.cache_read, cx.tokens.cache_read))
    p.push(compareMetric(tr('cmp_cache_hit'), cc.cache_hit_rate, cx.cache_hit_rate, pct))
    p.push(compareMetric(tr('cmp_active_days'), cc.active_days, cx.active_days))
    p.push('</section>')
  }

  // platform panels — 按在场平台渲染（单平台不并排、不留空壳）
  p.push(`<section${gridAttr}>`)

  // Claude Code panel
  if (hasCc) {
    p.push("<div class='panel'><h2>Claude Code</h2>")
    p.push(
      `<p class='muted'>${tr('panel_sessions_meta', { source: esc(tr('src_claude')), range: rangeLabel(cc.date_range), sessions: cc.sessions, cost: costNote(cc) })}</p>`,
    )
    p.push(sparkline(cc.daily_series, '#0f766e'))
    p.push(`<h3>${esc(tr('h_model_dist'))}</h3>`)
    p.push(modelTable(cc.models, 'claude'))
    p.push(`<h3>${esc(tr('h_top_sessions'))}</h3><table><tr><th>${esc(tr('th_project'))}</th><th>${esc(tr('th_tokens'))}</th><th>${esc(tr('th_model'))}</th></tr>`)
    for (const s of cc.top_sessions) {
      p.push(
        `<tr><td>${esc(s.project)}<br><span class='muted'>${esc(s.last)}</span></td>` +
          `<td>${comma(s.tokens)}</td>` +
          `<td>${esc((s.models ?? []).join(', '))}</td></tr>`,
      )
    }
    p.push('</table>')
    p.push(claudeServerTools(cc))
    p.push('</div>')
  }

  // Codex panel
  if (hasCx) {
    p.push("<div class='panel'><h2>Codex</h2>")
    const cxEmpty = (cx.tokens?.total ?? 0) === 0
    p.push(
      `<p class='muted'>${tr('panel_cx_meta', { source: esc(tr('src_codex')), range: rangeLabel(cx.date_range), cost: costNote(cx) })}</p>`,
    )
    if (cxEmpty) {
      p.push(`<p class='muted'>${esc(tr('cx_empty'))}</p>`)
    } else {
      p.push(sparkline(cx.daily_series, '#b45309'))
      p.push(`<h3>${esc(tr('h_model_dist'))}</h3>`)
      p.push(modelTable(cx.models, 'codex'))
      // Top Sessions(按项目)表，与 Claude 面板对称；仅在有 --codex-sessions 数据时渲染。
      if ((cx.top_sessions ?? []).length) {
        p.push(`<h3>${esc(tr('h_top_sessions'))}</h3><table><tr><th>${esc(tr('th_project'))}</th><th>${esc(tr('th_tokens'))}</th><th>${esc(tr('th_model'))}</th></tr>`)
        for (const s of cx.top_sessions) {
          p.push(
            `<tr><td>${esc(s.project)}<br><span class='muted'>${esc(s.last)}</span></td>` +
              `<td>${comma(s.tokens)}</td>` +
              `<td>${esc((s.models ?? []).join(', '))}</td></tr>`,
          )
        }
        p.push('</table>')
      }
      p.push(
        `<p class='muted'>${tr('cx_tokline', { tokens: comma((cx.tokens ?? {}).total ?? 0), cost: money(cx.cost_usd), hit: pct(cx.cache_hit_rate) })}</p>`,
      )
      p.push(codexBillingBreakdown(cx))
      p.push(codexExecProfile(cx))
    }
    p.push('</div>')
  }
  p.push('</section>')

  // token composition per platform — 按在场平台渲染
  p.push(`<section${gridAttr}>`)
  // Both panels use disjoint buckets that sum to total. For Codex this fixes the old
  // double-count where input (incl cached) + cached + reasoning (⊆ output) overshot 100%.
  if (hasCc) {
    p.push(`<div class='panel'><h2>${esc(tr('h_cc_tokens'))}</h2>`)
    const cccomp = tokenComposition(cc.tokens, 'claude')
    p.push(barRow(tr('bar_cache_read'), cccomp.cacheRead, cccomp.total))
    p.push(barRow(tr('bar_output'), cccomp.output, cccomp.total))
    p.push(barRow(tr('bar_cache_create'), cccomp.cacheCreate, cccomp.total))
    p.push(barRow(tr('bar_fresh_input'), cccomp.fresh, cccomp.total))
    p.push('</div>')
  }
  if (hasCx) {
    p.push(`<div class='panel'><h2>${esc(tr('h_cx_tokens'))}</h2>`)
    const cxcomp = tokenComposition(cx.tokens, 'codex')
    p.push(barRow(tr('bar_cached_input'), cxcomp.cacheRead, cxcomp.total))
    p.push(barRow(tr('bar_fresh_input'), cxcomp.fresh, cxcomp.total))
    p.push(barRow(tr('bar_output'), cxcomp.output, cxcomp.total))
    if (cxcomp.reasoning) {
      const rpct = cxcomp.output ? ((cxcomp.reasoning / cxcomp.output) * 100).toFixed(0) : '0'
      p.push(`<p class='muted'>${esc(tr('cx_reasoning_note', { n: comma(cxcomp.reasoning), pct: rpct }))}</p>`)
    }
    p.push('</div>')
  }
  p.push('</section>')

  // behavior panels (tools / git / languages / repos / hours) — 按在场平台渲染（单平台只画在场平台）
  p.push(`<section><h2 class='section-h'>${esc(tr('h_behavior_section'))}</h2>` + `<div${gridAttr}>`)
  if (hasCc) p.push(behaviorPanel(cc.behavior, '#0f766e', 'Claude Code'))
  if (hasCx) p.push(behaviorPanel(cx.behavior, '#b45309', 'Codex'))
  p.push('</div></section>')

  // per-turn episode analysis — 按在场平台渲染。先给术语条（回合/严重程度/卡壳），让黑话可读
  const hasEpisodes = (hasCc && cc.episode_summary?.episodes) || (hasCx && cx.episode_summary?.episodes)
  if (hasEpisodes) {
    p.push(`<section><h2 class='section-h'>${esc(tr('h_episode_section'))}</h2>`)
    p.push(glossarySection(loc))
    p.push(`<div${gridAttr}>`)
    if (hasCc) p.push(episodePanel(cc.episode_summary, 'Claude Code'))
    if (hasCx) p.push(episodePanel(cx.episode_summary, 'Codex'))
    p.push('</div></section>')
  }

  // data provenance / privacy
  p.push(`<section class='panel'><h2>${esc(tr('h_provenance'))}</h2><ul>`)
  p.push(`<li>${tr('prov_tokens_li')}</li>`)
  const pricedAt = data.cost?.priced_at ? tr('prov_cost_priced_at', { at: esc(data.cost.priced_at) }) : ''
  p.push(`<li>${tr('prov_cost_li', { priced: pricedAt })}</li>`)
  p.push(`<li>${tr('prov_privacy_li')}</li>`)
  p.push('</ul></section>')

  p.push('</main></body></html>')
  return p.join('')
}

const CSS = String.raw`
:root{color-scheme:light dark;--bg:#f6f7f5;--fg:#202322;--muted:#68706c;--panel:#fff;--line:#d8ddd9;--a:#0f766e;--b:#b45309;--mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media(prefers-color-scheme:dark){:root{--bg:#111413;--fg:#edf1ef;--muted:#a7b0ab;--panel:#1a1f1d;--line:#313936;--a:#5eead4;--b:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1180px;margin:0 auto;padding:30px 18px 56px}header{margin-bottom:22px}h1{font-size:27px;margin:0 0 6px}
h2{font-size:17px;margin:0 0 12px}h3{font-size:13px;margin:16px 0 6px;color:var(--muted)}header p,.muted{color:var(--muted)}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}
.metric,.panel,.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:6px}
.card.rec{border-left:4px solid var(--a)}.card strong{display:block;margin-bottom:5px}.card p{margin:5px 0}
.metric span{display:block;color:var(--muted);font-size:12px}.metric b{display:block;font-size:22px;margin-top:5px}.metric .sub{font-size:11px;margin-top:3px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}.focus{border-left:4px solid var(--a);margin-bottom:8px}
section{margin-top:18px}table{width:100%;border-collapse:collapse;margin-top:6px}td,th{text-align:left;border-bottom:1px solid var(--line);padding:7px 8px;font-size:13px}th{color:var(--muted);font-size:11px}tr:last-child td{border-bottom:0}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px}ul{margin:0;padding-left:18px}
.cmp{margin:10px 0}.cmp-label{font-size:12px;color:var(--muted);margin-bottom:3px}
.cmp-bar{display:flex;height:18px;border-radius:5px;overflow:hidden;background:var(--line)}
.cmp-a{background:var(--a)}.cmp-b{background:var(--b)}
.cmp-vals{display:flex;justify-content:space-between;font-size:12px;margin-top:2px}.ca{color:var(--a);font-weight:600}.cb{color:var(--b);font-weight:600}
.legend{font-size:12px;color:var(--muted);margin-bottom:8px}.ldot{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 5px 0 12px;vertical-align:middle}.ldot.a{background:var(--a)}.ldot.b{background:var(--b)}
.bar{display:grid;grid-template-columns:90px 1fr 150px;gap:8px;align-items:center;margin:5px 0}.blabel{font-size:12px;color:var(--muted)}
.btrack{height:14px;background:var(--line);border-radius:4px;overflow:hidden}.bfill{height:100%;background:var(--a)}.bval{font-size:12px;text-align:right}
.spark{width:100%;height:46px;margin:6px 0}
.section-h{margin:18px 0 10px;font-size:18px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
.chip{font-size:11px;background:var(--line);border-radius:10px;padding:2px 9px;color:var(--fg)}
.ep-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0;font-size:13px}
.ex-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;margin:5px 0}
.ex-label{font-size:12px;color:var(--muted);min-width:64px}
.mbar{display:grid;grid-template-columns:120px 1fr 96px;gap:8px;align-items:center;margin:3px 0}
.mlabel{font-size:12px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mtrack{height:12px;background:var(--line);border-radius:4px;overflow:hidden}.mfill{height:100%}
.mval{font-size:11px;text-align:right;color:var(--muted)}
.hours{display:flex;align-items:flex-end;gap:2px;height:70px;margin:8px 0 2px}
.hcol{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}
.hbar{width:70%;border-radius:2px 2px 0 0;min-height:2px}
.hlab{font-size:9px;color:var(--muted);margin-top:2px;height:11px}
ul.sig{margin:4px 0;padding-left:18px}ul.sig li{font-size:12px;color:var(--muted);margin:2px 0}
/* ===== shareable cover card: a bounded, single-screen hero unit (always dark+gold) ===== */
.scorecard{position:relative;max-width:440px;margin:8px auto 34px;padding:26px 26px 18px;border-radius:20px;color:#f1ece1;overflow:hidden;background:radial-gradient(120% 60% at 82% -8%,rgba(233,185,73,.16),transparent 58%),radial-gradient(120% 55% at 8% 0%,rgba(244,212,136,.10),transparent 55%),linear-gradient(180deg,#181610 0%,#0c0b08 64%);border:1px solid rgba(233,185,73,.22);box-shadow:0 30px 70px -28px rgba(0,0,0,.85)}
.scorecard::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#e9b949,transparent);opacity:.65}
.scorecard::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.05;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.scorecard>*{position:relative;z-index:1}
.sc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;font-family:var(--mono);font-size:11px;letter-spacing:.04em}
.sc-top .sc-brand{display:inline-flex;align-items:center;gap:7px;color:#f5b942;font-weight:700;letter-spacing:.02em}
.sc-top .sc-brand::before{content:"";width:7px;height:7px;border-radius:50%;background:#f5b942;box-shadow:0 0 9px #f5b942}
.sc-top .sc-meta{text-align:right;color:#8b857a;line-height:1.55}
.scorecard .sc-kicker{display:block;margin-top:24px;font-family:var(--mono);font-size:10.5px;letter-spacing:.28em;text-transform:uppercase;color:#e8a85a}
.scorecard .sc-title{margin:9px 0 0;font-size:34px;line-height:1.12;font-weight:800;letter-spacing:.01em;background:linear-gradient(180deg,#fff 6%,#f5b942 132%);-webkit-background-clip:text;background-clip:text;color:transparent}
/* stat band: hero cost cell + 2-cell grid (tokens / cache) */
.sc-band{margin:20px 0 2px;border:1px solid rgba(233,185,73,.20);border-radius:14px;overflow:hidden}
.sc-hero-cell{padding:15px 18px 14px;background:linear-gradient(110deg,rgba(245,185,66,.12),rgba(255,107,53,.04))}
.sc-hero-lab{font-family:var(--mono);font-size:11px;letter-spacing:.05em;color:#e8a85a}
.sc-hero-cost{font-family:var(--mono);font-size:46px;font-weight:800;line-height:1;margin:7px 0 6px;background:linear-gradient(92deg,#f5b942,#ff6b35);-webkit-background-clip:text;background-clip:text;color:transparent}
.sc-hero-sub{font-family:var(--mono);font-size:10.5px;color:#8b857a}
.sc-grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid rgba(233,185,73,.16)}
.sc-cell{padding:13px 18px}
.sc-cell+.sc-cell{border-left:1px solid rgba(233,185,73,.16)}
.sc-cell-lab{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8b857a}
.sc-cell-val{font-family:var(--mono);font-size:23px;font-weight:800;color:#f1ece1;margin-top:6px}
.sc-cell-val .u{color:#f5b942}
.sc-cell-val.gold{color:#f5b942}
.sc-axis{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:baseline;padding:12px 0;border-top:1px solid rgba(233,185,73,.12)}
.sc-axis:first-of-type{margin-top:12px}
.sc-axis .sc-ax-label{grid-row:1;align-self:center;font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:#8b857a}
.sc-axis .sc-tier{grid-row:1;justify-self:start;font-size:14px;font-weight:700;color:#f5b942;padding:3px 12px;border:1px solid rgba(233,185,73,.28);border-radius:999px;background:rgba(233,185,73,.06);white-space:nowrap}
.sc-axis .sc-tier.top{color:#0c0b08;background:linear-gradient(90deg,#f5b942,#e8a85a);border-color:transparent;box-shadow:0 0 16px rgba(245,185,66,.3)}
.sc-axis .sc-roast{grid-column:1 / -1;font-size:13px;line-height:1.55;color:#cfc9bc}
.sc-axis .sc-roast .sc-hl{color:#f5b942;font-weight:600}
.scorecard .sc-note{margin:18px 0 0;padding-top:14px;border-top:1px solid rgba(255,255,255,.07);font-family:var(--mono);font-size:10px;line-height:1.5;color:#8b857a}
.scorecard .sc-share{margin:9px 0 0;font-family:var(--mono);font-size:10px;letter-spacing:.04em;color:#e8a85a}
.scorecard .sc-share::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#f5b942;box-shadow:0 0 8px #f5b942;margin-right:7px;vertical-align:middle}
/* glossary / terms strip (episode / severity / spiral) */
.terms{border:1px dashed var(--line);border-radius:8px;padding:12px 14px;margin-bottom:12px}
.terms-k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.terms dl{margin:0}.terms dl>div{margin:7px 0}
.terms dt{font-family:var(--mono);font-size:12px;color:var(--fg);font-weight:600}
.terms dd{margin:3px 0 0;font-size:12px;color:var(--muted);line-height:1.5}
@media(max-width:900px){.metrics,.grid2,.cards{grid-template-columns:1fr}.mbar{grid-template-columns:90px 1fr 70px}}
`

function main() {
  const a = parseArgs(process.argv.slice(2))
  for (const k of ['data', 'insights', 'output']) {
    if (!a[k]) {
      process.stderr.write(`missing --${k}\n`)
      process.exit(2)
    }
  }
  const data = load(a.data)
  const insights = load(a.insights)
  const scorecard = a.scorecard ? load(a.scorecard) : null
  const copy = load(a.copy ?? DEFAULT_COPY)
  const lang = a.lang ?? copy.default ?? 'en' // 默认英文；agent 按用户语言传 --lang
  writeFileSync(a.output, render(data, insights, scorecard, copy, lang))
  console.log(`wrote ${a.output}`)
}

export { render, inputSideTotal, tokenComposition }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
