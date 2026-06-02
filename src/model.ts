// 统一 token 结构：两平台公共字段 + 平台特有可选并存。
// reasoning_output 主要来自 Codex；cache_creation（缓存写入）主要来自 Claude Code。
export interface Tokens {
  input: number
  cached_input: number       // = Claude 的 cache_read；Codex 的 cached_input
  output: number
  reasoning_output: number    // Codex 专有，Claude 为 0
  cache_creation: number      // Claude 专有（缓存写入），Codex 为 0
  total: number
}
export const emptyTokens = (): Tokens => ({
  input: 0, cached_input: 0, output: 0, reasoning_output: 0, cache_creation: 0, total: 0,
})

export interface CommandCount { command: string; count: number }
export interface UsageReport { name: string; sessions: number; tokens: number }
export interface HourReport { hour: number; tokens: number }
export interface RepoReport {
  repo: string; branches?: string[]; sessions: number; tokens: number
  estimated_cost_usd: number; language?: string
}
export interface PromptSignals {
  prompts: number; avg_len: number; structured_ratio: number
  file_ref_ratio: number; constraint_ratio: number; correction_rate: number
}
export interface GitHabitsReport {
  command_count: number; top_subcommands?: CommandCount[]
  branch_count: number; multi_branch_repos: number
  review_signals?: string[]; risk_signals?: string[]
}
export interface ProjectMgmtReport {
  repos_with_tests: number; repos_with_build_system: number; repos_with_ci: number
  signals?: string[]
}
export interface Report {
  generated_for: string
  timezone: string
  platform: string            // "claude-code" | "codex" | "all"
  source: string              // "glob" | "sqlite"
  sessions: number
  duration_seconds: number
  duration: string
  tokens: Tokens
  cache_hit_rate: number
  reasoning_ratio: number
  estimated_cost_usd: number
  models: string[]
  unpriced_models?: string[]
  tools: { shell_calls: number; web_searches: number; file_changes: number; total_calls: number; top_commands: CommandCount[] }
  repos: RepoReport[]
  hours: HourReport[]
  sources: UsageReport[]
  languages: UsageReport[]
  git_habits: GitHabitsReport
  project_management: ProjectMgmtReport
  prompt_signals: PromptSignals
  rate_limits: null           // 恒 null（配额是账号级，CLI 不输出）
  glossary?: Record<string, string>
}

export const REPORT_GLOSSARY: Record<string, string> = {
  _about: '仅本机数据，不跨机器汇总；不含任何账户级配额百分比（CLI 下 rate_limits 恒为 null）。',
  cache_hit_rate: 'cached_input / input，缓存命中率；越高越省钱（重复上下文被缓存复用）。',
  reasoning_ratio: 'reasoning_output / output，推理 token 占输出的比例；偏高常意味任务被反复推理。',
  estimated_cost_usd: '估算成本，仅供参考、不等于实际账单。算法对齐 ccusage（按各 token 类别 × LiteLLM 参考价）。',
  tokens: 'input/cached_input/output/reasoning_output/cache_creation/total；cached_input 是 input 的子集。',
  prompt_signals: '仅由 user prompt 派生的数值信号（长度/结构化率/文件引用率/约束率/返工率），不含任何原文。',
  git_habits: 'git 子命令频次与评审/风险信号（如只 diff/status 不 commit）。',
  project_management: '各仓库是否有测试/构建/CI 信号。',
  duration: '活跃时长（相邻事件间隔 ≤5 分钟才计入），非墙钟跨度。',
}
