import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Aggregator } from '../aggregate.js'
import { inLocalRange, type Window } from '../window.js'
import { repoName, extOf } from '../text.js'
import { type Tokens, type Report } from '../model.js'

// $CLAUDE_CONFIG_DIR/projects 或 ~/.claude/projects
export function claudeProjectsDir(): string {
  const cfg = process.env.CLAUDE_CONFIG_DIR
  if (cfg && cfg.trim()) return join(cfg.trim(), 'projects')
  return join(homedir(), '.claude', 'projects')
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

function num(x: unknown): number {
  return typeof x === 'number' && isFinite(x) ? x : 0
}

// 仅取 user 自述文本（纯字符串或 type==='text' 块）；瞬时派生信号、绝不存储。
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

export function parseClaudeCode(dir: string, window: Window): Report {
  const agg = new Aggregator('claude-code')
  for (const file of walkJsonl(dir)) {
    agg.resetActive() // 每个文件独立计活跃时长，避免跨文件桥接
    let content: string
    try { content = readFileSync(file, 'utf8') } catch { continue }
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let rec: any
      try { rec = JSON.parse(trimmed) } catch { continue }
      if (rec?.isSidechain === true) continue
      const tsRaw = rec?.timestamp
      if (typeof tsRaw !== 'string') continue
      const ts = new Date(tsRaw)
      if (Number.isNaN(ts.getTime())) continue
      if (!inLocalRange(ts, window)) continue
      const session = typeof rec.sessionId === 'string' ? rec.sessionId : ''
      const repo = repoName(typeof rec.cwd === 'string' ? rec.cwd : '')
      const branch = typeof rec.gitBranch === 'string' ? rec.gitBranch : undefined

      if (rec.type === 'user') {
        agg.touchSession(session)
        const text = userText(rec.message)
        if (text) agg.applyPrompt(text)
      } else if (rec.type === 'assistant') {
        const msg = rec.message ?? {}
        const usage = msg.usage ?? {}
        const input = num(usage.input_tokens)
        const cachedInput = num(usage.cache_read_input_tokens)
        const output = num(usage.output_tokens)
        const cacheCreation = num(usage.cache_creation_input_tokens)
        const tokens: Tokens = {
          input, cached_input: cachedInput, output, reasoning_output: 0,
          cache_creation: cacheCreation, total: input + output + cachedInput + cacheCreation,
        }
        const model = typeof msg.model === 'string' ? msg.model : ''
        agg.touchSession(session)
        agg.applyTokens(tokens, model, repo, session, ts, branch)
        agg.markActive(ts)
        const blocks = Array.isArray(msg.content) ? msg.content : []
        for (const b of blocks) {
          if (!b || b.type !== 'tool_use') continue
          const name = b.name
          const inp = b.input ?? {}
          if (name === 'Bash') {
            agg.applyTool('shell', typeof inp.command === 'string' ? inp.command : undefined)
          } else if (name === 'WebFetch' || name === 'WebSearch') {
            agg.applyTool('web')
          } else if (name === 'Edit' || name === 'Write' || name === 'Read' || name === 'NotebookEdit') {
            agg.applyTool('file')
            agg.applyFileChangeExt(repo, extOf(typeof inp.file_path === 'string' ? inp.file_path : ''))
          }
        }
      }
    }
  }
  return agg.assemble(window, 'glob')
}
