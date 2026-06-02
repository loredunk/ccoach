import { type CommandCount, type GitHabitsReport, type ProjectMgmtReport } from './model.js'

// 通用：把计数表转成按 count 降序、command 升序的 top-n（移植 Go topCommands 排序）。
export function topCounts(counts: Record<string, number>, n: number): CommandCount[] {
  const cc: CommandCount[] = Object.entries(counts).map(([command, count]) => ({ command, count }))
  cc.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count
    return a.command < b.command ? -1 : a.command > b.command ? 1 : 0
  })
  return cc.length > n ? cc.slice(0, n) : cc
}

export function buildGitHabits(
  gitCommands: Record<string, number>,
  branchCount: number,
  multiBranchRepos: number,
): GitHabitsReport {
  const commandCount = Object.values(gitCommands).reduce((sum, n) => sum + n, 0)
  const top = topCounts(gitCommands, 10)

  const status = gitCommands.status ?? 0
  const diff = gitCommands.diff ?? 0
  const log = gitCommands.log ?? 0
  const show = gitCommands.show ?? 0
  const commit = gitCommands.commit ?? 0
  const push = gitCommands.push ?? 0

  const reviewSignals: string[] = []
  if (status > 0) reviewSignals.push(`经常检查工作区状态: git status ${status} 次`)
  if (diff > 0) reviewSignals.push(`会查看差异: git diff ${diff} 次`)
  if (log > 0 || show > 0) reviewSignals.push('会读取历史上下文')

  const riskSignals: string[] = []
  if (commit === 0 && (diff > 0 || status > 0)) {
    riskSignals.push('只看到 diff/status 等检查、没有 commit 提交；可能偏向让人类最后提交')
  }
  if (push > 0) riskSignals.push('观察到 push 命令；适合在 AGENTS.md 中写清推送前检查')

  return {
    command_count: commandCount,
    top_subcommands: top.length > 0 ? top : undefined,
    branch_count: branchCount,
    multi_branch_repos: multiBranchRepos,
    review_signals: reviewSignals.length > 0 ? reviewSignals : undefined,
    risk_signals: riskSignals.length > 0 ? riskSignals : undefined,
  }
}

export interface RepoFacts { hasTests?: boolean; hasBuild?: boolean; hasCI?: boolean }

export function buildProjectMgmt(repos: RepoFacts[]): ProjectMgmtReport {
  const reposWithTests = repos.filter(r => r.hasTests === true).length
  const reposWithBuildSystem = repos.filter(r => r.hasBuild === true).length
  const reposWithCI = repos.filter(r => r.hasCI === true).length

  const signals: string[] = []
  if (repos.length > 0) {
    if (reposWithTests === 0) signals.push('活跃项目中没有观察到测试命令')
    else signals.push(`${reposWithTests}/${repos.length} 个活跃项目观察到测试命令`)
    if (reposWithCI > 0) signals.push(`${reposWithCI} 个活跃项目检测到 GitHub Actions`)
  }

  return {
    repos_with_tests: reposWithTests,
    repos_with_build_system: reposWithBuildSystem,
    repos_with_ci: reposWithCI,
    signals: signals.length > 0 ? signals : undefined,
  }
}
