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

const load = (p) => JSON.parse(readFileSync(p, 'utf8'))

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
  const head = kind === 'codex'
    ? "<tr><th>模型</th><th>成本</th><th>输入</th><th>输出</th><th>缓存输入</th><th>reasoning</th></tr>"
    : "<tr><th>模型</th><th>成本</th><th>输入</th><th>输出</th><th>缓存读</th></tr>"
  rows.push(head)
  for (const m of models ?? []) {
    const t = m.tokens ?? {}
    const cells = kind === 'codex'
      ? `<td>${comma(t.input)}</td><td>${comma(t.output)}</td><td>${comma(t.cached_input)}</td><td>${comma(t.reasoning_output)}</td>`
      : `<td>${comma(t.input)}</td><td>${comma(t.output)}</td><td>${comma(t.cached_input)}</td>`
    rows.push(`<tr><td><b>${esc(m.model)}</b></td><td>${money(m.cost)}</td>${cells}</tr>`)
  }
  return '<table>' + rows.join('') + '</table>'
}

// Window range label that guards an empty date_range (platform with no activity in
// the requested window — e.g. Codex when it wasn't used during the window).
function rangeLabel(dr) {
  return dr && dr.length ? `${dr[0]}→${dr[dr.length - 1]}` : '本窗口内无活动'
}
// Per-platform cost note reflecting the official-online pricing basis.
function costNote(plat) {
  if (plat.cost_is_real === true) return '成本：官方定价（联网查询）'
  if (plat.cost_is_real === 'partial') {
    const n = (plat.unpriced_models ?? []).length
    return `成本：官方定价（${n} 个模型未查到价，回退离线估算）`
  }
  return '成本：离线 fallback 估算'
}

// Horizontal mini bar list for top_commands / git / languages / repos.
function miniBars(items, labelKey, valKey, color, unit = '', top = 8) {
  items = (items ?? []).filter((i) => i[valKey]).slice(0, top)
  if (!items.length) return "<p class='muted'>无数据</p>"
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
  if (!hours || !hours.length) return "<p class='muted'>无活跃时段数据</p>"
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

// Symmetric behavior block for one platform.
function behaviorPanel(beh, color, platform) {
  if (!beh) {
    return (
      `<div class='panel'><h2>${esc(platform)} · 使用行为</h2>` +
      `<p class='muted'>无行为数据。</p></div>`
    )
  }
  const p = [`<div class='panel'><h2>${esc(platform)} · 使用行为</h2>`]
  p.push(
    `<p class='muted'>窗口 ${esc(beh.generated_for)} · ` +
      `${beh.sessions ?? 0} 会话 · ` +
      `${comma(beh.total_tool_calls ?? 0)} 次工具调用</p>`,
  )

  // tool categories chips
  const cats = beh.tool_categories ?? {}
  const catZh = { shell: '命令行', web: '网络', file: '文件', search: '搜索', mcp: 'MCP', other: '其他' }
  if (Object.keys(cats).length) {
    const chips = Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v)
      .map(([k, v]) => `<span class='chip'>${esc(catZh[k] ?? k)} ${comma(v)}</span>`)
      .join('')
    p.push(`<div class='chips'>${chips}</div>`)
  }

  // tools by name (Claude only) else top commands
  if (beh.tools_by_name && beh.tools_by_name.length) {
    p.push('<h3>工具 Top</h3>')
    p.push(miniBars(beh.tools_by_name, 'name', 'count', color))
  }
  p.push('<h3>命令 Top（仅命令首词）</h3>')
  p.push(miniBars(beh.top_commands, 'command', 'count', color))

  p.push('<h3>Git 习惯（子命令次数）</h3>')
  p.push(miniBars(beh.git_habits, 'command', 'count', color))

  const unit = beh.languages_unit ?? ''
  p.push(`<h3>语言分布（${esc(unit)}）</h3>`)
  p.push(miniBars(beh.languages, 'name', 'count', color, unit))

  p.push('<h3>Repo 排行（按 Token）</h3>')
  p.push(miniBars(beh.repos, 'repo', 'tokens', color))

  p.push('<h3>活跃时段（本地时区，按活动计数）</h3>')
  p.push(hoursChart(beh.hours, color))

  const src = beh.sources ?? []
  if (src.length) {
    p.push('<h3>来源</h3>')
    p.push(miniBars(src, 'name', 'count', color))
  }

  const extras = beh.extras ?? []
  if (extras.length) {
    p.push("<h3>行为信号</h3><ul class='sig'>")
    for (const e of extras) p.push(`<li>${esc(e)}</li>`)
    p.push('</ul>')
  }
  p.push('</div>')
  return p.join('')
}

function sparkline(series, color) {
  if (!series || !series.length) return ''
  const vals = series.map((s) => s.cost ?? 0)
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

const BILLING_MODE_ZH = { subscription: '订阅', api_or_relay: 'API / 中转', unknown: '未知' }
const CONFIDENCE_ZH = { high: '高', medium: '中', low: '低' }

// 端点 / 计费模式卡片（账户级当前快照，ADR 0022 D2-D4）：两平台是否走官方/中转 + 计费模式。
function endpointBillingCard(cc, cx) {
  const row = (e, name) => {
    if (!e) return ''
    const host = e.official_host ? `官方 ${esc(e.official_host)}` : e.endpoint === 'custom' ? '自定义 / 中转端点' : '未知端点'
    const mode = BILLING_MODE_ZH[e.billing_mode] ?? esc(e.billing_mode)
    const conf = CONFIDENCE_ZH[e.confidence] ?? esc(e.confidence)
    const flag = e.relay_suspected
      ? "<span class='chip' style='background:#fef2f2;color:#991b1b'>⚠️ 疑似中转</span>"
      : "<span class='chip' style='background:#ecfdf5;color:#065f46'>官方直连</span>"
    const sub = e.subscription_type ? ` · 订阅档 <b>${esc(e.subscription_type)}</b>` : ''
    return `<div class='ep-row'><b>${esc(name)}</b> ${flag} <span class='muted'>${host} · 计费 ${mode}（置信${conf}）${sub}</span></div>`
  }
  const body = row(cc?.endpoint, 'Claude Code') + row(cx?.endpoint, 'Codex')
  if (!body) return ''
  return (
    "<section class='panel'><h2>端点 / 计费模式（账户级当前快照）</h2>" +
    body +
    "<p class='muted'>读本机 config 派生（只白名单标签，不含 key/token/完整 URL）。" +
    'plan_type 来自后端响应、可被中转伪造，故端点非官方时计费保守判为「API / 中转」。</p></section>'
  )
}

// Codex 计费拆分（订阅 plan tier，ADR 0022 D1）。
function codexBillingBreakdown(cx) {
  const b = cx?.billing
  if (!b) return ''
  const tiers = Object.entries(b.by_plan_tier ?? {}).sort((a, c) => c[1] - a[1])
  const total = tiers.reduce((a, [, v]) => a + Number(v || 0), 0) + Number(b.unclassified || 0)
  if (!total) return ''
  const rows = tiers.map(([tier, tok]) => barRow(`plan: ${tier}`, tok, total))
  if (b.unclassified) rows.push(barRow('未分类（无 plan_type）', b.unclassified, total))
  return (
    '<h3>计费拆分（订阅 plan tier）</h3>' +
    rows.join('') +
    `<p class='muted'>plan_type 可被中转伪造（${esc(b.confidence ?? '')}）；「未分类」= 有 token 无 plan_type，≠ 确定 API。</p>`
  )
}

// Codex 执行画像（ADR 0023 D1）：effort / 审批 / 沙箱 / 协作模式 / 客户端 + 压缩 / 放弃 / 窗口 / git 身份。
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
  add('推理强度', cs.effort)
  add('审批策略', cs.approval_policy)
  add('沙箱', cs.sandbox)
  add('协作模式', cs.collaboration_mode)
  add('客户端', cs.originators)
  const misc = []
  if (cs.compactions) misc.push(`上下文压缩 ${comma(cs.compactions)}`)
  if (cs.aborted_turns) misc.push(`放弃回合 ${comma(cs.aborted_turns)}`)
  if (cs.context_window) misc.push(`上下文窗口 ${comma(cs.context_window)}`)
  if (cs.personality && Object.keys(cs.personality).length) misc.push('人格 ' + Object.keys(cs.personality).map(esc).join('/'))
  if (cs.git_repo_identity) misc.push('git 仓库身份 ✓')
  if (misc.length) blocks.push(`<p class='muted'>${misc.join(' · ')}</p>`)
  if (!blocks.length) return ''
  return '<h3>执行画像（Codex 独有）</h3>' + blocks.join('')
}

// Claude 服务端工具（ADR 0023 D2）：web 搜索 / 抓取计数（常为 0，非零才显示）。
function claudeServerTools(cc) {
  const c = cc?.claude_specific
  if (!c || (!c.web_search_requests && !c.web_fetch_requests)) return ''
  return `<p class='muted'>服务端工具：web 搜索 ${comma(c.web_search_requests)} · web 抓取 ${comma(c.web_fetch_requests)}</p>`
}

// Render the shareable cover scorecard (vertical, screenshot-friendly).
// `sc` is the JSON from scripts/scorecard.mjs; fully bilingual via its own copy.
function scorecardHtml(sc) {
  if (!sc) return ''
  const parts = ["<section class='scorecard'>"]
  parts.push(
    `<span class='sc-kicker'>${esc(sc.scorecard_label ?? '')} · ` + `${esc(sc.title_label ?? '')}</span>`,
  )
  parts.push(`<h2 class='sc-title'>${esc(sc.title ?? '')}</h2>`)
  if (sc.rank_label) parts.push(`<p class='sc-rank'>${esc(sc.rank_label)}</p>`)
  for (const ax of sc.axes ?? []) {
    parts.push(
      "<div class='sc-axis'>" +
        `<span class='sc-ax-label'>${esc(ax.label)}</span>` +
        `<span class='sc-tier'>${esc(ax.tier)}</span>` +
        `<span class='sc-roast'>${esc(ax.roast)}</span>` +
        '</div>',
    )
  }
  const note = [sc.privacy_note, sc.estimate_note].filter(Boolean).join(' · ')
  if (note) parts.push(`<p class='sc-note'>${esc(note)}</p>`)
  parts.push('</section>')
  return parts.join('')
}

function render(data, insights, scorecard = null) {
  const cc = data.platforms.claude_code
  const cx = data.platforms.codex
  const comb = data.combined
  const title = data.title ?? '双平台 AI 使用报告'
  const htmllang = 'zh-CN'

  const p = [
    `<!doctype html><html lang='${htmllang}'><head><meta charset='utf-8'>`,
    "<meta name='viewport' content='width=device-width, initial-scale=1'>",
    `<title>${esc(title)}</title><style>`,
    CSS,
    '</style></head><body><main>',
    `<header><h1>${esc(title)}</h1>` +
      `<p><b>统计窗口：${esc(data.window?.desc ?? data.generated_at)}</b> · 生成于 ${esc(data.generated_at)}</p>` +
      `<p class='muted'>数据来源：ccoach（本地离线解析，token 与模型为权威事实）` +
      (data.cost?.priced_at ? ` · 成本：官方定价（联网查询于 ${esc(data.cost.priced_at)}）` : ' · 成本：离线 fallback 估算') +
      `</p></header>`,
  ]

  // shareable cover scorecard (top of the report, screenshot-friendly)
  if (scorecard) p.push(scorecardHtml(scorecard))

  // combined headline metrics
  p.push("<section class='metrics'>")
  p.push(metric('合计成本', money(comb.total_cost_usd), '官方定价成本（联网查询）'))
  p.push(metric('合计 Token', comma(comb.total_tokens)))
  p.push(metric('Claude Code 成本', money(cc.cost_usd), `${cc.active_days} 活跃天`))
  p.push(metric('Codex 成本', money(cx.cost_usd), `${cx.active_days} 活跃天`))
  p.push('</section>')

  // 端点 / 计费模式（账户级当前快照：官方 vs 中转）
  p.push(endpointBillingCard(cc, cx))

  // AI executive summary (prominent, near the top)
  const execSummary = insights.executive_summary
  if (execSummary) {
    p.push("<section class='panel focus'><h2>执行摘要</h2>")
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
    p.push("<section class='panel'><h2>AI 建议</h2><div class='cards'>")
    for (const rec of recs) {
      if (typeof rec === 'string') {
        p.push(`<article class='card rec'><p>${esc(rec)}</p></article>`)
      } else {
        const titleHtml = rec.title ? `<strong>${esc(rec.title)}</strong>` : ''
        const text = rec.text || rec.action || ''
        const ev = rec.evidence
        const evHtml = ev ? `<p class='muted'>证据：${esc(ev)}</p>` : ''
        p.push(`<article class='card rec'>${titleHtml}<p>${esc(text)}</p>${evHtml}</article>`)
      }
    }
    p.push('</div></section>')
  }

  // AI insights (each may be a string or {title, detail})
  const items = insights.insights ?? []
  p.push("<section class='panel focus'><h2>AI 洞见（基于真实数字）</h2>")
  if (items.length) {
    p.push('<ul>')
    for (const it of items) {
      if (typeof it === 'string') {
        p.push(`<li>${esc(it)}</li>`)
      } else {
        const t = it.title
        const detail = it.detail ?? ''
        if (t) p.push(`<li><b>${esc(t)}</b>${detail ? '：' + esc(detail) : ''}</li>`)
        else p.push(`<li>${esc(detail)}</li>`)
      }
    }
    p.push('</ul>')
  } else if (!execSummary && !recs) {
    p.push('<ul><li>未提供洞见。</li></ul>')
  }
  p.push('</section>')

  // head-to-head comparison bars
  p.push(
    "<section class='panel'><h2>两平台对比</h2><div class='legend'>" +
      "<span class='ldot a'></span>Claude Code" +
      "<span class='ldot b'></span>Codex</div>",
  )
  p.push(compareMetric('总成本 (USD)', cc.cost_usd, cx.cost_usd, money))
  p.push(compareMetric('总 Token', cc.tokens.total, cx.tokens.total))
  p.push(compareMetric('输入 Token', cc.tokens.input, cx.tokens.input))
  p.push(compareMetric('输出 Token', cc.tokens.output, cx.tokens.output))
  p.push(compareMetric('缓存读取 Token', cc.tokens.cache_read, cx.tokens.cache_read))
  p.push(compareMetric('缓存命中率', cc.cache_hit_rate, cx.cache_hit_rate, pct))
  p.push(compareMetric('活跃天数', cc.active_days, cx.active_days))
  p.push('</section>')

  // two platform panels side by side
  p.push("<section class='grid2'>")

  // Claude Code panel
  p.push("<div class='panel'><h2>Claude Code</h2>")
  p.push(
    `<p class='muted'>${esc(cc.source)} · ${rangeLabel(cc.date_range)} · ` +
      `${cc.sessions} 会话 · ${costNote(cc)}</p>`,
  )
  p.push(sparkline(cc.daily_series, '#0f766e'))
  p.push('<h3>模型分布</h3>')
  p.push(modelTable(cc.models, 'claude'))
  p.push('<h3>Top 会话（按成本）</h3><table><tr><th>项目</th><th>成本</th><th>Token</th><th>模型</th></tr>')
  for (const s of cc.top_sessions) {
    p.push(
      `<tr><td>${esc(s.project)}<br><span class='muted'>${esc(s.last)}</span></td>` +
        `<td>${money(s.cost)}</td><td>${comma(s.tokens)}</td>` +
        `<td>${esc((s.models ?? []).join(', '))}</td></tr>`,
    )
  }
  p.push('</table>')
  p.push(claudeServerTools(cc))
  p.push('</div>')

  // Codex panel
  p.push("<div class='panel'><h2>Codex</h2>")
  const cxEmpty = (cx.tokens?.total ?? 0) === 0
  p.push(
    `<p class='muted'>${esc(cx.source)} · ${rangeLabel(cx.date_range)} · ${costNote(cx)}</p>`,
  )
  if (cxEmpty) {
    p.push("<p class='muted'>本窗口内无 Codex 活动（该平台在所选统计窗口里没有会话）。</p>")
  } else {
    p.push(sparkline(cx.daily_series, '#b45309'))
    p.push('<h3>模型分布</h3>')
    p.push(modelTable(cx.models, 'codex'))
    p.push(
      `<p class='muted'>token <b>${comma((cx.tokens ?? {}).total ?? 0)}</b> · ` +
        `成本 <b>${money(cx.cost_usd)}</b> · 缓存命中 <b>${pct(cx.cache_hit_rate)}</b></p>`,
    )
    p.push(codexBillingBreakdown(cx))
    p.push(codexExecProfile(cx))
  }
  p.push('</div>')
  p.push('</section>')

  // token composition per platform
  p.push("<section class='grid2'>")
  p.push("<div class='panel'><h2>Claude Code Token 构成</h2>")
  const cct = cc.tokens
  p.push(barRow('缓存读取', cct.cache_read, cct.total))
  p.push(barRow('输出', cct.output, cct.total))
  p.push(barRow('缓存写入', cct.cache_create ?? 0, cct.total))
  p.push(barRow('输入', cct.input, cct.total))
  p.push('</div>')
  p.push("<div class='panel'><h2>Codex Token 构成</h2>")
  const cxt = cx.tokens
  p.push(barRow('缓存输入', cxt.cache_read, cxt.total))
  p.push(barRow('输入', cxt.input, cxt.total))
  p.push(barRow('输出', cxt.output, cxt.total))
  p.push(barRow('reasoning', cxt.reasoning ?? 0, cxt.total))
  p.push('</div></section>')

  // symmetric behavior panels (tools / git / languages / repos / hours)
  p.push("<section><h2 class='section-h'>使用行为画像（两平台对称）</h2>" + "<div class='grid2'>")
  p.push(behaviorPanel(cc.behavior, '#0f766e', 'Claude Code'))
  p.push(behaviorPanel(cx.behavior, '#b45309', 'Codex'))
  p.push('</div></section>')

  // data provenance / privacy
  p.push("<section class='panel'><h2>数据来源与隐私</h2><ul>")
  p.push(
    '<li><b>Token 与模型</b>（权威本地事实）：由 <code>ccoach report --json</code> 离线解析；' +
      'Claude Code 的 per-model token 归属另用 <code>ccusage claude daily --breakdown</code> 交叉核对。</li>',
  )
  p.push(
    '<li><b>成本</b>：不再用第三方内置价表。由本 skill 按报告里<b>实际出现的每个模型名</b>联网查询其' +
      '<b>官方 API 定价</b>（含接入的第三方模型），再用各模型 token 分桶确定性计算' +
      `${data.cost?.priced_at ? `（查询于 ${esc(data.cost.priced_at)}）` : ''}。` +
      '查不到官方价的模型回退到离线 fallback 估算并标注。成本为估算、非账单。</li>',
  )
  p.push(
    '<li>隐私：用量为聚合 token/成本/模型名/项目目录名。<b>会读取你本人的 user prompt</b> ' +
      '用于习惯与质量评级（本机长期授权）——但读取前一律<b>脱敏</b>（密钥/home 目录/绝对路径/邮箱/IP）' +
      '并截断，报告只写<b>转述与数值信号、不嵌入 prompt 原文</b>；可分享成绩卡纯聚合、零原文。' +
      '绝不读取助手回复 / 思考 / 工具结果 / system 提示 / 文件内容。ccoach 解析全程本地离线；' +
      '仅本 skill 在查询官方定价时联网（只发模型名、不发任何用量或 prompt）。</li>',
  )
  p.push('</ul></section>')

  p.push('</main></body></html>')
  return p.join('')
}

const CSS = String.raw`
:root{color-scheme:light dark;--bg:#f6f7f5;--fg:#202322;--muted:#68706c;--panel:#fff;--line:#d8ddd9;--a:#0f766e;--b:#b45309}
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
.scorecard{max-width:430px;margin:14px auto 22px;padding:20px 22px;border-radius:16px;background:linear-gradient(160deg,#1b2440,#0f1530);color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.25)}
.scorecard .sc-kicker{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.65}
.scorecard .sc-title{margin:4px 0 2px;font-size:23px;line-height:1.25;font-weight:800}
.scorecard .sc-rank{margin:0 0 12px;font-size:13px;opacity:.85}
.sc-axis{display:flex;flex-direction:column;padding:10px 0;border-top:1px solid rgba(255,255,255,.12)}
.sc-axis .sc-ax-label{font-size:11px;opacity:.6}
.sc-axis .sc-tier{font-size:17px;font-weight:700;margin:1px 0}
.sc-axis .sc-roast{font-size:12px;opacity:.82}
.scorecard .sc-note{margin:12px 0 0;font-size:10px;opacity:.55}
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
  writeFileSync(a.output, render(data, insights, scorecard))
  console.log(`wrote ${a.output}`)
}

export { render }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
