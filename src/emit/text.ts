import { type Report, type UsageReport, type HourReport } from '../model.js'
import { comma } from '../text.js'

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}
function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0
}
function renderUsageBreakdown(lines: string[], rows: UsageReport[], total: number): void {
  const limit = Math.min(rows.length, 8)
  for (const row of rows.slice(0, limit)) {
    lines.push(`  ${truncate(row.name, 16).padEnd(16)} ${row.sessions} 会话  ${pct(row.tokens, total).toFixed(1).padStart(5)}%  ${comma(row.tokens)} token`)
  }
  if (rows.length > limit) lines.push(`  …另有 ${rows.length - limit} 项`)
}
function renderHours(lines: string[], hours: HourReport[], total: number): void {
  let max = 0
  for (const h of hours) if (h.tokens > max) max = h.tokens
  for (const h of hours) {
    const bars = max > 0 ? Math.trunc((h.tokens / max) * 20) : 0
    lines.push(`  ${String(h.hour).padStart(2, '0')}:00  ${'█'.repeat(bars).padEnd(20)} ${pct(h.tokens, total).toFixed(1).padStart(5)}%  ${comma(h.tokens)}`)
  }
}

const PLATFORM_LABEL: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', all: '全部平台' }
const BILLING_MODE_LABEL: Record<string, string> = { subscription: '订阅', api_or_relay: 'API/中转', unknown: '未知' }
const CONFIDENCE_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' }

// 端点/计费 + 平台特色块（ADR 0022 D2-D4 / 0023 D1-D2）：账户级当前快照 + 历史 token 拆分 + 执行画像。
function renderExtras(lines: string[], r: Report): void {
  if (r.endpoints?.length) {
    lines.push('端点 / 计费模式（账户级当前快照，读本机 config）')
    for (const e of r.endpoints) {
      const host = e.official_host ? `官方(${e.official_host})` : e.endpoint === 'custom' ? '自定义/中转' : '未知端点'
      const relay = e.relay_suspected ? ' ⚠️疑似中转' : ''
      const sub = e.subscription_type ? ` · 订阅档 ${e.subscription_type}` : ''
      const mode = BILLING_MODE_LABEL[e.billing_mode] ?? e.billing_mode
      lines.push(`  ${(PLATFORM_LABEL[e.platform] ?? e.platform).padEnd(12)} ${host} · 计费 ${mode}（置信${CONFIDENCE_LABEL[e.confidence] ?? e.confidence}）${sub}${relay}`)
    }
    lines.push('')
  }
  if (r.billing) {
    // 百分比按 Codex 子总额（= 各 tier + 未分类）算，避免 --platform all 下用混合总额误导。
    const billingTotal = Object.values(r.billing.by_plan_tier).reduce((a, c) => a + c, 0) + r.billing.unclassified
    lines.push('计费拆分（Codex，按订阅 plan tier）')
    for (const [tier, tok] of Object.entries(r.billing.by_plan_tier).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${tier.padEnd(12)} ${pct(tok, billingTotal).toFixed(1).padStart(5)}%  ${comma(tok)} token`)
    }
    if (r.billing.unclassified) {
      lines.push(`  ${'未分类'.padEnd(11)} ${pct(r.billing.unclassified, billingTotal).toFixed(1).padStart(5)}%  ${comma(r.billing.unclassified)} token（有token无plan_type，≠确定API）`)
    }
    lines.push(`  ⓘ plan_type 来自后端响应、可被中转伪造（confidence: ${r.billing.confidence}）`)
    lines.push('')
  }
  if (r.codex_specific) {
    const cs = r.codex_specific
    lines.push('Codex 执行画像')
    const dist = (label: string, rec?: Record<string, number>): void => {
      if (rec && Object.keys(rec).length) {
        lines.push(`  ${label}: ` + Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(' '))
      }
    }
    dist('推理强度', cs.effort)
    dist('审批策略', cs.approval_policy)
    dist('沙箱', cs.sandbox)
    dist('协作模式', cs.collaboration_mode)
    dist('客户端', cs.originators)
    const misc: string[] = []
    if (cs.compactions) misc.push(`上下文压缩 ${cs.compactions}`)
    if (cs.aborted_turns) misc.push(`放弃回合 ${cs.aborted_turns}`)
    if (cs.context_window) misc.push(`上下文窗口 ${comma(cs.context_window)}`)
    if (cs.personality && Object.keys(cs.personality).length) misc.push('人格 ' + Object.keys(cs.personality).join('/'))
    if (cs.git_repo_identity) misc.push('git 仓库身份 ✓')
    if (misc.length) lines.push('  ' + misc.join(' · '))
    lines.push('')
  }
  if (r.claude_specific) {
    const c = r.claude_specific
    if (c.web_search_requests || c.web_fetch_requests) {
      lines.push(`Claude 服务端工具: web 搜索 ${comma(c.web_search_requests)} · web 抓取 ${comma(c.web_fetch_requests)}`)
      lines.push('')
    }
  }
}

export function emitText(r: Report, byRepo: boolean): string {
  const lines: string[] = []
  const label = PLATFORM_LABEL[r.platform] ?? r.platform
  lines.push(`AI 用量报告 · ${label} · ${r.generated_for} · ${r.timezone}`)
  lines.push(`仅本机数据 (来源: ${r.source}) · ${r.sessions} 个会话 · 时长 ${r.duration}`)
  lines.push('')

  if (r.tokens.total === 0) {
    lines.push('（该时间窗口内没有使用记录）')
    return lines.join('\n') + '\n'
  }

  lines.push('Token')
  lines.push(`  input ${comma(r.tokens.input)} · cached ${comma(r.tokens.cached_input)} · output ${comma(r.tokens.output)} · reasoning ${comma(r.tokens.reasoning_output)} · cache_creation ${comma(r.tokens.cache_creation)} · total ${comma(r.tokens.total)}`)
  lines.push(`  缓存命中率 ${(r.cache_hit_rate * 100).toFixed(1)}% · reasoning 占 output ${(r.reasoning_ratio * 100).toFixed(1)}%`)
  const modelNote = r.models.length ? ' · 模型: ' + r.models.join(', ') : ''
  lines.push(`  估算成本 $${r.estimated_cost_usd.toFixed(2)}（估算价，仅供参考${modelNote}）`)
  if (r.unpriced_models?.length) lines.push(`  注意: 以下模型无内置价格，未计入成本: ${r.unpriced_models.join(', ')}`)
  if (r.models_timeline && r.models_timeline.length > 1) {
    lines.push('  模型时间线 (首次→最后, 本机时区):')
    for (const mt of r.models_timeline) {
      const span = mt.last_day !== mt.first_day ? `${mt.first_day}→${mt.last_day}` : mt.first_day
      lines.push(`    ${truncate(mt.model, 16).padEnd(16)} ${span} · ${comma(mt.tokens)} token`)
    }
  }
  lines.push('')

  lines.push(`工具调用 (共 ${r.tools.total_calls})`)
  lines.push(`  shell ${r.tools.shell_calls} · web 搜索 ${r.tools.web_searches} · 改文件 ${r.tools.file_changes}`)
  if (r.tools.top_commands.length) {
    lines.push('  top 命令: ' + r.tools.top_commands.map((c) => `${c.command}(${c.count})`).join(' '))
  }
  lines.push('')

  if (r.sources.length) {
    lines.push('按来源')
    renderUsageBreakdown(lines, r.sources, r.tokens.total)
    lines.push('')
  }
  if (r.languages.length) {
    lines.push('按语言（根据本机仓库文件估算）')
    renderUsageBreakdown(lines, r.languages, r.tokens.total)
    lines.push('')
  }

  const es = r.error_signals
  if (es.tool_calls > 0 || es.interrupted > 0 || es.api_errors > 0) {
    lines.push('错误 / 卡顿')
    lines.push(`  工具失败 ${es.tool_errors}/${es.tool_calls} (${(es.error_rate * 100).toFixed(1)}%) · 中断 ${es.interrupted} · API 错误 ${es.api_errors}`)
    if (es.by_category?.length) lines.push('  按类别: ' + es.by_category.map((c) => `${c.command}(${c.count})`).join(' '))
    if (es.by_tool?.length) lines.push('  按工具: ' + es.by_tool.map((c) => `${c.command}(${c.count})`).join(' '))
    lines.push('')
  }

  const rw = r.rework_signals
  if (rw.edits > 0) {
    lines.push('返工 / 改动')
    lines.push(`  编辑 ${rw.edits} 次 · 手改率 ${(rw.user_modified_rate * 100).toFixed(1)}% · +${rw.lines_added}/-${rw.lines_removed} 行`)
    lines.push('')
  }
  if (r.skills?.length) {
    lines.push('Skill: ' + r.skills.map((c) => `${c.command}(${c.count})`).join(' '))
    lines.push('')
  }
  const env = r.environment
  if (env) {
    const parts: string[] = []
    if (env.claude_versions?.length) parts.push('版本 ' + env.claude_versions.join('/'))
    if (env.permission_modes?.length) parts.push('权限 ' + env.permission_modes.map((c) => `${c.command}(${c.count})`).join(' '))
    if (env.attachments) parts.push(`附件 ${env.attachments}`)
    if (env.subagent_messages) parts.push(`子代理消息 ${env.subagent_messages}`)
    if (parts.length) {
      lines.push('环境: ' + parts.join(' · '))
      lines.push('')
    }
  }

  renderExtras(lines, r)

  lines.push('习惯')
  lines.push(`  Git 命令 ${r.git_habits.command_count} 次 · 分支上下文 ${r.git_habits.branch_count} 个 · 多分支仓库 ${r.git_habits.multi_branch_repos} 个`)
  if (r.project_management.signals?.length) lines.push(`  项目管理: ${r.project_management.signals.join('；')}`)
  lines.push('')

  if (r.repos.length) {
    lines.push('按仓库')
    let limit = r.repos.length
    if (!byRepo && limit > 8) limit = 8
    for (const rr of r.repos.slice(0, limit)) {
      const branch = byRepo && rr.branches?.length ? ` [${rr.branches.join(',')}]` : ''
      const detail = rr.language ? ` · ${rr.language}` : ''
      lines.push(`  ${truncate(rr.repo, 24).padEnd(24)} ${rr.sessions} 会话  ${comma(rr.tokens)} token  $${rr.estimated_cost_usd.toFixed(2)}${branch}${detail}`)
    }
    if (!byRepo && r.repos.length > limit) lines.push(`  …另有 ${r.repos.length - limit} 个仓库（用 --by-repo 查看全部）`)
    lines.push('')
  }

  if (r.hours.length) {
    lines.push('按时段 (本机时间)')
    renderHours(lines, r.hours, r.tokens.total)
  }

  return lines.join('\n') + '\n'
}
