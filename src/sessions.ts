// `ccoach sessions`：会话候选清单 + opt-in 单会话 redacted prompt 预览（双平台）。
// 取代 skill 的 claude_session_prompts.py（Claude）与 session_drilldown.py（Codex）。
//
// 隐私（ADR 0014/0015/0018，红线不放宽）：
//   - 列表只含派生数值/计数 + prompt 数值信号，零 prompt 原文。
//   - 仅 --include-user-prompts 才产出**单会话** redacted prompts，脱敏（密钥/home/邮箱/IP/深路径折叠）+ 截断、纯本地。
//   - 绝不读 assistant/思考/tool_result 正文/system·developer/文件内容。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { inLocalRange, type Window } from './window.js'
import { repoName } from './text.js'
import { promptFlags, type PromptFlags } from './prompt-signals.js'
import { isHumanPrompt } from './human-prompt.js'

export interface SessionsOpts {
  repo?: string
  sessionId?: string
  rollout?: string // codex：指定 rollout 文件
  top?: number
  includePrompts?: boolean
  promptCharLimit?: number
}

function num(x: unknown): number { return typeof x === 'number' && isFinite(x) ? x : 0 }
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4
function tzName(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }

// ---- 脱敏（逐条移植 claude_session_prompts.py 的 REDACTORS / redact，对两平台统一使用）----
const HOME = homedir()
const REDACTORS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9_-]{12,}/g, 'sk-REDACTED'],
  [/ghp_[A-Za-z0-9]{12,}/g, 'ghp_REDACTED'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'xox-REDACTED'],
  [/AKIA[0-9A-Z]{12,}/g, 'AKIA-REDACTED'],
  [/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, '$1=REDACTED'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>'],
]
export function redact(text: string, charLimit: number): string {
  let t = HOME ? text.split(HOME).join('~') : text
  for (const [rgx, repl] of REDACTORS) t = t.replace(rgx, repl)
  // 折叠深层绝对路径到尾段
  t = t.replace(/(?:\/[\w.\-]+){3,}/g, (m) => '/…/' + (m.split('/').pop() ?? ''))
  t = t.trim()
  const cps = [...t] // 按码点截断，对齐 Python len
  if (cps.length > charLimit) t = cps.slice(0, charLimit).join('').replace(/\s+$/, '') + ' …[truncated]'
  return t
}

function walkJsonl(dir: string): string[] {
  const out: string[] = []
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkJsonl(p))
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
  }
  return out.sort()
}

// ===================== Claude Code =====================
function userText(message: any): string {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const c of content) {
    if (typeof c === 'string') parts.push(c)
    else if (c && c.type === 'text' && typeof c.text === 'string') parts.push(c.text)
  }
  return parts.join('\n')
}

interface ClaudeSess {
  session_id: string
  repo: string | null
  tokens: number
  tool_calls: number
  prompts: number
  first: Date | null
  last: Date | null
  models: Set<string>
  flags: { structured: number; file_ref: number; constraint: number; correction: number }
  len_sum: number
  texts: { ts: Date | null; text: string; fl: PromptFlags }[]
}

function claudeSummary(s: ClaudeSess): Record<string, unknown> {
  const n = s.prompts || 1
  const span = s.first && s.last ? Math.round(((s.last.getTime() - s.first.getTime()) / 60000) * 10) / 10 : null
  return {
    session_id: s.session_id,
    repo: s.repo ?? '(unknown)',
    tokens: s.tokens,
    tool_calls: s.tool_calls,
    prompts: s.prompts,
    models: [...s.models].sort(),
    first: s.first ? s.first.toISOString() : null,
    last: s.last ? s.last.toISOString() : null,
    span_minutes: span,
    prompt_signals: {
      avg_len: Math.round((s.len_sum / n) * 10) / 10,
      structured_ratio: r4(s.flags.structured / n),
      file_ref_ratio: r4(s.flags.file_ref / n),
      constraint_ratio: r4(s.flags.constraint / n),
      correction_rate: r4(s.flags.correction / n),
    },
  }
}

export function listClaudeSessions(dir: string, window: Window, opts: SessionsOpts): Record<string, unknown> {
  const include = opts.includePrompts === true
  const top = opts.top ?? 20
  const charLimit = opts.promptCharLimit ?? 1200
  // 标准本机授权（ADR 0015）：include 且未指定 id → 先全收文本、后只留 token 最高那一个会话；否则不收文本。
  const wantId = include ? opts.sessionId || '*' : null

  const seen = new Set<string>()
  const sessions = new Map<string, ClaudeSess>()
  for (const file of walkJsonl(dir)) {
    let content: string
    try { content = readFileSync(file, 'utf8') } catch { continue }
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!t) continue
      let rec: any
      try { rec = JSON.parse(t) } catch { continue }
      if (rec?.isSidechain === true) continue // 子代理：非人类会话，排除
      const sid = typeof rec.sessionId === 'string' ? rec.sessionId : ''
      if (!sid) continue
      const tsRaw = rec?.timestamp
      const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : null
      const tsv = ts && !Number.isNaN(ts.getTime()) ? ts : null
      if (tsv && !inLocalRange(tsv, window)) continue
      // 跨文件去重（对齐主解析）：assistant 用 message.id:requestId，其它用 uuid。
      const msgId = rec?.message?.id
      const dedupKey =
        typeof msgId === 'string' && msgId !== '' ? `${msgId}:${rec?.requestId ?? ''}`
          : typeof rec?.uuid === 'string' && rec.uuid !== '' ? rec.uuid : null
      if (dedupKey !== null) { if (seen.has(dedupKey)) continue; seen.add(dedupKey) }

      let s = sessions.get(sid)
      if (!s) {
        s = { session_id: sid, repo: null, tokens: 0, tool_calls: 0, prompts: 0, first: null, last: null, models: new Set(), flags: { structured: 0, file_ref: 0, constraint: 0, correction: 0 }, len_sum: 0, texts: [] }
        sessions.set(sid, s)
      }
      const cwd = typeof rec.cwd === 'string' ? rec.cwd : ''
      if (s.repo === null && cwd) s.repo = repoName(cwd)
      if (tsv) { if (!s.first || tsv < s.first) s.first = tsv; if (!s.last || tsv > s.last) s.last = tsv }

      if (rec.type === 'user') {
        const text = userText(rec.message).trim()
        if (!text) continue // 纯 tool_result 消息，非人类 prompt
        if (!isHumanPrompt(rec, text)) continue // isMeta/命令桩/中断哨兵：机器注入，非真人 prompt（ADR 0043，与主解析器同一谓词）
        s.prompts += 1
        const fl = promptFlags(text)
        s.len_sum += fl.len
        if (fl.structured) s.flags.structured += 1
        if (fl.file_ref) s.flags.file_ref += 1
        if (fl.constraint) s.flags.constraint += 1
        if (fl.correction) s.flags.correction += 1
        if (wantId && (wantId === '*' || sid.includes(wantId))) s.texts.push({ ts: tsv, text, fl })
      } else if (rec.type === 'assistant') {
        const u = rec.message?.usage ?? {}
        s.tokens += num(u.input_tokens) + num(u.output_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens)
        const model = rec.message?.model
        if (typeof model === 'string' && model) s.models.add(model)
        for (const c of Array.isArray(rec.message?.content) ? rec.message.content : []) {
          if (c && c.type === 'tool_use') s.tool_calls += 1
        }
      }
    }
  }

  let rows = [...sessions.values()]
  if (opts.sessionId) rows = rows.filter((s) => s.session_id.includes(opts.sessionId!))
  if (opts.repo) { const rl = opts.repo.toLowerCase(); rows = rows.filter((s) => (s.repo ?? '').toLowerCase().includes(rl)) }
  rows.sort((a, b) => b.tokens - a.tokens || b.tool_calls - a.tool_calls)
  if (include) rows = rows.slice(0, 1) // 单会话：选中的 / token 最高的
  else if (top > 0) rows = rows.slice(0, top)

  const out: Record<string, unknown> = {
    platform: 'claude-code',
    generated_for: window.desc,
    timezone: tzName(),
    source: '~/.claude/projects/**/*.jsonl (本地解析)',
    includes_user_prompts: include,
    prompt_scope: include ? 'one selected session' : 'none',
    sessions: rows.map(claudeSummary),
  }
  if (include && rows.length) {
    const s = rows[0]
    const prompts = [...s.texts]
      .sort((a, b) => (a.ts?.getTime() ?? -Infinity) - (b.ts?.getTime() ?? -Infinity))
      .map((p, i) => ({
        idx: i,
        timestamp: p.ts ? p.ts.toISOString() : null,
        signals: { len: p.fl.len, structured: p.fl.structured, file_ref: p.fl.file_ref, constraint: p.fl.constraint, correction: p.fl.correction },
        preview: redact(p.text, charLimit),
      }))
    out.selected_session = { ...claudeSummary(s), prompts }
  }
  return out
}

// ===================== Codex =====================
function globRollouts(home: string): string[] {
  const root = join(home, 'sessions')
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

function sourceKey(source: string): string {
  const s = (source ?? '').trim().toLowerCase()
  if (s === '') return '(unknown)'
  if (s.includes('vscode') || s.includes('ide')) return 'plugin'
  if (s.includes('codex-app') || s.includes('desktop') || s === 'app') return 'codex-app'
  if (s.includes('cli') || s.includes('terminal')) return 'cli'
  return s
}
function repoKey(origin: string, cwd: string): string {
  const o = (origin ?? '').replace(/\/+$/, '').replace(/\.git$/, '')
  if (o) { const parts = o.split(/[/ :]/); return parts[parts.length - 1] || '(unknown)' }
  return cwd ? repoName(cwd) : '(unknown)'
}
function commandFromArgs(raw: string): string {
  let a: any
  try { a = JSON.parse(raw) } catch { return '' }
  if (a && typeof a === 'object') {
    if (typeof a.cmd === 'string') return a.cmd.split(/\s+/).filter(Boolean).join(' ')
    if (Array.isArray(a.command)) return a.command.map((x: unknown) => String(x)).join(' ')
  }
  return ''
}
function collectText(value: any): string {
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean).join(' ')
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join(' ')
  if (value && typeof value === 'object') {
    const parts: string[] = []
    for (const key of ['text', 'input_text', 'content', 'message']) if (key in value) parts.push(collectText(value[key]))
    return parts.filter(Boolean).join(' ')
  }
  return ''
}
function extractUserPrompt(lineType: string, payload: any): string {
  let role = payload?.role
  if (payload && typeof payload.author === 'object' && payload.author) role = role || payload.author.role
  if (role === 'user') return collectText(payload.content ?? payload.text ?? payload.message ?? payload)
  if (lineType === 'user_message' || lineType === 'user_prompt' || lineType === 'input_message') {
    return collectText(payload.content ?? payload.text ?? payload.message ?? payload)
  }
  if (lineType === 'response_item' && payload?.type === 'message' && payload?.role === 'user') {
    return collectText(payload.content ?? payload)
  }
  return ''
}
function isSubagentRollout(lines: string[]): boolean {
  for (const line of lines) {
    const t = line.trim(); if (!t) continue
    let rec: any
    try { rec = JSON.parse(t) } catch { continue }
    if (rec?.type === 'session_meta') {
      const probe = { ...(rec.payload ?? {}) }
      delete probe.cwd
      const s = JSON.stringify(probe)
      return s.includes('subagent') || s.includes('thread_spawn')
    }
  }
  return false
}

interface CodexTok { input: number; cached_input: number; output: number; reasoning_output: number; total: number }
function tokUsage(raw: any): CodexTok {
  return {
    input: num(raw?.input_tokens), cached_input: num(raw?.cached_input_tokens), output: num(raw?.output_tokens),
    reasoning_output: num(raw?.reasoning_output_tokens), total: num(raw?.total_tokens),
  }
}

function parseRolloutSession(file: string, window: Window, include: boolean, charLimit: number): Record<string, unknown> | null {
  let content: string
  try { content = readFileSync(file, 'utf8') } catch { return null }
  const lines = content.split('\n')
  if (isSubagentRollout(lines)) return null

  let sessionId = ''
  let cwd = ''
  let source = ''
  let branch = ''
  let model = ''
  let origin = ''
  const tokens: CodexTok = { input: 0, cached_input: 0, output: 0, reasoning_output: 0, total: 0 }
  const tools = { shell_calls: 0, web_searches: 0, file_changes: 0, total_calls: 0 }
  const commands = new Map<string, number>()
  const prompts: { timestamp: string | null; text: string }[] = []
  let first: Date | null = null
  let last: Date | null = null
  let baseline: CodexTok | null = null
  const span = (ts: Date | null): void => {
    if (!ts) return
    if (!first || ts < first) first = ts
    if (!last || ts > last) last = ts
  }

  for (const raw of lines) {
    const tr = raw.trim(); if (!tr) continue
    let rec: any
    try { rec = JSON.parse(tr) } catch { continue }
    const tsRaw = rec?.timestamp
    const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : null
    const tsv = ts && !Number.isNaN(ts.getTime()) ? ts : null
    const inWin = tsv ? inLocalRange(tsv, window) : false
    const payload = rec?.payload ?? {}
    const lineType = rec?.type ?? ''

    if (lineType === 'session_meta') {
      sessionId = sessionId || (typeof payload.id === 'string' ? payload.id : '')
      cwd = cwd || (typeof payload.cwd === 'string' ? payload.cwd : '')
      source = source || (typeof payload.source === 'string' ? payload.source : '')
      origin = origin || (typeof payload.git_origin_url === 'string' ? payload.git_origin_url : '')
      branch = branch || (typeof payload.git_branch === 'string' ? payload.git_branch : '')
    } else if (lineType === 'turn_context') {
      if (typeof payload.model === 'string' && payload.model) model = payload.model
    }

    if (lineType === 'event_msg') {
      const et = payload.type
      if (et === 'token_count' && payload.info) {
        const cur = tokUsage(payload.info.total_token_usage ?? {})
        if (baseline === null) { baseline = cur; continue }
        const delta: CodexTok = {
          input: cur.input - baseline.input, cached_input: cur.cached_input - baseline.cached_input,
          output: cur.output - baseline.output, reasoning_output: cur.reasoning_output - baseline.reasoning_output,
          total: cur.total - baseline.total,
        }
        baseline = cur
        if (delta.total < 0 || !inWin) continue
        tokens.input += delta.input; tokens.cached_input += delta.cached_input; tokens.output += delta.output
        tokens.reasoning_output += delta.reasoning_output; tokens.total += delta.total
        span(tsv)
      } else if (et === 'patch_apply_end' && inWin) {
        tools.file_changes += Object.keys(payload.changes ?? {}).length
        span(tsv)
      }
    }

    if (lineType === 'response_item' && inWin) {
      const it = payload.type
      if (it === 'function_call' || it === 'local_shell_call' || it === 'custom_tool_call' || it === 'web_search_call') {
        tools.total_calls += 1
        span(tsv)
      }
      if (it === 'function_call') {
        const name = payload.name
        if (name === 'exec_command' || name === 'local_shell_call' || name === 'shell') {
          tools.shell_calls += 1
          const cmd = commandFromArgs(typeof payload.arguments === 'string' ? payload.arguments : '')
          if (cmd) { const head = cmd.split(/\s+/)[0]; commands.set(head, (commands.get(head) ?? 0) + 1) }
        } else if (name === 'web_search_call') {
          tools.web_searches += 1
        }
      } else if (it === 'web_search_call') {
        tools.web_searches += 1
      }
    }

    if (include && inWin) {
      const text = extractUserPrompt(lineType, payload)
      // Codex rollout 无 isMeta/命令桩/中断哨兵这类机器注入 user 记录，此门对现有数据是 no-op；
      // 用同一谓词保持与 Claude 路径对称（单一真相源），格式若演进出注入记录则自动挡住（ADR 0011/0043）。
      if (text && isHumanPrompt(payload, text)) prompts.push({ timestamp: tsv ? tsv.toISOString() : null, text: redact(text, charLimit) })
    }
  }

  if (tokens.total === 0 && tools.total_calls === 0 && prompts.length === 0) return null

  const topCommands = [...commands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([command, count]) => ({ command, count }))
  const f: Date | null = first
  const l: Date | null = last
  const result: Record<string, unknown> = {
    session_id: sessionId,
    repo: repoKey(origin, cwd),
    source: sourceKey(source),
    branch,
    model,
    rollout_path: file,
    first_seen: f ? (f as Date).toISOString() : '',
    last_seen: l ? (l as Date).toISOString() : '',
    duration_seconds: f && l ? Math.floor(((l as Date).getTime() - (f as Date).getTime()) / 1000) : 0,
    tokens,
    tools,
    top_commands: topCommands,
    prompt_count: prompts.length,
  }
  if (include) result.user_prompts = prompts
  return result
}

export function listCodexSessions(home: string, window: Window, opts: SessionsOpts): Record<string, unknown> {
  const include = opts.includePrompts === true
  const top = opts.top ?? 20
  const charLimit = opts.promptCharLimit ?? 1200
  const files = opts.rollout ? [opts.rollout] : globRollouts(home)
  let sessions: Record<string, unknown>[] = []
  for (const file of files) {
    const parsed = parseRolloutSession(file, window, include, charLimit)
    if (!parsed) continue
    if (opts.sessionId && !String(parsed.session_id ?? '').includes(opts.sessionId)) continue
    if (opts.repo) {
      const hay = `${parsed.repo ?? ''}`.toLowerCase()
      if (!hay.includes(opts.repo.toLowerCase())) continue
    }
    sessions.push(parsed)
  }
  sessions.sort((a, b) => {
    const ta = (a.tokens as CodexTok).total, tb = (b.tokens as CodexTok).total
    if (tb !== ta) return tb - ta
    return (b.tools as any).total_calls - (a.tools as any).total_calls
  })
  if (top > 0) sessions = sessions.slice(0, top)
  return {
    platform: 'codex',
    generated_for: window.desc,
    codex_home: home,
    privacy: { includes_user_prompts: include, includes_system_prompts: false, prompt_scope: include ? 'one selected session' : 'none' },
    sessions,
  }
}
