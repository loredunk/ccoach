#!/usr/bin/env node
// Render a Codex-only enriched HTML report from `ccoach report --json` data plus
// an AI-written insights file. Used as the fallback when ccusage is unavailable.
//
//   --report <ccoach-report.json> --insights <insights.json> --output <out.html>
//
// Self-contained: pure Node ≥18 (ESM, no external libs, no network).
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
  return '$' + n.toFixed(2)
}

function pct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.0%'
  return (n * 100).toFixed(1) + '%'
}

function pills(items) {
  if (!items || !items.length) return '<span class="muted">-</span>'
  return items.map((item) => `<span class="pill">${esc(item)}</span>`).join('')
}

function priorityClass(priority) {
  const p = String(priority ?? '').toLowerCase()
  if (p === 'high') return ' high'
  if (p === 'low') return ' low'
  return ''
}

function metric(label, value) {
  return `<div class='metric'><span>${esc(label)}</span><b>${esc(value)}</b></div>`
}

function usageTable(title, rows, total) {
  const out = [`<div class='panel'><h2>按${esc(title)}</h2><table><tbody>`]
  for (const row of rows) {
    let share = 0.0
    if (total) share = (Number(row.tokens ?? 0) / Number(total)) * 100
    out.push(
      `<tr><td>${esc(row.name)}</td><td>${share.toFixed(1)}%</td><td>${comma(row.tokens ?? 0)}</td></tr>`,
    )
  }
  out.push('</tbody></table></div>')
  return out.join('')
}

function signalList(items) {
  if (!items || !items.length) return "<p class='muted'>暂无明显信号</p>"
  return '<ul>' + items.map((item) => `<li>${esc(item)}</li>`).join('') + '</ul>'
}

function render(report, insights) {
  const tokens = report.tokens ?? {}
  const tools = report.tools ?? {}
  const repos = report.repos ?? []
  const sources = report.sources ?? []
  const languages = report.languages ?? []
  const git = report.git_habits ?? {}
  const project = report.project_management ?? {}

  const title = insights.title || 'Codex 使用深度报告'
  const subtitle = insights.subtitle || `${report.generated_for ?? ''} · ${report.timezone ?? ''}`

  const parts = [
    "<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'>",
    "<meta name='viewport' content='width=device-width, initial-scale=1'>",
    `<title>${esc(title)}</title>`,
    '<style>',
    CSS,
    '</style></head><body><main>',
    `<header><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></header>`,
    "<section class='metrics'>",
    metric('会话', report.sessions ?? 0),
    metric('Token', comma(tokens.total ?? 0)),
    metric('估算成本', money(report.estimated_cost_usd ?? 0)),
    metric('活跃时长', report.duration ?? '0m'),
    metric('缓存命中', pct(report.cache_hit_rate ?? 0)),
    metric('Reasoning 占比', pct(report.reasoning_ratio ?? 0)),
    '</section>',
  ]

  parts.push("<section class='panel focus'><h2>执行摘要</h2><ul>")
  for (const item of insights.executive_summary ?? []) parts.push(`<li>${esc(item)}</li>`)
  if (!insights.executive_summary || !insights.executive_summary.length) {
    parts.push('<li>未提供 AI 摘要；请在 insights JSON 中补充 executive_summary。</li>')
  }
  parts.push('</ul></section>')

  parts.push("<section><h2>AI 建议</h2><div class='cards'>")
  for (const rec of insights.recommendations ?? []) {
    parts.push(
      `<article class='card rec${priorityClass(rec.priority)}'>` +
        `<strong>${esc(rec.title)}</strong>` +
        `<p class='muted'>证据：${esc(rec.evidence)}</p>` +
        `<p>${esc(rec.action)}</p>` +
        '</article>',
    )
  }
  parts.push('</div></section>')

  const insightLadder = insights.insight_ladder ?? []
  if (insightLadder.length) {
    parts.push("<section><h2>深度洞见</h2><div class='insights'>")
    for (const item of insightLadder) {
      parts.push(
        "<article class='card insight'>" +
          `<strong>${esc(item.title)}</strong>` +
          '<h3>证据</h3>' +
          `${signalList(item.evidence ?? [])}` +
          `<p><b>代表什么</b><br>${esc(item.meaning ?? '')}</p>` +
          `<p><b>为什么重要</b><br>${esc(item.impact ?? '')}</p>` +
          `<p><b>继续深入</b><br>${esc(item.drilldown ?? '')}</p>` +
          `<p><b>建议动作</b><br>${esc(item.intervention ?? '')}</p>` +
          '</article>',
      )
    }
    parts.push('</div></section>')
  }

  parts.push("<section class='grid2'>")
  parts.push(usageTable('来源', sources, tokens.total ?? 0))
  parts.push(usageTable('语言', languages, tokens.total ?? 0))
  parts.push('</section>')

  parts.push("<section class='grid2'>")
  parts.push("<div class='panel'><h2>Git 习惯</h2>")
  parts.push(
    `<p><b>${git.command_count ?? 0}</b> 次 git 命令 · <b>${git.branch_count ?? 0}</b> 个分支上下文</p>`,
  )
  parts.push(
    '<p>' + pills((git.top_subcommands ?? []).map((x) => `${x.command} ${x.count}`)) + '</p>',
  )
  parts.push(signalList([...(git.review_signals ?? []), ...(git.risk_signals ?? [])]))
  parts.push('</div>')

  parts.push("<div class='panel'><h2>项目管理习惯</h2>")
  const projectCounts = [
    `有测试 ${project.repos_with_tests ?? 0}`,
    `有构建 ${project.repos_with_build_system ?? 0}`,
    `有 CI ${project.repos_with_ci ?? 0}`,
  ]
  const changeCounts = [
    `文档/计划 ${project.documentation_changes ?? 0}`,
    `配置 ${project.config_changes ?? 0}`,
  ]
  parts.push(`<p>${pills(projectCounts)}</p>`)
  parts.push(`<p>${pills(changeCounts)}</p>`)
  parts.push(signalList(project.signals ?? []))
  parts.push('</div></section>')

  for (const section of insights.sections ?? []) {
    parts.push(`<section class='panel'><h2>${esc(section.title)}</h2><ul>`)
    for (const bullet of section.bullets ?? []) parts.push(`<li>${esc(bullet)}</li>`)
    parts.push('</ul></section>')
  }

  const sessionReviews = insights.session_reviews ?? []
  if (sessionReviews.length) {
    parts.push("<section><h2>Session Prompt 复盘</h2><div class='cards wide'>")
    for (const review of sessionReviews) {
      parts.push(
        "<article class='card'>" +
          `<strong>${esc(review.repo)}</strong>` +
          `<p class='muted'>${esc(review.session_id || review.rollout_path)}</p>` +
          `<p>${esc(review.summary)}</p>` +
          '<h3>Token 驱动</h3>' +
          `${signalList(review.token_drivers ?? [])}` +
          '<h3>Prompt 问题</h3>' +
          `${signalList(review.prompt_issues ?? [])}` +
          `<p><b>更好的起始 prompt</b><br>${esc(review.better_first_prompt ?? '')}</p>` +
          `<p><b>更好的追问</b><br>${esc(review.better_followup_prompt ?? '')}</p>` +
          `<p class='muted'>${esc(review.next_action ?? '')}</p>` +
          '</article>',
      )
    }
    parts.push('</div></section>')
  }

  parts.push(
    "<section><h2>项目画像</h2><table><thead><tr><th>项目</th><th>语言</th><th>构建/测试</th><th>变更</th><th>Token</th><th>AI 备注</th></tr></thead><tbody>",
  )
  const notes = new Map((insights.project_notes ?? []).map((n) => [n.repo, n]))
  for (const repo of repos) {
    const note = notes.get(repo.repo) ?? {}
    const changes =
      (repo.file_change_types ?? []).map((x) => `${x.type} ${x.count}`).join(', ') || '-'
    const build = pills([...(repo.build_systems ?? []), ...(repo.test_commands ?? [])])
    parts.push(
      '<tr>' +
        `<td><b>${esc(repo.repo)}</b><br><span class='muted'>${repo.sessions ?? 0} 会话 · ${money(repo.estimated_cost_usd ?? 0)}</span></td>` +
        `<td>${esc(repo.language ?? '-')}</td>` +
        `<td>${build}</td>` +
        `<td>${esc(changes)}</td>` +
        `<td>${comma(repo.tokens ?? 0)}</td>` +
        `<td>${esc(note.summary ?? '')}<br><span class='muted'>${esc(note.next_action ?? '')}</span></td>` +
        '</tr>',
    )
  }
  parts.push('</tbody></table></section>')

  parts.push("<section class='panel'><h2>原始报告来源</h2>")
  parts.push(`<p><code>${esc(report.codex_home)}</code> · source: <code>${esc(report.source)}</code></p>`)
  parts.push(
    `<p>shell ${tools.shell_calls ?? 0} · web ${tools.web_searches ?? 0} · file changes ${tools.file_changes ?? 0}</p>`,
  )
  parts.push('</section>')

  parts.push('</main></body></html>')
  return parts.join('')
}

const CSS = String.raw`
:root{color-scheme:light dark;--bg:#f6f7f5;--fg:#202322;--muted:#68706c;--panel:#fff;--line:#d8ddd9;--accent:#0f766e;--high:#b42318;--low:#4d7c0f}
@media(prefers-color-scheme:dark){:root{--bg:#111413;--fg:#edf1ef;--muted:#a7b0ab;--panel:#1a1f1d;--line:#313936;--accent:#5eead4;--high:#fca5a5;--low:#bef264}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1220px;margin:0 auto;padding:30px 18px 56px}header{margin-bottom:22px}h1{font-size:28px;margin:0 0 6px}h2{font-size:17px;margin:0 0 12px}h3{font-size:13px;margin:12px 0 6px}header p,.muted{color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:16px}.metric,.panel,.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}.metric span{display:block;color:var(--muted);font-size:12px}.metric b{display:block;font-size:21px;margin-top:5px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.cards.wide{grid-template-columns:repeat(2,minmax(0,1fr))}.insights{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.insight{border-left:4px solid var(--accent)}.focus{border-left:4px solid var(--accent);margin-bottom:16px}.rec{border-left:4px solid var(--accent)}.rec.high{border-left-color:var(--high)}.rec.low{border-left-color:var(--low)}section{margin-top:18px}table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}td,th{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:9px 10px}tr:last-child td{border-bottom:0}th{color:var(--muted);font-size:12px}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 7px;margin:0 4px 4px 0;color:var(--muted)}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}ul{margin:0;padding-left:18px}@media(max-width:900px){.metrics,.grid2,.cards,.cards.wide,.insights{grid-template-columns:1fr}main{padding:18px 12px}.metric b{font-size:18px}}
`

function main() {
  const a = parseArgs(process.argv.slice(2))
  for (const k of ['report', 'insights', 'output']) {
    if (!a[k]) {
      process.stderr.write(`missing --${k}\n`)
      process.exit(2)
    }
  }
  const report = load(a.report)
  const insights = load(a.insights)
  writeFileSync(a.output, render(report, insights))
  console.log(`wrote ${a.output}`)
}

export { render }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
