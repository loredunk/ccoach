// src/digest.ts — opt-in、token 受控、redacted 的单会话正文摘要（ADR 0049）。
// 提取 assistant 文本回复 + 工具输入 + tool_result 正文；**绝不含 thinking / system·developer prompt /
// 文件内容做内容用途**。原始正文瞬时派生即弃，落地只有截断+脱敏后的摘要。复用 sessions.redact()。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { redact } from './sessions.js'

export interface DigestOpts {
  sessionId: string // 必填：指定单会话（子串匹配，与 sessions --id 一致）
  perItem?: number // 单项码点上限（默认 200）
  maxTotal?: number // 总量码点上限（默认 30000）
}
export type DigestBudget = 'tight' | 'rich'
export const BUDGETS: Record<DigestBudget, { perItem: number; maxTotal: number }> = {
  tight: { perItem: 200, maxTotal: 30000 },
  rich: { perItem: 600, maxTotal: 120000 },
}

interface DigestItem { kind: string; text: string }

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

function toolInputSummary(name: string, input: any): string {
  if (!input || typeof input !== 'object') return ''
  if (name === 'Bash') return 'cmd: ' + String(input.command ?? '')
  if (name === 'Edit' || name === 'NotebookEdit') return 'file ' + String(input.file_path ?? input.notebook_path ?? '') + ' | -' + String(input.old_string ?? '').slice(0, 140) + ' +' + String(input.new_string ?? '').slice(0, 140)
  if (name === 'Write') return 'file ' + String(input.file_path ?? '') + ' | ' + String(input.content ?? '').slice(0, 160)
  if (name === 'Read') return 'file ' + String(input.file_path ?? '')
  if (name === 'Grep') return 'q ' + String(input.pattern ?? '') + ' @ ' + String(input.path ?? input.glob ?? '')
  return JSON.stringify(input).slice(0, 220)
}

function resultText(rec: any): { text: string; isError: boolean } {
  const parts: string[] = []
  let isError = false
  const r = rec.toolUseResult
  if (r) {
    if (typeof r === 'string') parts.push(r)
    else {
      if (r.stdout) parts.push(String(r.stdout))
      if (r.stderr) parts.push('[stderr] ' + String(r.stderr))
      if (typeof r.content === 'string') parts.push(r.content)
      else if (Array.isArray(r.content)) parts.push(r.content.map((c: any) => c?.text ?? '').join(' '))
      if (r.is_error === true) isError = true
    }
  }
  const c = rec.message?.content
  if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_result') {
    const cc = b.content
    if (typeof cc === 'string') parts.push(cc)
    else if (Array.isArray(cc)) parts.push(cc.map((x: any) => x?.text ?? '').join(' '))
    if (b.is_error === true) isError = true
  }
  return { text: parts.join(' ').trim(), isError }
}

const cps = (s: string): number => [...s].length
function trunc(s: string, n: number): string { const a = [...s]; return a.length > n ? a.slice(0, n).join('') + '…' : s }

// 共享打包：脱敏 + 逐项截断 + 总量封顶 + stats（两平台同一输出形状）。
function packDigest(platform: string, sessionId: string, items: DigestItem[], perItem: number, maxTotal: number): Record<string, unknown> {
  const emitted: DigestItem[] = []
  let total = 0, rawChars = 0, dropped = 0
  for (const it of items) {
    rawChars += cps(it.text)
    if (total >= maxTotal) { dropped++; continue }
    const red = redact(it.text.replace(/\s+/g, ' '), perItem)
    emitted.push({ kind: it.kind, text: red })
    total += cps(red)
  }
  return {
    platform,
    session_id: sessionId,
    budget: { per_item: perItem, max_total: maxTotal },
    includes_content: true,
    excludes: ['thinking', 'system_prompt', 'file_contents_as_content'],
    stats: { items: items.length, emitted: emitted.length, dropped, raw_chars: rawChars, emitted_chars: total, est_tokens: Math.round(total / 4) },
    items: emitted,
  }
}

// 不接受时间窗：--id 点名单会话即范围（窗口会把旧会话过滤空，是 papercut）。
export function buildDigest(dir: string, opts: DigestOpts): Record<string, unknown> {
  const perItem = opts.perItem ?? BUDGETS.tight.perItem
  const maxTotal = opts.maxTotal ?? BUDGETS.tight.maxTotal
  const want = opts.sessionId

  const recs: any[] = []
  for (const file of walkJsonl(dir)) {
    let content: string
    try { content = readFileSync(file, 'utf8') } catch { continue }
    for (const line of content.split('\n')) {
      const t = line.trim(); if (!t) continue
      let rec: any
      try { rec = JSON.parse(t) } catch { continue }
      if (rec?.isSidechain === true) continue
      const sid = typeof rec.sessionId === 'string' ? rec.sessionId : ''
      if (!sid || !sid.includes(want)) continue
      const tsRaw = rec?.timestamp
      const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : null
      const tsv = ts && !Number.isNaN(ts.getTime()) ? ts : null
      rec.__ts = tsv ? tsv.getTime() : 0
      recs.push(rec)
    }
  }
  recs.sort((a, b) => a.__ts - b.__ts)

  const items: DigestItem[] = []
  for (const rec of recs) {
    if (rec.type === 'assistant') {
      const c = Array.isArray(rec.message?.content) ? rec.message.content : []
      for (const b of c) {
        if (b?.type === 'text' && b.text) items.push({ kind: 'ASSISTANT', text: String(b.text) })
        else if (b?.type === 'tool_use') items.push({ kind: 'TOOL', text: String(b.name ?? '') + ' ' + toolInputSummary(b.name, b.input) })
        // thinking 故意排除
      }
    } else if (rec.type === 'user') {
      const { text, isError } = resultText(rec)
      if (text) items.push({ kind: isError ? 'RESULT_ERR' : 'RESULT', text })
    }
  }

  const sid = recs.length ? String(recs[0].sessionId) : want
  return packDigest('claude-code', sid, items, perItem, maxTotal)
}

// Codex 正文 digest（ADR 0050 D3）：从单 rollout 提取 assistant 文本 + function_call args + 工具结果正文。
// **绝不含 reasoning（思维链）/ developer / system / instructions**。--id 子串定位单会话（每 rollout = 一会话）。
export function buildCodexDigest(home: string, opts: DigestOpts): Record<string, unknown> {
  const perItem = opts.perItem ?? BUDGETS.tight.perItem
  const maxTotal = opts.maxTotal ?? BUDGETS.tight.maxTotal
  const want = opts.sessionId

  let chosen: any[] | null = null
  let chosenSid = want
  for (const file of walkJsonl(join(home, 'sessions'))) {
    let content: string
    try { content = readFileSync(file, 'utf8') } catch { continue }
    const recs: any[] = []
    let sid = ''
    for (const line of content.split('\n')) {
      const t = line.trim(); if (!t) continue
      let rec: any
      try { rec = JSON.parse(t) } catch { continue }
      if (rec?.type === 'session_meta' && typeof rec.payload?.id === 'string') sid = rec.payload.id
      recs.push(rec)
    }
    if (sid && sid.includes(want)) { chosen = recs; chosenSid = sid; break }
  }

  const items: DigestItem[] = []
  for (const rec of chosen ?? []) {
    if (rec?.type !== 'response_item') continue // event_msg/turn_context/reasoning-at-other-levels 跳过
    const p = rec.payload ?? {}
    const t = p.type
    if (t === 'message') {
      if (p.role !== 'assistant') continue // 绝不取 developer/system；user prompt 走 sessions --include-user-prompts
      const txt = Array.isArray(p.content) ? p.content.map((c: any) => c?.text ?? c?.input_text ?? '').join(' ') : ''
      if (txt.trim()) items.push({ kind: 'ASSISTANT', text: txt })
    } else if (t === 'function_call') {
      const args = typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments ?? {})
      items.push({ kind: 'TOOL', text: String(p.name ?? '') + ' ' + args })
    } else if (t === 'function_call_output' || t === 'local_shell_call_output' || t === 'custom_tool_call_output') {
      const o = p.output
      let text = typeof o === 'string' ? o : JSON.stringify(o ?? '')
      try { const j = JSON.parse(text); if (j && typeof j.output === 'string') text = j.output } catch { /* 纯文本输出 */ }
      if (text.trim()) items.push({ kind: 'RESULT', text })
    }
    // reasoning 及其它：故意排除（思维链红线）
  }
  return packDigest('codex', chosenSid, items, perItem, maxTotal)
}
