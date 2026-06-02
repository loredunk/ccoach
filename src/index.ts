import {
  type Report, type RepoReport, type UsageReport, type CommandCount,
  type ModelTimeline, type PromptSignals, type GitHabitsReport, type ProjectMgmtReport,
  emptyTokens, REPORT_GLOSSARY,
} from './model.js'
import { type Window } from './window.js'
import { parseClaudeCode, claudeProjectsDir } from './parsers/claude-code.js'
import { parseCodex, codexHome } from './parsers/codex.js'

export const VERSION = '0.1.0'
export { claudeProjectsDir, codexHome }
export type { Report } from './model.js'

export type Platform = 'claude-code' | 'codex' | 'all'

export interface BuildOpts {
  platform: Platform
  window: Window
  claudeDir?: string
  codexHome?: string
}

// 库导出：按平台跑适配器；'all' 合并两平台到一份 platform:"all" 报告。
export function buildReport(opts: BuildOpts): Report {
  const { platform, window } = opts
  if (platform === 'claude-code') {
    return parseClaudeCode(opts.claudeDir ?? claudeProjectsDir(), window)
  }
  if (platform === 'codex') {
    return parseCodex(opts.codexHome ?? codexHome(), window)
  }
  const claude = parseClaudeCode(opts.claudeDir ?? claudeProjectsDir(), window)
  const codex = parseCodex(opts.codexHome ?? codexHome(), window)
  return mergeReports([claude, codex], window)
}

function humanizeSeconds(s: number): string {
  if (s <= 0) return '0m'
  const totalMin = Math.floor(s / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

function sortCounts(m: Map<string, number>): CommandCount[] {
  return [...m.entries()]
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.command < b.command ? -1 : a.command > b.command ? 1 : 0))
}

function sortUsage(m: Map<string, { sessions: number; tokens: number }>): UsageReport[] {
  return [...m.entries()]
    .map(([name, v]) => ({ name, sessions: v.sessions, tokens: v.tokens }))
    .sort((a, b) => (b.tokens !== a.tokens ? b.tokens - a.tokens : a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

// 合并多平台报告到一份 platform:"all"。tokens 逐字段相加；cache_hit_rate 用各平台
// 的"非缓存输入"重算（Codex input 含缓存需减、Claude input 即非缓存），口径与单平台一致。
export function mergeReports(reports: Report[], window: Window): Report {
  const tokens = emptyTokens()
  let cost = 0
  let freshInput = 0
  let sessions = 0
  let durationSeconds = 0
  const models = new Set<string>()
  const unpriced = new Set<string>()
  let shellCalls = 0, webSearches = 0, fileChanges = 0, totalCalls = 0
  const topCmd = new Map<string, number>()
  const repos = new Map<string, RepoReport>()
  const hours = new Array<number>(24).fill(0)
  const sources = new Map<string, { sessions: number; tokens: number }>()
  const languages = new Map<string, { sessions: number; tokens: number }>()
  let gitCommandCount = 0, branchCount = 0, multiBranchRepos = 0
  const gitSub = new Map<string, number>()
  const reviewSignals: string[] = []
  const riskSignals: string[] = []
  let reposWithTests = 0, reposWithBuild = 0, reposWithCI = 0
  const projSignals: string[] = []
  let pPrompts = 0, pLenW = 0, pStructW = 0, pFileW = 0, pConstrW = 0, pCorrW = 0
  const mtMap = new Map<string, { tokens: number; cost: number; days: Map<string, number> }>()

  for (const r of reports) {
    tokens.input += r.tokens.input
    tokens.cached_input += r.tokens.cached_input
    tokens.output += r.tokens.output
    tokens.reasoning_output += r.tokens.reasoning_output
    tokens.cache_creation += r.tokens.cache_creation
    tokens.total += r.tokens.total
    cost += r.estimated_cost_usd
    freshInput += r.platform === 'codex'
      ? Math.max(0, r.tokens.input - Math.min(r.tokens.cached_input, r.tokens.input))
      : r.tokens.input
    sessions += r.sessions
    durationSeconds += r.duration_seconds
    for (const m of r.models) models.add(m)
    for (const m of r.unpriced_models ?? []) unpriced.add(m)
    shellCalls += r.tools.shell_calls
    webSearches += r.tools.web_searches
    fileChanges += r.tools.file_changes
    totalCalls += r.tools.total_calls
    for (const c of r.tools.top_commands) topCmd.set(c.command, (topCmd.get(c.command) ?? 0) + c.count)
    for (const rp of r.repos) {
      const ex = repos.get(rp.repo)
      if (!ex) {
        const copy: RepoReport = { repo: rp.repo, sessions: rp.sessions, tokens: rp.tokens, estimated_cost_usd: rp.estimated_cost_usd }
        if (rp.branches?.length) copy.branches = [...rp.branches]
        if (rp.language) copy.language = rp.language
        repos.set(rp.repo, copy)
      } else {
        ex.sessions += rp.sessions
        ex.tokens += rp.tokens
        ex.estimated_cost_usd += rp.estimated_cost_usd
        if (rp.branches?.length) ex.branches = [...new Set([...(ex.branches ?? []), ...rp.branches])].sort()
        if (!ex.language && rp.language) ex.language = rp.language
      }
    }
    for (const hr of r.hours) hours[hr.hour] += hr.tokens
    for (const s of r.sources) {
      const e = sources.get(s.name) ?? { sessions: 0, tokens: 0 }
      e.sessions += s.sessions; e.tokens += s.tokens; sources.set(s.name, e)
    }
    for (const l of r.languages) {
      const e = languages.get(l.name) ?? { sessions: 0, tokens: 0 }
      e.sessions += l.sessions; e.tokens += l.tokens; languages.set(l.name, e)
    }
    gitCommandCount += r.git_habits.command_count
    branchCount += r.git_habits.branch_count
    multiBranchRepos += r.git_habits.multi_branch_repos
    for (const sc of r.git_habits.top_subcommands ?? []) gitSub.set(sc.command, (gitSub.get(sc.command) ?? 0) + sc.count)
    for (const s of r.git_habits.review_signals ?? []) if (!reviewSignals.includes(s)) reviewSignals.push(s)
    for (const s of r.git_habits.risk_signals ?? []) if (!riskSignals.includes(s)) riskSignals.push(s)
    reposWithTests += r.project_management.repos_with_tests
    reposWithBuild += r.project_management.repos_with_build_system
    reposWithCI += r.project_management.repos_with_ci
    for (const s of r.project_management.signals ?? []) if (!projSignals.includes(s)) projSignals.push(s)
    const p = r.prompt_signals
    pPrompts += p.prompts
    pLenW += p.avg_len * p.prompts
    pStructW += p.structured_ratio * p.prompts
    pFileW += p.file_ref_ratio * p.prompts
    pConstrW += p.constraint_ratio * p.prompts
    pCorrW += p.correction_rate * p.prompts
    for (const tl of r.models_timeline ?? []) {
      const e = mtMap.get(tl.model) ?? { tokens: 0, cost: 0, days: new Map<string, number>() }
      e.tokens += tl.tokens
      e.cost += tl.estimated_cost_usd
      for (const d of tl.days) e.days.set(d.date, (e.days.get(d.date) ?? 0) + d.tokens)
      mtMap.set(tl.model, e)
    }
  }

  const cacheDenom = tokens.cached_input + freshInput
  const cacheHitRate = cacheDenom > 0 ? tokens.cached_input / cacheDenom : 0
  const reasoningRatio = tokens.output > 0 ? tokens.reasoning_output / tokens.output : 0
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4
  const promptSignals: PromptSignals = pPrompts > 0
    ? {
        prompts: pPrompts,
        avg_len: Math.round((pLenW / pPrompts) * 10) / 10,
        structured_ratio: r4(pStructW / pPrompts),
        file_ref_ratio: r4(pFileW / pPrompts),
        constraint_ratio: r4(pConstrW / pPrompts),
        correction_rate: r4(pCorrW / pPrompts),
      }
    : { prompts: 0, avg_len: 0, structured_ratio: 0, file_ref_ratio: 0, constraint_ratio: 0, correction_rate: 0 }

  const repoList = [...repos.values()].sort((a, b) => b.tokens - a.tokens)
  const hourList: { hour: number; tokens: number }[] = []
  for (let h = 0; h < 24; h++) if (hours[h] > 0) hourList.push({ hour: h, tokens: hours[h] })

  const gitHabits: GitHabitsReport = { command_count: gitCommandCount, branch_count: branchCount, multi_branch_repos: multiBranchRepos }
  const subs = sortCounts(gitSub)
  if (subs.length) gitHabits.top_subcommands = subs.slice(0, 10)
  if (reviewSignals.length) gitHabits.review_signals = reviewSignals
  if (riskSignals.length) gitHabits.risk_signals = riskSignals

  const projectMgmt: ProjectMgmtReport = { repos_with_tests: reposWithTests, repos_with_build_system: reposWithBuild, repos_with_ci: reposWithCI }
  if (projSignals.length) projectMgmt.signals = projSignals

  const report: Report = {
    generated_for: window.desc,
    timezone: reports[0]?.timezone ?? '',
    platform: 'all',
    source: 'glob',
    sessions,
    duration_seconds: durationSeconds,
    duration: humanizeSeconds(durationSeconds),
    tokens,
    cache_hit_rate: cacheHitRate,
    reasoning_ratio: reasoningRatio,
    estimated_cost_usd: cost,
    models: [...models].sort(),
    tools: { shell_calls: shellCalls, web_searches: webSearches, file_changes: fileChanges, total_calls: totalCalls, top_commands: sortCounts(topCmd).slice(0, 12) },
    repos: repoList,
    hours: hourList,
    sources: sortUsage(sources),
    languages: sortUsage(languages),
    git_habits: gitHabits,
    project_management: projectMgmt,
    prompt_signals: promptSignals,
    rate_limits: null,
    glossary: REPORT_GLOSSARY,
  }
  if (unpriced.size) report.unpriced_models = [...unpriced].sort()
  const mtList: ModelTimeline[] = [...mtMap.entries()]
    .map(([model, e]) => {
      const dayKeys = [...e.days.keys()].sort()
      return { model, first_day: dayKeys[0], last_day: dayKeys[dayKeys.length - 1], tokens: e.tokens, estimated_cost_usd: e.cost, days: dayKeys.map((d) => ({ date: d, tokens: e.days.get(d)! })) }
    })
    .sort((a, b) => (b.tokens !== a.tokens ? b.tokens - a.tokens : a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
  if (mtList.length) report.models_timeline = mtList

  return report
}
