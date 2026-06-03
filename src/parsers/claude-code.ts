import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Aggregator, type Scope } from '../aggregate.js'
import { inLocalRange, type Window } from '../window.js'
import { repoName, extOf } from '../text.js'
import { classifyError } from '../errors.js'
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

export function parseClaudeCode(dir: string, window: Window, scope: Scope = 'global'): Report {
  const agg = new Aggregator('claude-code', scope)
  feedClaudeCode(agg, dir, window)
  return agg.assemble(window, 'glob')
}

// 把 Claude Code 用量喂进（可共享的）聚合器——--platform all 时两平台喂同一个 agg，
// 避免合并两份已成形报告时的重复截断/重复计数。
export function feedClaudeCode(agg: Aggregator, dir: string, window: Window): void {
  // 跨文件去重（对齐 ccusage）：会话 resume/fork 会把同一条消息复制进多个 JSONL，不去重会把
  // 用量成倍高估。assistant 用 message.id:requestId、其它用 uuid 作稳定标识。
  const seen = new Set<string>()
  const files = walkJsonl(dir)
  // 预扫描建 tool_use_id -> 工具名 全量表：resume/fork 可能把 user 的 tool_result 排到其
  // assistant tool_use 之前（文件按 uuid 排序、非时间序），单遍按序查会查不到，故先建全量映射。
  const toolUseNames = new Map<string, string>()
  for (const file of files) {
    let pre: string
    try { pre = readFileSync(file, 'utf8') } catch { continue }
    for (const line of pre.split('\n')) {
      const t = line.trim()
      if (!t) continue
      let rec: any
      try { rec = JSON.parse(t) } catch { continue }
      if (rec?.type !== 'assistant') continue
      const blocks = Array.isArray(rec.message?.content) ? rec.message.content : []
      for (const b of blocks) if (b && b.type === 'tool_use' && typeof b.id === 'string') toolUseNames.set(b.id, b.name)
    }
  }
  for (const file of files) {
    agg.resetActive() // 每个文件独立计活跃时长，避免跨文件桥接
    let content: string
    try { content = readFileSync(file, 'utf8') } catch { continue }
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let rec: any
      try { rec = JSON.parse(trimmed) } catch { continue }

      // 先过滤窗口，再去重——若先去重，窗口外的复制条目会把 key 抢先放进 seen，
      // 导致另一文件里窗口内的同一消息被误删、用量丢失。
      const tsRaw = rec?.timestamp
      if (typeof tsRaw !== 'string') continue
      const ts = new Date(tsRaw)
      if (Number.isNaN(ts.getTime())) continue
      if (!inLocalRange(ts, window)) continue

      const msgId = rec?.message?.id
      const dedupKey =
        typeof msgId === 'string' && msgId !== ''
          ? `${msgId}:${rec?.requestId ?? ''}`
          : typeof rec?.uuid === 'string' && rec.uuid !== ''
            ? rec.uuid
            : null
      if (dedupKey !== null) {
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)
      }

      const sidechain = rec?.isSidechain === true
      const session = typeof rec.sessionId === 'string' ? rec.sessionId : ''
      const repo = repoName(typeof rec.cwd === 'string' ? rec.cwd : '')
      const branch = typeof rec.gitBranch === 'string' ? rec.gitBranch : undefined

      // API/网络/限流报错：仅主会话计入（错误信号反映用户的工作环境）。
      if (rec.isApiErrorMessage === true && !sidechain) agg.applyApiError()

      // 环境 / 技能 / 子代理画像（只派生非敏感元数据：版本/权限模式/skill名/附件/子代理消息）。
      if (typeof rec.version === 'string') agg.applyVersion(rec.version)
      if (typeof rec.permissionMode === 'string') agg.applyPermissionMode(rec.permissionMode)
      if (typeof rec.attributionSkill === 'string') agg.applySkill(rec.attributionSkill)
      if (rec.type === 'attachment') agg.markAttachment()
      if (sidechain) agg.markSubagentMessage()

      // 分层 scope：设当前桶（project=repo / session=sessionId）；sidechain 不进会话桶（与会话计数口径一致）。
      agg.beginRecord(repo, sidechain ? '' : session, ts)

      if (rec.type === 'user') {
        // prompt 信号只反映"人类本人"的 prompt：sidechain（子代理）user 文本是 agent 生成的
        // 任务描述、非人类输入，排除。
        if (!sidechain) {
          agg.touchSession(session)
          const text = userText(rec.message)
          if (text) agg.applyPrompt(text)
          // 错误/卡顿信号：扫描 tool_result（is_error）+ toolUseResult.interrupted。
          // 隐私：错误文本只**瞬时**分类成白名单类别标签，绝不存原始 stderr/输出。
          const blocks = Array.isArray(rec.message?.content) ? rec.message.content : []
          for (const b of blocks) {
            if (!b || b.type !== 'tool_result') continue
            const toolName =
              (typeof b.tool_use_id === 'string' ? toolUseNames.get(b.tool_use_id) : undefined) ?? '(unknown)'
            const isError = b.is_error === true
            let category: string | null = null
            if (isError) {
              const txt =
                typeof b.content === 'string'
                  ? b.content
                  : Array.isArray(b.content)
                    ? b.content.map((c: any) => (c && typeof c.text === 'string' ? c.text : '')).join(' ')
                    : ''
              category = classifyError(txt)
            }
            agg.applyToolResult(toolName, isError, category)
          }
          const tur = rec.toolUseResult
          if (tur && typeof tur === 'object') {
            if (tur.interrupted === true) agg.markInterrupted()
            // 返工/改动：从 structuredPatch 只数 +/- 行数（绝不读 diff 文本内容），并取 userModified 布尔。
            if (Array.isArray(tur.structuredPatch)) {
              let added = 0
              let removed = 0
              for (const h of tur.structuredPatch) {
                if (h && Array.isArray(h.lines)) {
                  for (const l of h.lines) {
                    if (typeof l === 'string') {
                      if (l.startsWith('+')) added++
                      else if (l.startsWith('-')) removed++
                    }
                  }
                }
              }
              agg.applyEdit(added, removed, tur.userModified === true)
            }
          }
        }
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
        // 用量/成本计入全部（含 sidechain 子代理），与 ccusage 一致；sidechain 不计入会话数，
        // 故 session 传空避免污染按仓库会话数。
        agg.applyTokens(tokens, model, repo, sidechain ? '' : session, ts, branch)
        if (!sidechain) {
          // 工具/git/会话/活跃时长只反映主会话（用户驱动）：子代理内部工具不计入"用户习惯"，
          // 也避免泄露子代理命令；且 sidechain 时间戳与主会话交错，markActive 计入会虚增活跃时长。
          agg.touchSession(session)
          agg.markActive(ts)
          const blocks = Array.isArray(msg.content) ? msg.content : []
          for (const b of blocks) {
            if (!b || b.type !== 'tool_use') continue
            const name = typeof b.name === 'string' ? b.name : ''
            const inp = b.input ?? {}
            // 全量计数 + 类别 + 工具名（仅名字，不含参数）；修正旧版只数 shell/web/file 的漏计。
            agg.applyToolName(name)
            if (name === 'Bash') {
              agg.applyTool('shell', typeof inp.command === 'string' ? inp.command : undefined)
            } else if (name === 'WebFetch' || name === 'WebSearch') {
              agg.applyTool('web')
            } else if (name === 'Edit' || name === 'Write' || name === 'Read' || name === 'NotebookEdit') {
              agg.applyTool('file')
              const ext = extOf(typeof inp.file_path === 'string' ? inp.file_path : '')
              agg.applyFileChangeExt(repo, ext)
              agg.applyLanguageFile(ext)
            } else if (name === 'Glob' || name === 'Grep' || name === 'ToolSearch') {
              agg.applyTool('search')
            } else if (name.startsWith('mcp__')) {
              agg.applyTool('mcp')
            } else {
              agg.applyTool('other')
            }
          }
        }
      }
    }
  }
}
