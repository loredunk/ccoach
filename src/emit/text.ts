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
