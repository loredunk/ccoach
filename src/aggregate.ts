import {
  type Tokens, type Report, type RepoReport, type UsageReport, type ErrorSignals,
  type ReworkSignals, type EnvironmentSignals, type FileLanguage,
  type BillingReport, type CodexSpecific, type ClaudeSpecific,
  type ScopeBucket, type ProjectScope, type SessionScope,
  type ModelTimeline, type ModelDayCount, type ModelTokenBreakdown,
  REPORT_GLOSSARY, emptyTokens,
} from './model.js'
import { type Window, localYmd } from './window.js'
import { estimateCost, normalizeModel, disjointInputBuckets } from './pricing.js'
import { firstToken, gitSubcommand } from './text.js'
import { buildGitHabits, buildProjectMgmt, topCounts, type RepoFacts } from './habits.js'
import { dominantLanguage, EXT_LANG } from './language.js'
import { newPromptAcc, promptAccUpdate, promptSignals, type PromptAcc } from './prompt-signals.js'

const IDLE_CAP_MS = 5 * 60 * 1000

// --json 输出封顶（防 token 爆炸）：上限给得宽、正常用不受影响，只截断病态规模的长尾。
// 截断的都是按 token 排序后的尾部（低占比项），"钱花在哪"的信号不受影响。
const REPOS_MAX = 50 // repos[] 取 token 前 N
const USAGE_MAX = 15 // sources[]/languages[] 各取前 N
const MT_MODELS_MAX = 10 // models_timeline 取 token 前 N 个模型
const MT_DAYS_MAX = 31 // 每个模型 days[] 只留最近 N 天（first_day/last_day/tokens 仍为真实全量）

interface RepoAgg {
  repo: string
  sessions: Set<string>
  tokens: number
  cost: number
  branches: Set<string>
  fileTypes: Map<string, number>
  hasTests: boolean
  hasBuild: boolean
  hasCI: boolean
}
interface UsageAgg { name: string; tokens: number; sessions: Set<string> }
// per-model per-day 聚合：tokens/cost 供 models_timeline；五类桶供 model_tokens（skill 层计价用）。
interface ModelDayAgg {
  tokens: number; cost: number
  input: number; cached_input: number; output: number; reasoning_output: number; cache_creation: number
}

export type Scope = 'global' | 'project' | 'session'
// 分层 scope 桶（按 repo 或 sessionId）：只攒派生数值/计数 + prompt 数值信号，绝不存 prompt 原文。
interface GroupAcc {
  key: string
  repo: string
  sessions: Set<string>
  tokens: number
  cacheRead: number
  input: number
  toolCalls: number
  cat: Map<string, number>
  git: Map<string, number>
  prompt: PromptAcc
  first: number | null
  last: number | null
}

export type ToolKind = 'shell' | 'web' | 'file' | 'search' | 'mcp' | 'other'

// 平台无关聚合器：适配器把每条事件喂进来，assemble 出统一 Report。
export class Aggregator {
  private platform: string
  private tokens: Tokens = emptyTokens()
  private cost = 0
  private freshInput = 0 // 非缓存输入累计，仅用于统一 cache_hit_rate
  private shellCalls = 0
  private webSearches = 0
  private fileChanges = 0
  private totalCalls = 0
  private shellCommands = new Map<string, number>()
  private gitCommands = new Map<string, number>()
  private sessionIds = new Set<string>()
  private durationMs = 0
  private prevActive: number | null = null
  private byRepo = new Map<string, RepoAgg>()
  private byHour: number[] = new Array<number>(24).fill(0)
  private byHourCount: number[] = new Array<number>(24).fill(0) // 该时段活跃事件数（与 tokens 并列）
  private categories = new Map<string, number>() // 工具类别计数：shell/web/file/search/mcp/other
  private toolByName = new Map<string, number>() // 各工具名调用次数（仅名字，不含参数）
  private langFiles = new Map<string, number>() // 按读写/编辑文件扩展名派生的语言文件数
  private bySource = new Map<string, UsageAgg>()
  private byLanguage = new Map<string, UsageAgg>()
  private byModelDay = new Map<string, Map<string, ModelDayAgg>>()
  private modelsSeen = new Set<string>()
  private missingPrice = new Set<string>()
  private promptAcc: PromptAcc = newPromptAcc()
  // 错误/卡顿信号（只存派生计数与类别，绝不存原始输出）
  private errToolResults = 0
  private errToolErrors = 0
  private errInterrupted = 0
  private errApiErrors = 0
  private errByTool = new Map<string, number>()
  private errByCategory = new Map<string, number>()
  // 返工/改动信号
  private rwEdits = 0
  private rwUserModified = 0
  private rwLinesAdded = 0
  private rwLinesRemoved = 0
  // 技能 / 环境画像
  private skillCounts = new Map<string, number>()
  private versions = new Set<string>()
  private permModes = new Map<string, number>()
  private attachments = 0
  private subagentMsgs = 0
  // 计费维度（仅 Codex 喂入，ADR 0022 D1）：按 plan tier 攒 token + 未分类桶
  private billingByTier = new Map<string, number>()
  private billingUnclassified = 0
  private billingSessionsWithPlan = 0
  private billingSessionsUnclassified = 0
  // Codex 执行画像（仅 Codex 喂入，ADR 0023 D1）：派生计数/枚举标签
  private cxLabels = new Map<string, Map<string, number>>() // field -> (label -> count)
  private cxCompactions = 0
  private cxAbortedTurns = 0
  private cxContextWindow = new Map<number, number>() // 窗口规格 -> 出现次数（取众数）
  private cxGitIdentity = false
  private cxNonDefaultProvider = false // D2a：历史 JSONL 见过 model_provider≠openai（中转弱信号，ADR 0022）
  // Claude 服务端工具计数（ADR 0023 D2）
  private clWebSearchReq = 0
  private clWebFetchReq = 0
  // 分层 scope（默认 global）：!=global 时按桶攒派生信号，每条记录前由适配器 beginRecord 设当前桶。
  private scope: Scope
  private groups = new Map<string, GroupAcc>()
  private curBucket: GroupAcc | null = null

  constructor(platform: string, scope: Scope = 'global') {
    this.platform = platform
    this.scope = scope
  }

  // 适配器在处理每条记录前调用，按 scope 选当前桶（project=repo / session=sessionId）。
  // sidechain/无键记录传空 → curBucket=null（与全局口径一致：不把子代理/无主记录计进桶）。
  beginRecord(repo: string, session: string, ts: Date | null): void {
    this.curBucket = null
    if (this.scope === 'global') return
    let key: string
    if (this.scope === 'session') {
      if (!session) return
      key = session
    } else {
      const r = (repo ?? '').trim()
      if (!r || r === '(unknown)') return
      key = r
    }
    let g = this.groups.get(key)
    if (!g) {
      g = { key, repo: this.scope === 'session' ? '(unknown)' : key, sessions: new Set(), tokens: 0, cacheRead: 0, input: 0, toolCalls: 0, cat: new Map(), git: new Map(), prompt: newPromptAcc(), first: null, last: null }
      this.groups.set(key, g)
    }
    if (this.scope === 'session' && repo && repo !== '(unknown)' && g.repo === '(unknown)') g.repo = repo
    if (this.scope === 'project' && session) g.sessions.add(session)
    if (ts && !Number.isNaN(ts.getTime())) {
      const t = ts.getTime()
      if (g.first === null || t < g.first) g.first = t
      if (g.last === null || t > g.last) g.last = t
    }
    this.curBucket = g
  }

  private repoFor(repo: string): RepoAgg {
    let name = (repo ?? '').trim()
    if (!name) name = '(unknown)'
    let r = this.byRepo.get(name)
    if (!r) {
      r = { repo: name, sessions: new Set(), tokens: 0, cost: 0, branches: new Set(), fileTypes: new Map(), hasTests: false, hasBuild: false, hasCI: false }
      this.byRepo.set(name, r)
    }
    return r
  }

  applyTokens(d: Tokens, model: string, repo: string, session: string, ts: Date, branch?: string): void {
    this.tokens.input += d.input
    this.tokens.cached_input += d.cached_input
    this.tokens.output += d.output
    this.tokens.reasoning_output += d.reasoning_output
    this.tokens.cache_creation += d.cache_creation
    this.tokens.total += d.total
    const { usd, priced } = estimateCost(d, model)
    this.cost += usd
    const nm = normalizeModel(model)
    if (nm) {
      this.modelsSeen.add(nm)
      if (!priced && model.trim() !== '') this.missingPrice.add(nm)
    }
    // 统一 cache_hit_rate 的"非缓存输入"：按"模型"判定（Claude 互斥桶 input 即非缓存；
    // Codex/gpt 的 input 含 cached 需相减）。按模型而非聚合器平台，故 --platform all 的混合聚合也正确。
    this.freshInput += disjointInputBuckets(model)
      ? d.input
      : Math.max(0, d.input - Math.min(d.cached_input, d.input))
    const r = this.repoFor(repo)
    r.tokens += d.total
    r.cost += usd
    if (session) r.sessions.add(session)
    if (branch) r.branches.add(branch)
    if (nm) this.applyModelDay(nm, ts, d, usd)
    this.byHour[ts.getHours()] += d.total
    this.byHourCount[ts.getHours()]++
    if (this.curBucket) {
      this.curBucket.tokens += d.total
      this.curBucket.cacheRead += d.cached_input
      this.curBucket.input += d.input
    }
  }

  private applyModelDay(model: string, ts: Date, d: Tokens, cost: number): void {
    const day = localYmd(ts)
    let days = this.byModelDay.get(model)
    if (!days) { days = new Map(); this.byModelDay.set(model, days) }
    let md = days.get(day)
    if (!md) { md = { tokens: 0, cost: 0, input: 0, cached_input: 0, output: 0, reasoning_output: 0, cache_creation: 0 }; days.set(day, md) }
    md.tokens += d.total
    md.cost += cost
    md.input += d.input
    md.cached_input += d.cached_input
    md.output += d.output
    md.reasoning_output += d.reasoning_output
    md.cache_creation += d.cache_creation
  }

  applyTool(kind: ToolKind, command?: string): void {
    this.totalCalls++
    this.categories.set(kind, (this.categories.get(kind) ?? 0) + 1)
    if (kind === 'shell') {
      this.shellCalls++
      if (command) {
        const ft = firstToken(command)
        if (ft) this.shellCommands.set(ft, (this.shellCommands.get(ft) ?? 0) + 1)
        const gs = gitSubcommand(command)
        if (gs) this.gitCommands.set(gs, (this.gitCommands.get(gs) ?? 0) + 1)
      }
    } else if (kind === 'web') {
      this.webSearches++
    } else if (kind === 'file') {
      this.fileChanges++
    }
    // 'search'/'mcp'/'other'：仅计入 totalCalls + categories（如 Glob/Grep、mcp__*、Codex 通用 call）
    if (this.curBucket) {
      this.curBucket.toolCalls++
      this.curBucket.cat.set(kind, (this.curBucket.cat.get(kind) ?? 0) + 1)
      if (kind === 'shell' && command) {
        const gs = gitSubcommand(command)
        if (gs) this.curBucket.git.set(gs, (this.curBucket.git.get(gs) ?? 0) + 1)
      }
    }
  }

  // 各工具名计数（仅工具名，绝不含命令行/参数；隐私同 skills/environment 标签）。
  applyToolName(name: string): void {
    if (name) this.toolByName.set(name, (this.toolByName.get(name) ?? 0) + 1)
  }

  // 按文件扩展名派生语言的文件数（仅扩展名→语言映射，绝不含路径/文件内容）。
  applyLanguageFile(ext: string): void {
    if (!ext) return
    const lang = EXT_LANG[ext.toLowerCase()] ?? ext.toUpperCase()
    this.langFiles.set(lang, (this.langFiles.get(lang) ?? 0) + 1)
  }

  applyFileChangeExt(repo: string, ext: string): void {
    if (!ext) return
    const r = this.repoFor(repo)
    r.fileTypes.set(ext, (r.fileTypes.get(ext) ?? 0) + 1)
  }

  private applyUsage(groups: Map<string, UsageAgg>, name: string, tokens: Tokens, session: string): void {
    let n = (name ?? '').trim()
    if (!n) n = '(unknown)'
    let g = groups.get(n)
    if (!g) { g = { name: n, tokens: 0, sessions: new Set() }; groups.set(n, g) }
    g.tokens += tokens.total
    if (session) g.sessions.add(session)
  }
  applyUsageSource(name: string, tokens: Tokens, session: string): void { this.applyUsage(this.bySource, name, tokens, session) }
  applyLanguage(name: string, tokens: Tokens, session: string): void { this.applyUsage(this.byLanguage, name, tokens, session) }

  applyRepoFacts(repo: string, facts: { hasTests?: boolean; hasBuild?: boolean; hasCI?: boolean }): void {
    const r = this.repoFor(repo)
    if (facts.hasTests) r.hasTests = true
    if (facts.hasBuild) r.hasBuild = true
    if (facts.hasCI) r.hasCI = true
  }

  applyPrompt(text: string): void {
    promptAccUpdate(this.promptAcc, text)
    if (this.curBucket) promptAccUpdate(this.curBucket.prompt, text)
  }

  // 工具结果（错误/卡顿信号）：category 已由适配器瞬时分类成白名单标签，聚合器只存计数、不见原文。
  applyToolResult(toolName: string, isError: boolean, category: string | null): void {
    this.errToolResults++
    if (isError) {
      this.errToolErrors++
      const tn = toolName || '(unknown)'
      this.errByTool.set(tn, (this.errByTool.get(tn) ?? 0) + 1)
      if (category) this.errByCategory.set(category, (this.errByCategory.get(category) ?? 0) + 1)
    }
  }
  markInterrupted(): void { this.errInterrupted++ }
  applyApiError(): void { this.errApiErrors++ }

  // 返工/改动：linesAdded/Removed 已由适配器从 structuredPatch 数出（只数行、不读 diff 文本）。
  applyEdit(linesAdded: number, linesRemoved: number, userModified: boolean): void {
    this.rwEdits++
    if (userModified) this.rwUserModified++
    this.rwLinesAdded += linesAdded
    this.rwLinesRemoved += linesRemoved
  }
  applySkill(name: string): void { if (name) this.skillCounts.set(name, (this.skillCounts.get(name) ?? 0) + 1) }
  applyVersion(v: string): void { if (v) this.versions.add(v) }
  applyPermissionMode(m: string): void { if (m) this.permModes.set(m, (this.permModes.get(m) ?? 0) + 1) }
  markAttachment(): void { this.attachments++ }
  markSubagentMessage(): void { this.subagentMsgs++ }

  // 计费维度（ADR 0022 D1）：适配器按 rollout 调用一次——传该会话观测到的 plan_type（无则 null）与窗口内 token 总数。
  // 只攒「token 归类」，绝不存配额%/余额/重置（rate_limits 顶层仍恒 null）。plan_type 可被中转伪造，故附固定告警标签。
  applyBillingRollout(planType: string | null, tokens: number): void {
    if (tokens <= 0) return
    if (planType) {
      this.billingByTier.set(planType, (this.billingByTier.get(planType) ?? 0) + tokens)
      this.billingSessionsWithPlan++
    } else {
      this.billingUnclassified += tokens
      this.billingSessionsUnclassified++
    }
  }

  // Codex 执行画像（ADR 0023 D1）：按字段攒白名单枚举标签计数（仅标签，绝不含 developer_instructions 等正文）。
  applyCodexLabel(field: string, label: string): void {
    if (!field || !label) return
    let m = this.cxLabels.get(field)
    if (!m) { m = new Map(); this.cxLabels.set(field, m) }
    m.set(label, (m.get(label) ?? 0) + 1)
  }
  markCodexCompaction(): void { this.cxCompactions++ }
  markCodexAbortedTurn(): void { this.cxAbortedTurns++ }
  applyCodexContextWindow(n: number): void { if (n > 0) this.cxContextWindow.set(n, (this.cxContextWindow.get(n) ?? 0) + 1) }
  markCodexGitIdentity(): void { this.cxGitIdentity = true }
  // D2a（ADR 0022）：rollout 的 session_meta.model_provider 非 openai → 历史曾用自定义/中转 provider（可被命名规避）。
  markCodexNonDefaultProvider(): void { this.cxNonDefaultProvider = true }
  getCodexNonDefaultProvider(): boolean { return this.cxNonDefaultProvider }
  // Claude 服务端工具（ADR 0023 D2）：累计 usage.server_tool_use 的 web 搜索/抓取请求数（纯计数）。
  applyClaudeServerTool(webSearch: number, webFetch: number): void { this.clWebSearchReq += webSearch; this.clWebFetchReq += webFetch }

  touchSession(id: string): void { if (id) this.sessionIds.add(id) }

  markActive(ts: Date): void {
    const t = ts.getTime()
    if (this.prevActive !== null) {
      const gap = t - this.prevActive
      if (gap > 0 && gap <= IDLE_CAP_MS) this.durationMs += gap
    }
    this.prevActive = t
  }
  resetActive(): void { this.prevActive = null } // 线程/文件边界处调用，避免跨会话桥接
  durationSeconds(): number { return Math.floor(this.durationMs / 1000) }

  assemble(window: Window, source: string): Report {
    const cached = this.tokens.cached_input
    const denom = cached + this.freshInput
    const cacheHitRate = denom > 0 ? cached / denom : 0
    const reasoningRatio = this.tokens.output > 0 ? this.tokens.reasoning_output / this.tokens.output : 0

    const repos: RepoReport[] = []
    const repoFacts: RepoFacts[] = []
    const branchSet = new Set<string>()
    let multiBranchRepos = 0
    for (const r of this.byRepo.values()) {
      const branches = [...r.branches].filter(Boolean).sort()
      const rep: RepoReport = { repo: r.repo, sessions: r.sessions.size, tokens: r.tokens, estimated_cost_usd: r.cost }
      if (branches.length) rep.branches = branches
      const lang = dominantLanguage(r.fileTypes)
      if (lang) rep.language = lang
      repos.push(rep)
      repoFacts.push({ hasTests: r.hasTests, hasBuild: r.hasBuild, hasCI: r.hasCI })
      for (const b of r.branches) branchSet.add(r.repo + '@' + b)
      if (r.branches.size > 1) multiBranchRepos++
    }
    repos.sort((a, b) => b.tokens - a.tokens)

    const hours: { hour: number; tokens: number; count: number }[] = []
    for (let h = 0; h < 24; h++) if (this.byHour[h] > 0) hours.push({ hour: h, tokens: this.byHour[h], count: this.byHourCount[h] })

    const shellRecord: Record<string, number> = {}
    for (const [k, v] of this.shellCommands) shellRecord[k] = v
    const gitRecord: Record<string, number> = {}
    for (const [k, v] of this.gitCommands) gitRecord[k] = v

    const errToolRec: Record<string, number> = {}
    for (const [k, v] of this.errByTool) errToolRec[k] = v
    const errCatRec: Record<string, number> = {}
    for (const [k, v] of this.errByCategory) errCatRec[k] = v
    const errorSignals: ErrorSignals = {
      tool_calls: this.errToolResults,
      tool_errors: this.errToolErrors,
      error_rate: this.errToolResults > 0 ? Math.round((this.errToolErrors / this.errToolResults) * 1e4) / 1e4 : 0,
      interrupted: this.errInterrupted,
      api_errors: this.errApiErrors,
    }
    if (this.errByTool.size) errorSignals.by_tool = topCounts(errToolRec, 8)
    if (this.errByCategory.size) errorSignals.by_category = topCounts(errCatRec, 8)

    const reworkSignals: ReworkSignals = {
      edits: this.rwEdits,
      user_modified: this.rwUserModified,
      user_modified_rate: this.rwEdits > 0 ? Math.round((this.rwUserModified / this.rwEdits) * 1e4) / 1e4 : 0,
      lines_added: this.rwLinesAdded,
      lines_removed: this.rwLinesRemoved,
    }
    const skillRec: Record<string, number> = {}
    for (const [k, v] of this.skillCounts) skillRec[k] = v
    const permRec: Record<string, number> = {}
    for (const [k, v] of this.permModes) permRec[k] = v

    const report: Report = {
      generated_for: window.desc,
      timezone: localTimezone(),
      platform: this.platform,
      source,
      sessions: this.sessionIds.size,
      duration_seconds: this.durationSeconds(),
      duration: humanizeDuration(this.durationMs),
      tokens: { ...this.tokens },
      cache_hit_rate: cacheHitRate,
      reasoning_ratio: reasoningRatio,
      estimated_cost_usd: this.cost,
      models: [...this.modelsSeen].sort(),
      tools: {
        shell_calls: this.shellCalls,
        web_searches: this.webSearches,
        file_changes: this.fileChanges,
        total_calls: this.totalCalls,
        top_commands: topCounts(shellRecord, 12),
      },
      repos: repos.slice(0, REPOS_MAX), // 习惯/项目统计仍用全量 repos，仅输出列表封顶
      hours,
      sources: usageReports(this.bySource).slice(0, USAGE_MAX),
      languages: usageReports(this.byLanguage).slice(0, USAGE_MAX),
      git_habits: buildGitHabits(gitRecord, branchSet.size, multiBranchRepos),
      project_management: buildProjectMgmt(repoFacts),
      prompt_signals: promptSignals(this.promptAcc),
      error_signals: errorSignals,
      rework_signals: reworkSignals,
      rate_limits: null,
      glossary: REPORT_GLOSSARY,
    }
    if (this.toolByName.size) {
      const byNameRec: Record<string, number> = {}
      for (const [k, v] of this.toolByName) byNameRec[k] = v
      report.tools.by_name = topCounts(byNameRec, 15).map((c) => ({ name: c.command, count: c.count }))
    }
    if (this.categories.size) {
      const cats: Record<string, number> = {}
      for (const [k, v] of this.categories) cats[k] = v
      report.tools.categories = cats
    }
    if (this.langFiles.size) {
      report.file_languages = [...this.langFiles.entries()]
        .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, USAGE_MAX)
        .map(([name, files]): FileLanguage => ({ name, files }))
    }
    if (this.skillCounts.size) report.skills = topCounts(skillRec, 12)
    if (this.attachments || this.subagentMsgs || this.versions.size || this.permModes.size) {
      const env: EnvironmentSignals = { attachments: this.attachments, subagent_messages: this.subagentMsgs }
      if (this.versions.size) env.claude_versions = [...this.versions].sort()
      if (this.permModes.size) env.permission_modes = topCounts(permRec, 8)
      report.environment = env
    }
    // 计费维度（仅 Codex 有喂入；Claude-only 时三者皆空 → 不输出）。
    if (this.billingByTier.size || this.billingUnclassified || this.billingSessionsWithPlan || this.billingSessionsUnclassified) {
      const byTier: Record<string, number> = {}
      for (const [k, v] of this.billingByTier) byTier[k] = v
      const billing: BillingReport = {
        by_plan_tier: byTier,
        unclassified: this.billingUnclassified,
        sessions_with_plan: this.billingSessionsWithPlan,
        sessions_unclassified: this.billingSessionsUnclassified,
        confidence: 'spoofable-by-relay',
      }
      report.billing = billing
    }
    // Codex 执行画像（仅 Codex 有喂入）。
    if (this.cxLabels.size || this.cxCompactions || this.cxAbortedTurns || this.cxContextWindow.size || this.cxGitIdentity) {
      const cs: CodexSpecific = {
        compactions: this.cxCompactions,
        aborted_turns: this.cxAbortedTurns,
        git_repo_identity: this.cxGitIdentity,
      }
      const asRec = (m: Map<string, number> | undefined): Record<string, number> | undefined => {
        if (!m || !m.size) return undefined
        const r: Record<string, number> = {}
        for (const [k, v] of m) r[k] = v
        return r
      }
      cs.effort = asRec(this.cxLabels.get('effort'))
      cs.approval_policy = asRec(this.cxLabels.get('approval_policy'))
      cs.sandbox = asRec(this.cxLabels.get('sandbox'))
      cs.collaboration_mode = asRec(this.cxLabels.get('collaboration_mode'))
      cs.personality = asRec(this.cxLabels.get('personality'))
      cs.originators = asRec(this.cxLabels.get('originators'))
      if (this.cxContextWindow.size) {
        let best = 0
        let bestC = -1
        for (const [n, c] of this.cxContextWindow) if (c > bestC) { bestC = c; best = n }
        cs.context_window = best
      }
      report.codex_specific = cs
    }
    // Claude 服务端工具计数（ADR 0023 D2）；Codex-only 时为 0 → 不输出。
    if (this.clWebSearchReq || this.clWebFetchReq) {
      const cl: ClaudeSpecific = { web_search_requests: this.clWebSearchReq, web_fetch_requests: this.clWebFetchReq }
      report.claude_specific = cl
    }
    if (this.scope !== 'global') {
      report.scope = this.scope
      const toBucket = (g: GroupAcc): ScopeBucket => {
        const denom = g.cacheRead + g.input
        const cat: Record<string, number> = {}
        for (const [k, v] of g.cat) cat[k] = v
        const gitRec: Record<string, number> = {}
        for (const [k, v] of g.git) gitRec[k] = v
        return {
          tokens: g.tokens,
          tool_calls: g.toolCalls,
          cache_hit_rate: denom > 0 ? Math.round((g.cacheRead / denom) * 1e4) / 1e4 : 0,
          categories: cat,
          git_top: topCounts(gitRec, 6),
          prompt_signals: promptSignals(g.prompt),
        }
      }
      if (this.scope === 'project') {
        report.projects = [...this.groups.values()]
          .map((g): ProjectScope => ({ repo: g.key, sessions: g.sessions.size, ...toBucket(g) }))
          .sort((a, b) => b.tokens - a.tokens)
      } else {
        report.sessions_detail = [...this.groups.values()]
          .map((g): SessionScope => ({
            session_id: g.key,
            repo: g.repo,
            duration_seconds: g.first !== null && g.last !== null ? Math.floor((g.last - g.first) / 1000) : 0,
            ...toBucket(g),
          }))
          .sort((a, b) => b.tokens - a.tokens)
      }
    } else {
      report.scope = 'global'
    }
    if (this.missingPrice.size) report.unpriced_models = [...this.missingPrice].sort()
    if (this.byModelDay.size) {
      report.models_timeline = buildModelsTimeline(this.byModelDay)
      report.model_tokens = buildModelTokens(this.byModelDay, this.missingPrice)
    }
    return report
  }
}

function usageReports(groups: Map<string, UsageAgg>): UsageReport[] {
  const out = [...groups.values()].map((g) => ({ name: g.name, sessions: g.sessions.size, tokens: g.tokens }))
  out.sort((a, b) => (b.tokens !== a.tokens ? b.tokens - a.tokens : a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

function buildModelsTimeline(byModelDay: Map<string, Map<string, ModelDayAgg>>): ModelTimeline[] {
  const out: ModelTimeline[] = []
  for (const [model, days] of byModelDay) {
    const dayKeys = [...days.keys()].sort()
    let tokens = 0
    let cost = 0
    const dayCounts: ModelDayCount[] = []
    for (const d of dayKeys) {
      const da = days.get(d)!
      tokens += da.tokens
      cost += da.cost
      dayCounts.push({ date: d, tokens: da.tokens })
    }
    // days[] 只留最近 N 天封顶；first_day/last_day/tokens 仍为真实全量（时间感知信号不受影响）。
    out.push({ model, first_day: dayKeys[0], last_day: dayKeys[dayKeys.length - 1], tokens, estimated_cost_usd: cost, days: dayCounts.slice(-MT_DAYS_MAX) })
  }
  out.sort((a, b) => (b.tokens !== a.tokens ? b.tokens - a.tokens : a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
  return out.slice(0, MT_MODELS_MAX)
}

// 每模型全窗口 token 分桶（跨天求和）+ 离线 fallback 成本与 priced 标记；按 token 取前 N。
function buildModelTokens(byModelDay: Map<string, Map<string, ModelDayAgg>>, missingPrice: Set<string>): ModelTokenBreakdown[] {
  const out: ModelTokenBreakdown[] = []
  for (const [model, days] of byModelDay) {
    const t = emptyTokens()
    let cost = 0
    for (const md of days.values()) {
      t.input += md.input
      t.cached_input += md.cached_input
      t.output += md.output
      t.reasoning_output += md.reasoning_output
      t.cache_creation += md.cache_creation
      t.total += md.tokens
      cost += md.cost
    }
    out.push({ model, tokens: t, estimated_cost_usd: cost, priced: !missingPrice.has(model) })
  }
  out.sort((a, b) => (b.tokens.total !== a.tokens.total ? b.tokens.total - a.tokens.total : a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
  return out.slice(0, MT_MODELS_MAX)
}

function humanizeDuration(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

function localTimezone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const offsetMin = -new Date().getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hours = Math.trunc(abs / 60)
  const mins = abs % 60
  // 半/刻钟时区（如 UTC+5:30 印度、+5:45 尼泊尔）也要正确显示分钟，不能截断。
  const off = mins ? `${hours}:${String(mins).padStart(2, '0')}` : `${hours}`
  return `${tz} (UTC${sign}${off})`
}
