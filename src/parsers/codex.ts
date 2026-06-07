import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Aggregator, type Scope } from '../aggregate.js'
import { inLocalRange, type Window } from '../window.js'
import { repoName } from '../text.js'
import { classifyError } from '../errors.js'
import { type Tokens, type Report } from '../model.js'

// 从 Codex function_call_output 的 output 解析 exit code 与（瞬时）错误文本。
// 注意：Codex 输出形状为**推断**（无 ~/.codex 真实数据验证），不匹配时静默产出 0。
function codexOutcome(output: unknown): { exitCode: number | null; text: string; interrupted: boolean } {
  if (typeof output !== 'string') return { exitCode: null, text: '', interrupted: false }
  let parsed: any = null
  try { parsed = JSON.parse(output) } catch { /* 纯文本输出 */ }
  if (parsed && typeof parsed === 'object') {
    const meta = parsed.metadata ?? {}
    const ec = meta.exit_code ?? parsed.exit_code
    return {
      exitCode: typeof ec === 'number' ? ec : null,
      text: typeof parsed.output === 'string' ? parsed.output : output,
      interrupted: meta.interrupted === true || parsed.interrupted === true,
    }
  }
  return { exitCode: null, text: output, interrupted: false }
}

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

// 长任务弱信号（experiment 分型；仅瞬时匹配命令、不存命令全行）。
const LONGRUN_RE = /\b(train|fit|pytest|jest|vitest|benchmark|bench|notebook|jupyter)\b/i

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
function addCodex(a: CodexTokens, b: CodexTokens): CodexTokens {
  return { input: a.input + b.input, cached: a.cached + b.cached, output: a.output + b.output, reasoning: a.reasoning + b.reasoning, total: a.total + b.total }
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

// 子代理：session_meta payload 含 subagent/thread_spawn → 整个 rollout 视为 sidechain。
// 注意（与 ccusage 对齐的口径）：子代理的 token/成本**计入用量**（用户真实花费，ccusage 也计入），
// 仅不计入会话数 / 工具 / 活跃时长 / scope 桶等"用户习惯"信号——与 Claude 侧 isSidechain 处理对称。
// 先剔除 cwd 等路径字段再做子串匹配，避免仓库路径里恰好含 'subagent' 而误判整文件。
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

export function parseCodex(home: string, window: Window, scope: Scope = 'global'): Report {
  const agg = new Aggregator('codex', scope)
  feedCodex(agg, home, window)
  return agg.assemble(window, 'glob')
}

// 把 Codex 用量喂进（可共享的）聚合器——--platform all 时与 Claude 喂同一个 agg。
export function feedCodex(agg: Aggregator, home: string, window: Window): void {
  const inWin = (d: Date): boolean => !Number.isNaN(d.getTime()) && inLocalRange(d, window)
  for (const file of globRollouts(home)) {
    let content: string
    try { content = readFileSync(file, 'utf8') } catch { continue }
    const lines = content.split('\n')
    // 子代理 rollout：token 仍计入用量，但工具/会话/活跃时长等习惯信号不计（对齐 Claude sidechain）。
    const sidechain = isSubagentRollout(lines)
    agg.resetActive()
    agg.endEpisodeBoundary() // 收尾上一个 rollout 未关闭的 episode，绝不跨 rollout 桥接（ADR 0032 D4）
    let prevTotal: CodexTokens = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 }
    let curModel = ''
    let sessionId = ''
    let repo = '(unknown)'
    let source = '(unknown)'
    let threadTouched = false
    let originator = ''
    let gitIdentity = false
    let rolloutPlanType: string | null = null // 该会话首个非空 plan_type（计费维度，ADR 0022 D1）
    let billingTokens = 0                       // 该 rollout 窗口内 token 总数（计费归类用）
    const callNames = new Map<string, string>() // call_id -> 工具名（把 *_output 错误归因到工具）
    const callExit = new Map<string, number>()  // call_id -> exit_code（来自 exec_command_end，可靠数字；ADR 0050 D2）
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
          // Codex 执行画像（ADR 0023 D1）：客户端身份 + 是否带 git 仓库身份（仅布尔，绝不存 repository_url 原文）。
          if (typeof payload.originator === 'string' && payload.originator) originator = payload.originator
          const git = payload.git
          if (git && typeof git === 'object' && (git.repository_url || git.commit_hash)) gitIdentity = true
          // D2a 中转弱信号（ADR 0022）：model_provider≠openai → 历史曾用自定义/中转 provider（仅布尔，不存 provider 名）。
          if (typeof payload.model_provider === 'string' && payload.model_provider && payload.model_provider !== 'openai') {
            agg.markCodexNonDefaultProvider()
          }
          break
        }
        case 'compacted': {
          // 上下文压缩（顶层记录类型；另有 event_msg context_compacted 变体，见下）。窗口内、非子代理。
          if (!sidechain && inWin(ts)) agg.markCodexCompaction()
          break
        }
        case 'turn_context': {
          if (typeof payload.model === 'string' && payload.model) curModel = payload.model
          // Codex 执行画像（ADR 0023 D1）：仅窗口内、非子代理（习惯信号）；只取枚举/mode 名，绝不读 developer_instructions。
          if (!sidechain && inWin(ts)) {
            // 回合边界（ADR 0032 D2）：Codex 无用户消息记录，turn_context≈一次用户指令；无 corrected（不读 prompt，ADR 0041）。
            // 口径审计（ADR 0043）：Codex rollout 无 isMeta/命令桩/中断哨兵这类机器注入的 user 记录，turn_context 本身已是真实回合边界，无需对称过滤。
            agg.beginEpisode(sessionId || '(unknown)', repo, ts, false)
            if (typeof payload.effort === 'string') agg.applyCodexLabel('effort', payload.effort)
            if (typeof payload.approval_policy === 'string') agg.applyCodexLabel('approval_policy', payload.approval_policy)
            const sb = payload.sandbox_policy
            if (sb && typeof sb === 'object') {
              const mode = typeof sb.mode === 'string' ? sb.mode : typeof sb.type === 'string' ? sb.type : ''
              if (mode) agg.applyCodexLabel('sandbox', mode)
            }
            const cm = payload.collaboration_mode
            const cmMode = cm && typeof cm === 'object' && typeof cm.mode === 'string' ? cm.mode : typeof cm === 'string' ? cm : ''
            if (cmMode) agg.applyCodexLabel('collaboration_mode', cmMode) // 仅 mode 名；绝不读 cm.settings.developer_instructions
            if (typeof payload.personality === 'string') agg.applyCodexLabel('personality', payload.personality)
          }
          break
        }
        case 'event_msg': {
          // API/网络/流式错误事件（类型推断）：窗口内则计入 api_errors；子代理不计入（习惯信号）。
          if (payload.type === 'error' || payload.type === 'stream_error') {
            if (!sidechain && inWin(ts)) agg.applyApiError()
            break
          }
          // Codex 执行画像（ADR 0023 D1）：上下文压缩 / 主动放弃回合（窗口内、非子代理）。
          if (payload.type === 'context_compacted') { if (!sidechain && inWin(ts)) agg.markCodexCompaction(); break }
          if (payload.type === 'turn_aborted') { if (!sidechain && inWin(ts)) agg.markCodexAbortedTurn(); break }
          // 文件编辑信号（ADR 0050 D1）：patch_apply_end.changes 派生 applyEdit + 文件 fileKey（喂 episode edit_ring / rework）。
          if (payload.type === 'patch_apply_end') {
            const changes = payload.changes
            if (!sidechain && inWin(ts) && changes && typeof changes === 'object') {
              agg.beginRecord(repo, sessionId, ts)
              for (const [path, ch] of Object.entries(changes as Record<string, any>)) {
                const diff = typeof ch?.unified_diff === 'string' ? ch.unified_diff : ''
                let added = 0, removed = 0
                for (const dl of diff.split('\n')) {
                  if (dl.startsWith('+') && !dl.startsWith('+++')) added++
                  else if (dl.startsWith('-') && !dl.startsWith('---')) removed++
                }
                const base = String(path).split(/[\\/]/).pop() || String(path)
                const dot = base.lastIndexOf('.')
                const ext = dot > 0 ? base.slice(dot) : ''
                agg.applyEdit(added, removed, false) // Codex 无 userModified 概念，恒 false
                agg.applyTool('file', undefined, { isEdit: true, fileKey: base, ext })
              }
            }
            break
          }
          // 错误信号（ADR 0050 D2）：exec_command_end 的可靠数字 exit_code 存入 call_id→exit 映射，供 function_call_output 判错。
          if (payload.type === 'exec_command_end') {
            if (typeof payload.call_id === 'string' && typeof payload.exit_code === 'number') callExit.set(payload.call_id, payload.exit_code)
            break
          }
          if (payload.type !== 'token_count') break
          // 计费维度（ADR 0022 D1）：从 rate_limits 取首个非空 plan_type（会话级属性，不限窗口）。
          // 只取标签值，绝不读 used_percent/credits/resets（rate_limits 顶层在报告里仍恒 null）。
          const rl = payload.rate_limits
          if (rl && typeof rl === 'object' && rolloutPlanType === null && typeof rl.plan_type === 'string' && rl.plan_type) {
            rolloutPlanType = rl.plan_type
          }
          const info = payload.info
          if (!info) break
          let delta: CodexTokens
          if (info.last_token_usage) {
            delta = fromCodex(info.last_token_usage)
            // 维持 prevTotal 为运行累计：有 total 用 total，否则按 last 增量推进；
            // 否则之后的 total-only 事件会用过期基线 satSub，把这些 token 重复计入。
            prevTotal = info.total_token_usage ? fromCodex(info.total_token_usage) : addCodex(prevTotal, delta)
          } else if (info.total_token_usage) {
            delta = satSub(fromCodex(info.total_token_usage), prevTotal)
            prevTotal = fromCodex(info.total_token_usage)
          } else {
            break
          }
          if (delta.cached > delta.input) delta.cached = delta.input
          if (delta.total <= 0) delta.total = delta.input + delta.output
          if (delta.input <= 0 && delta.cached <= 0 && delta.output <= 0 && delta.reasoning <= 0) break
          if (Number.isNaN(ts.getTime()) || !inLocalRange(ts, window)) break
          const tokens: Tokens = {
            input: delta.input, cached_input: delta.cached, output: delta.output,
            reasoning_output: delta.reasoning, cache_creation: 0, total: delta.total,
          }
          // 用量/成本计入全部（含子代理 rollout），与 ccusage 一致；子代理 sessionId 传空避免污染会话/scope 桶。
          agg.beginRecord(repo, sidechain ? '' : sessionId, ts) // 分层 scope 桶（project=repo / session=sessionId）
          agg.applyTokens(tokens, curModel, repo, sidechain ? '' : sessionId, ts)
          // 计费归类（ADR 0022 D1）：窗口内 token 累加（含子代理，保 billing 总数 == tokens.total）。
          billingTokens += delta.total
          // Codex 上下文窗口规格（ADR 0023 D1）：非子代理习惯信号。
          if (!sidechain && typeof info.model_context_window === 'number') agg.applyCodexContextWindow(info.model_context_window)
          if (sidechain) {
            agg.markSubagentMessage()
          } else {
            threadTouched = true
            agg.markActive(ts) // 活跃时长只反映主会话；子代理时间戳与主会话交错，计入会虚增
          }
          break
        }
        case 'response_item': {
          // 子代理工具/错误不计入"用户习惯"（对齐 Claude：sidechain 不计工具/错误信号）。
          if (sidechain) break
          if (Number.isNaN(ts.getTime()) || !inLocalRange(ts, window)) break
          agg.beginRecord(repo, sessionId, ts) // 分层 scope 桶
          const t = payload.type
          if (t === 'function_call') {
            const name = payload.name
            if (typeof payload.call_id === 'string') callNames.set(payload.call_id, name)
            if (name === 'exec_command' || name === 'local_shell_call' || name === 'shell') {
              const cmd = normalizedCommandLine(typeof payload.arguments === 'string' ? payload.arguments : '')
              agg.applyTool('shell', cmd, { longRun: LONGRUN_RE.test(cmd) })
            } else {
              agg.applyTool('other')
            }
          } else if (t === 'function_call_output' || t === 'local_shell_call_output' || t === 'custom_tool_call_output') {
            // 错误/卡顿信号：优先用 exec_command_end 的可靠 exit_code（ADR 0050 D2），回退到 output 文本/JSON 推断。
            const { exitCode, text, interrupted } = codexOutcome(payload.output)
            const cid = typeof payload.call_id === 'string' ? payload.call_id : ''
            const ec = callExit.has(cid) ? (callExit.get(cid) as number) : exitCode
            const name = (cid ? callNames.get(cid) : undefined) ?? 'shell'
            const isError = ec !== null && ec !== undefined && ec !== 0
            agg.applyToolResult(name, isError, isError ? classifyError(text) : null)
            if (interrupted) agg.markInterrupted()
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
    // 计费归类（ADR 0022 D1）：每 rollout 一次，窗口内 token 按该会话 plan_type 归桶（含子代理，保 billing 总数==tokens.total）。
    agg.applyBillingRollout(rolloutPlanType, billingTokens)
    if (threadTouched) {
      agg.touchSession(sessionId)
      // Codex 执行画像（ADR 0023 D1）：客户端身份 / git 仓库身份只反映有窗口活动的主会话（非子代理习惯信号）。
      if (originator) agg.applyCodexLabel('originators', originator)
      if (gitIdentity) agg.markCodexGitIdentity()
    }
  }
}
