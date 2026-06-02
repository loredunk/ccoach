import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Aggregator } from '../aggregate.js'
import { inLocalRange, type Window } from '../window.js'
import { repoName } from '../text.js'
import { type Tokens, type Report } from '../model.js'

// $CODEX_HOME 或 ~/.codex
export function codexHome(): string {
  const env = process.env.CODEX_HOME
  if (env && env.trim()) return env.trim()
  return join(homedir(), '.codex')
}

// 递归收集 home/sessions 下的 rollout-*.jsonl（移植 globRollouts）
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

function num(x: unknown): number { return typeof x === 'number' && isFinite(x) ? x : 0 }

interface CodexTokens { input: number; cached: number; output: number; reasoning: number; total: number }
function fromCodex(o: any): CodexTokens {
  return {
    input: num(o?.input_tokens), cached: num(o?.cached_input_tokens), output: num(o?.output_tokens),
    reasoning: num(o?.reasoning_output_tokens), total: num(o?.total_tokens),
  }
}
// 移植 satSub：逐字段相减、下限 0（对账 ccusage：回退/压缩导致的负增量计 0）
function satSub(a: CodexTokens, b: CodexTokens): CodexTokens {
  const s = (x: number, y: number) => (x < y ? 0 : x - y)
  return { input: s(a.input, b.input), cached: s(a.cached, b.cached), output: s(a.output, b.output), reasoning: s(a.reasoning, b.reasoning), total: s(a.total, b.total) }
}

// 移植 sourceKey
function sourceKey(source: string): string {
  const s = (source ?? '').trim().toLowerCase()
  if (s === '') return '(unknown)'
  if (s.includes('vscode') || s.includes('ide')) return 'plugin'
  if (s.includes('codex-app') || s.includes('desktop') || s === 'app') return 'codex-app'
  if (s.includes('cli') || s.includes('terminal')) return 'cli'
  return s
}

// 命令行抽取（移植 commandLine/stripShellWrapper/normalizedCommandLine）
function commandLine(args: string): string {
  if (!args) return ''
  let a: any
  try { a = JSON.parse(args) } catch { return '' }
  if (typeof a?.cmd === 'string') return a.cmd.trim()
  if (Array.isArray(a?.command)) return a.command.join(' ').trim()
  return ''
}
function stripShellWrapper(fields: string[]): string[] {
  const wrappers = new Set(['bash', 'sh', 'zsh', 'fish', '-lc', '-c', 'env'])
  let f = fields
  while (f.length > 0) {
    const head = f[0].replace(/^["'`]+|["'`]+$/g, '')
    if (wrappers.has(head)) { f = f.slice(1); continue }
    break
  }
  return f
}
function normalizedCommandLine(args: string): string {
  return stripShellWrapper(commandLine(args).split(/\s+/).filter(Boolean)).join(' ')
}

// 子代理：session_meta payload 含 subagent/thread_spawn → 整文件跳过
function isSubagentRollout(lines: string[]): boolean {
  for (const line of lines) {
    const t = line.trim(); if (!t) continue
    let rec: any
    try { rec = JSON.parse(t) } catch { continue }
    if (rec?.type === 'session_meta') {
      const s = JSON.stringify(rec.payload ?? {})
      return s.includes('subagent') || s.includes('thread_spawn')
    }
  }
  return false
}

export function parseCodex(home: string, window: Window): Report {
  const agg = new Aggregator('codex')
  for (const file of globRollouts(home)) {
    let content: string
    try { content = readFileSync(file, 'utf8') } catch { continue }
    const lines = content.split('\n')
    if (isSubagentRollout(lines)) continue
    agg.resetActive()
    let prevTotal: CodexTokens = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 }
    let curModel = ''
    let sessionId = ''
    let repo = '(unknown)'
    let source = '(unknown)'
    let threadTouched = false
    for (const line of lines) {
      const trimmed = line.trim(); if (!trimmed) continue
      let rec: any
      try { rec = JSON.parse(trimmed) } catch { continue }
      const tsRaw = rec?.timestamp
      const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : new Date(NaN)
      const payload = rec?.payload ?? {}
      switch (rec?.type) {
        case 'session_meta': {
          if (!sessionId && typeof payload.id === 'string') sessionId = payload.id
          if (source === '(unknown)' && typeof payload.source === 'string') source = sourceKey(payload.source)
          if (typeof payload.cwd === 'string' && payload.cwd) repo = repoName(payload.cwd)
          break
        }
        case 'turn_context': {
          if (typeof payload.model === 'string' && payload.model) curModel = payload.model
          break
        }
        case 'event_msg': {
          if (payload.type !== 'token_count') break
          const info = payload.info
          if (!info) break
          let delta: CodexTokens
          if (info.last_token_usage) delta = fromCodex(info.last_token_usage)
          else if (info.total_token_usage) delta = satSub(fromCodex(info.total_token_usage), prevTotal)
          else break
          if (info.total_token_usage) prevTotal = fromCodex(info.total_token_usage)
          if (delta.cached > delta.input) delta.cached = delta.input
          if (delta.total <= 0) delta.total = delta.input + delta.output
          if (delta.input <= 0 && delta.cached <= 0 && delta.output <= 0 && delta.reasoning <= 0) break
          if (Number.isNaN(ts.getTime()) || !inLocalRange(ts, window)) break
          const tokens: Tokens = {
            input: delta.input, cached_input: delta.cached, output: delta.output,
            reasoning_output: delta.reasoning, cache_creation: 0, total: delta.total,
          }
          agg.applyTokens(tokens, curModel, repo, sessionId, ts)
          threadTouched = true
          agg.markActive(ts)
          break
        }
        case 'response_item': {
          if (Number.isNaN(ts.getTime()) || !inLocalRange(ts, window)) break
          const t = payload.type
          if (t === 'function_call') {
            const name = payload.name
            if (name === 'exec_command' || name === 'local_shell_call' || name === 'shell') {
              agg.applyTool('shell', normalizedCommandLine(typeof payload.arguments === 'string' ? payload.arguments : ''))
            } else {
              agg.applyTool('other')
            }
          } else if (t === 'local_shell_call') {
            agg.applyTool('shell')
          } else if (t === 'web_search_call') {
            agg.applyTool('web')
          } else if (t === 'custom_tool_call' || t === 'image_generation_call') {
            agg.applyTool('other')
          }
          break
        }
      }
    }
    if (threadTouched) agg.touchSession(sessionId)
  }
  return agg.assemble(window, 'glob')
}
