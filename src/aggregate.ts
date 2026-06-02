import {
  type Tokens, type Report, type RepoReport, type UsageReport,
  type ModelTimeline, type ModelDayCount, REPORT_GLOSSARY,
} from './model.js'
import { type Window, localYmd } from './window.js'
import { estimateCost, normalizeModel } from './pricing.js'
import { firstToken, gitSubcommand } from './text.js'
import { buildGitHabits, buildProjectMgmt, topCounts, type RepoFacts } from './habits.js'
import { dominantLanguage } from './language.js'
import { newPromptAcc, promptAccUpdate, promptSignals, type PromptAcc } from './prompt-signals.js'

const IDLE_CAP_MS = 5 * 60 * 1000

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
interface ModelDayAgg { tokens: number; cost: number }

export type ToolKind = 'shell' | 'web' | 'file' | 'other'

function emptyTokensLocal(): Tokens {
  return { input: 0, cached_input: 0, output: 0, reasoning_output: 0, cache_creation: 0, total: 0 }
}

// 平台无关聚合器：适配器把每条事件喂进来，assemble 出统一 Report。
export class Aggregator {
  private platform: string
  private tokens: Tokens = emptyTokensLocal()
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
  private bySource = new Map<string, UsageAgg>()
  private byLanguage = new Map<string, UsageAgg>()
  private byModelDay = new Map<string, Map<string, ModelDayAgg>>()
  private modelsSeen = new Set<string>()
  private missingPrice = new Set<string>()
  private promptAcc: PromptAcc = newPromptAcc()

  constructor(platform: string) {
    this.platform = platform
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
    // 统一 cache_hit_rate 的"非缓存输入"：Codex 下 input 含 cached 需相减；Claude 下 input 即非缓存。
    this.freshInput += this.platform === 'codex'
      ? Math.max(0, d.input - Math.min(d.cached_input, d.input))
      : d.input
    const r = this.repoFor(repo)
    r.tokens += d.total
    r.cost += usd
    if (session) r.sessions.add(session)
    if (branch) r.branches.add(branch)
    if (nm) this.applyModelDay(nm, ts, d.total, usd)
    this.byHour[ts.getHours()] += d.total
  }

  private applyModelDay(model: string, ts: Date, tokens: number, cost: number): void {
    const day = localYmd(ts)
    let days = this.byModelDay.get(model)
    if (!days) { days = new Map(); this.byModelDay.set(model, days) }
    let md = days.get(day)
    if (!md) { md = { tokens: 0, cost: 0 }; days.set(day, md) }
    md.tokens += tokens
    md.cost += cost
  }

  applyTool(kind: ToolKind, command?: string): void {
    this.totalCalls++
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
    // 'other'：仅计入 totalCalls（顶部已 ++），用于 Codex 的通用 function_call/custom_tool_call 等
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

  applyPrompt(text: string): void { promptAccUpdate(this.promptAcc, text) }
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

    const hours: { hour: number; tokens: number }[] = []
    for (let h = 0; h < 24; h++) if (this.byHour[h] > 0) hours.push({ hour: h, tokens: this.byHour[h] })

    const shellRecord: Record<string, number> = {}
    for (const [k, v] of this.shellCommands) shellRecord[k] = v
    const gitRecord: Record<string, number> = {}
    for (const [k, v] of this.gitCommands) gitRecord[k] = v

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
      repos,
      hours,
      sources: usageReports(this.bySource),
      languages: usageReports(this.byLanguage),
      git_habits: buildGitHabits(gitRecord, branchSet.size, multiBranchRepos),
      project_management: buildProjectMgmt(repoFacts),
      prompt_signals: promptSignals(this.promptAcc),
      rate_limits: null,
      glossary: REPORT_GLOSSARY,
    }
    if (this.missingPrice.size) report.unpriced_models = [...this.missingPrice].sort()
    if (this.byModelDay.size) report.models_timeline = buildModelsTimeline(this.byModelDay)
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
    out.push({ model, first_day: dayKeys[0], last_day: dayKeys[dayKeys.length - 1], tokens, estimated_cost_usd: cost, days: dayCounts })
  }
  out.sort((a, b) => (b.tokens !== a.tokens ? b.tokens - a.tokens : a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
  return out
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
  const hours = Math.trunc(Math.abs(offsetMin) / 60)
  return `${tz} (UTC${sign}${hours})`
}
