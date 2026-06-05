import { type Report, type UsageReport, type HourReport } from '../model.js'
import { comma } from '../text.js'
import { t, tf } from '../i18n.js'

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}
function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0
}
function renderUsageBreakdown(lines: string[], rows: UsageReport[], total: number): void {
  const limit = Math.min(rows.length, 8)
  for (const row of rows.slice(0, limit)) {
    lines.push(`  ${truncate(row.name, 16).padEnd(16)} ${tf('tx_sessions_n', { n: row.sessions })}  ${pct(row.tokens, total).toFixed(1).padStart(5)}%  ${comma(row.tokens)} token`)
  }
  if (rows.length > limit) lines.push(`  ${tf('tx_more_items', { n: rows.length - limit })}`)
}
function renderHours(lines: string[], hours: HourReport[], total: number): void {
  let max = 0
  for (const h of hours) if (h.tokens > max) max = h.tokens
  for (const h of hours) {
    const bars = max > 0 ? Math.trunc((h.tokens / max) * 20) : 0
    lines.push(`  ${String(h.hour).padStart(2, '0')}:00  ${'█'.repeat(bars).padEnd(20)} ${pct(h.tokens, total).toFixed(1).padStart(5)}%  ${comma(h.tokens)}`)
  }
}

// 专有名词保持原样；'all' 等可本地化项在调用期（setLang 之后）解析。
const PLATFORM_LABEL: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }
function styleLabel(s: string): string {
  return s === 'micro-manager' ? t('tx_style_micro') : s === 'free-range' ? t('tx_style_free') : t('tx_style_balanced')
}
function platformLabel(p: string): string {
  if (p === 'all') return t('tx_platform_all')
  return PLATFORM_LABEL[p] ?? p
}
function billingModeLabel(m: string): string {
  const key = 'tx_bill_' + m
  const s = t(key)
  return s === key ? m : s
}
function confidenceLabel(c: string): string {
  const key = 'tx_conf_' + c
  const s = t(key)
  return s === key ? c : s
}

// 端点/计费 + 平台特色块（ADR 0022 D2-D4 / 0023 D1-D2）：账户级当前快照 + 历史 token 拆分 + 执行画像。
function renderExtras(lines: string[], r: Report): void {
  if (r.endpoints?.length) {
    lines.push(t('tx_endpoint_header'))
    for (const e of r.endpoints) {
      const host = e.official_host ? tf('tx_ep_official', { host: e.official_host }) : e.endpoint === 'custom' ? t('tx_ep_custom') : t('tx_ep_unknown')
      const relay = e.relay_suspected ? t('tx_ep_relay_flag') : ''
      const plan = e.subscription_type ? tf('tx_ep_plan', { tier: e.subscription_type }) : ''
      const mode = billingModeLabel(e.billing_mode)
      lines.push(`  ${platformLabel(e.platform).padEnd(12)} ${tf('tx_ep_line', { host, mode, conf: confidenceLabel(e.confidence), plan, relay })}`)
    }
    lines.push('')
  }
  if (r.billing) {
    // 百分比按 Codex 子总额（= 各 tier + 未分类）算，避免 --platform all 下用混合总额误导。
    const billingTotal = Object.values(r.billing.by_plan_tier).reduce((a, c) => a + c, 0) + r.billing.unclassified
    lines.push(t('tx_billing_header'))
    for (const [tier, tok] of Object.entries(r.billing.by_plan_tier).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${tier.padEnd(12)} ${pct(tok, billingTotal).toFixed(1).padStart(5)}%  ${comma(tok)} token`)
    }
    if (r.billing.unclassified) {
      lines.push(`  ${t('tx_unclassified').padEnd(11)} ${pct(r.billing.unclassified, billingTotal).toFixed(1).padStart(5)}%  ${comma(r.billing.unclassified)} token${t('tx_unclassified_note')}`)
    }
    lines.push('  ' + tf('tx_plan_type_note', { conf: r.billing.confidence }))
    lines.push('')
  }
  if (r.codex_specific) {
    const cs = r.codex_specific
    lines.push(t('tx_codex_profile'))
    const dist = (label: string, rec?: Record<string, number>): void => {
      if (rec && Object.keys(rec).length) {
        lines.push(`  ${label}: ` + Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(' '))
      }
    }
    dist(t('tx_effort'), cs.effort)
    dist(t('tx_approval'), cs.approval_policy)
    dist(t('tx_sandbox'), cs.sandbox)
    dist(t('tx_collab'), cs.collaboration_mode)
    dist(t('tx_client'), cs.originators)
    const misc: string[] = []
    if (cs.compactions) misc.push(tf('tx_compactions', { n: cs.compactions }))
    if (cs.aborted_turns) misc.push(tf('tx_aborted', { n: cs.aborted_turns }))
    if (cs.context_window) misc.push(tf('tx_ctxwin', { n: comma(cs.context_window) }))
    if (cs.personality && Object.keys(cs.personality).length) misc.push(tf('tx_personality', { names: Object.keys(cs.personality).join('/') }))
    if (cs.git_repo_identity) misc.push(t('tx_git_identity'))
    if (misc.length) lines.push('  ' + misc.join(' · '))
    lines.push('')
  }
  if (r.claude_specific) {
    const c = r.claude_specific
    if (c.web_search_requests || c.web_fetch_requests) {
      lines.push(tf('tx_claude_server', { s: comma(c.web_search_requests), f: comma(c.web_fetch_requests) }))
      lines.push('')
    }
  }
}

export function emitText(r: Report, byRepo: boolean): string {
  const lines: string[] = []
  const label = platformLabel(r.platform)
  lines.push(`${t('tx_report_title')} · ${label} · ${r.generated_for} · ${r.timezone}`)
  lines.push(tf('tx_local_meta', { source: r.source, sessions: r.sessions, dur: r.duration }))
  lines.push('')

  if (r.tokens.total === 0) {
    lines.push(t('tx_no_records'))
    return lines.join('\n') + '\n'
  }

  lines.push('Token')
  lines.push(`  input ${comma(r.tokens.input)} · cached ${comma(r.tokens.cached_input)} · output ${comma(r.tokens.output)} · reasoning ${comma(r.tokens.reasoning_output)} · cache_creation ${comma(r.tokens.cache_creation)} · total ${comma(r.tokens.total)}`)
  lines.push('  ' + tf('tx_cache_reasoning', { chr: (r.cache_hit_rate * 100).toFixed(1), rr: (r.reasoning_ratio * 100).toFixed(1) }))
  const modelNote = r.models.length ? tf('tx_models_suffix', { m: r.models.join(', ') }) : ''
  lines.push('  ' + tf('tx_est_cost', { cost: '$' + r.estimated_cost_usd.toFixed(2), models: modelNote }))
  if (r.unpriced_models?.length) lines.push('  ' + tf('tx_unpriced', { m: r.unpriced_models.join(', ') }))
  if (r.models_timeline && r.models_timeline.length > 1) {
    lines.push('  ' + t('tx_timeline_header'))
    for (const mt of r.models_timeline) {
      const span = mt.last_day !== mt.first_day ? `${mt.first_day}→${mt.last_day}` : mt.first_day
      lines.push(`    ${truncate(mt.model, 16).padEnd(16)} ${span} · ${comma(mt.tokens)} token`)
    }
  }
  lines.push('')

  lines.push(tf('tx_tool_calls', { n: r.tools.total_calls }))
  lines.push('  ' + tf('tx_tool_breakdown', { a: r.tools.shell_calls, b: r.tools.web_searches, c: r.tools.file_changes }))
  if (r.tools.top_commands.length) {
    lines.push('  ' + t('tx_top_commands') + r.tools.top_commands.map((c) => `${c.command}(${c.count})`).join(' '))
  }
  lines.push('')

  if (r.sources.length) {
    lines.push(t('tx_by_source'))
    renderUsageBreakdown(lines, r.sources, r.tokens.total)
    lines.push('')
  }
  if (r.languages.length) {
    lines.push(t('tx_by_language'))
    renderUsageBreakdown(lines, r.languages, r.tokens.total)
    lines.push('')
  }

  const es = r.error_signals
  if (es.tool_calls > 0 || es.interrupted > 0 || es.api_errors > 0) {
    lines.push(t('tx_errors_header'))
    lines.push('  ' + tf('tx_errors_line', { e: es.tool_errors, n: es.tool_calls, r: (es.error_rate * 100).toFixed(1), i: es.interrupted, a: es.api_errors }))
    if (es.by_category?.length) lines.push('  ' + t('tx_by_category') + es.by_category.map((c) => `${c.command}(${c.count})`).join(' '))
    if (es.by_tool?.length) lines.push('  ' + t('tx_by_tool') + es.by_tool.map((c) => `${c.command}(${c.count})`).join(' '))
    lines.push('')
  }

  const rw = r.rework_signals
  if (rw.edits > 0) {
    lines.push(t('tx_rework_header'))
    lines.push('  ' + tf('tx_rework_line', { n: rw.edits, r: (rw.user_modified_rate * 100).toFixed(1), a: rw.lines_added, d: rw.lines_removed }))
    lines.push('')
  }
  const ep = r.episode_summary
  if (ep && ep.episodes > 0) {
    lines.push(t('tx_episodes_header'))
    lines.push('  ' + tf('tx_episodes_line', {
      n: ep.episodes, a: (ep.autonomy_rate * 100).toFixed(0), s: styleLabel(ep.intervention_style), sp: ep.spiral_episodes,
    }))
    const mix = Object.entries(ep.task_mix).sort((a, b) => b[1] - a[1]).slice(0, 3)
    if (mix.length) lines.push('  ' + t('tx_episode_taskmix') + mix.map(([k, v]) => `${k}(${Math.round(v * 100)}%)`).join(' '))
    if (ep.deepest_pit) lines.push('  ' + tf('tx_episode_deepest', { type: ep.deepest_pit.task_type, sev: ep.deepest_pit.severity, tok: comma(ep.deepest_pit.tokens) }))
    lines.push('')
  }
  if (r.skills?.length) {
    lines.push('Skill: ' + r.skills.map((c) => `${c.command}(${c.count})`).join(' '))
    lines.push('')
  }
  const env = r.environment
  if (env) {
    const parts: string[] = []
    if (env.claude_versions?.length) parts.push(tf('tx_env_version', { v: env.claude_versions.join('/') }))
    if (env.permission_modes?.length) parts.push(tf('tx_env_perm', { p: env.permission_modes.map((c) => `${c.command}(${c.count})`).join(' ') }))
    if (env.attachments) parts.push(tf('tx_env_attachments', { n: env.attachments }))
    if (env.subagent_messages) parts.push(tf('tx_env_subagent', { n: env.subagent_messages }))
    if (parts.length) {
      lines.push(t('tx_env_label') + parts.join(' · '))
      lines.push('')
    }
  }

  renderExtras(lines, r)

  lines.push(t('tx_habits_header'))
  lines.push('  ' + tf('tx_habits_git', { a: r.git_habits.command_count, b: r.git_habits.branch_count, c: r.git_habits.multi_branch_repos }))
  if (r.project_management.signals?.length) lines.push('  ' + tf('tx_pm_prefix', { s: r.project_management.signals.join('; ') }))
  lines.push('')

  if (r.repos.length) {
    lines.push(t('tx_by_repo'))
    let limit = r.repos.length
    if (!byRepo && limit > 8) limit = 8
    for (const rr of r.repos.slice(0, limit)) {
      const branch = byRepo && rr.branches?.length ? ` [${rr.branches.join(',')}]` : ''
      const detail = rr.language ? ` · ${rr.language}` : ''
      lines.push(`  ${truncate(rr.repo, 24).padEnd(24)} ${tf('tx_sessions_n', { n: rr.sessions })}  ${comma(rr.tokens)} token  $${rr.estimated_cost_usd.toFixed(2)}${branch}${detail}`)
    }
    if (!byRepo && r.repos.length > limit) lines.push(`  ${tf('tx_more_repos', { n: r.repos.length - limit })}`)
    lines.push('')
  }

  if (r.hours.length) {
    lines.push(t('tx_by_hour'))
    renderHours(lines, r.hours, r.tokens.total)
  }

  return lines.join('\n') + '\n'
}
