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
export interface NameCount { name: string; count: number }
export interface FileLanguage { name: string; files: number }
export interface UsageReport { name: string; sessions: number; tokens: number }
export interface HourReport { hour: number; tokens: number; count?: number }
export interface ModelDayCount { date: string; tokens: number }
export interface ModelTimeline {
  model: string
  first_day: string          // YYYY-MM-DD（本机时区）
  last_day: string           // YYYY-MM-DD（本机时区）
  tokens: number
  estimated_cost_usd: number
  days: ModelDayCount[]
}
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
// 分层 scope 桶（--scope project/session）：每桶只含派生数值/计数 + prompt 数值信号，绝不含 prompt 原文。
export interface ScopeBucket {
  tokens: number
  tool_calls: number
  cache_hit_rate: number
  categories: Record<string, number>
  git_top: CommandCount[]
  prompt_signals: PromptSignals
}
export interface ProjectScope extends ScopeBucket { repo: string; sessions: number }
export interface SessionScope extends ScopeBucket { session_id: string; repo: string; duration_seconds: number }
// 错误/卡顿信号——只由工具结果派生的数值与白名单类别，绝不含原始 stderr/输出/文件内容（ADR 0016）。
export interface ErrorSignals {
  tool_calls: number            // 观测到的 tool_result 总数（分母）
  tool_errors: number           // is_error 的工具结果数
  error_rate: number            // tool_errors / tool_calls
  interrupted: number           // 被中断/取消的工具调用（Esc / 超时）
  api_errors: number            // API/网络/限流报错（isApiErrorMessage）
  by_tool?: CommandCount[]       // 失败按工具（top）
  by_category?: CommandCount[]   // 失败按白名单类别（git/test/build/permission/network/timeout/not-read/other）
}
// 返工/改动信号——只由 toolUseResult 的 userModified 布尔与 structuredPatch 的行数派生，绝不含 diff 文本（ADR 0017）。
export interface ReworkSignals {
  edits: number              // 文件编辑次数（有 structuredPatch）
  user_modified: number      // 其中用户事后手动改过的次数
  user_modified_rate: number // user_modified / edits
  lines_added: number        // 累计新增行数（仅计数，不含内容）
  lines_removed: number      // 累计删除行数
}
// 环境/使用画像——只由记录元数据派生的非敏感标签/计数（ADR 0017）。
export interface EnvironmentSignals {
  claude_versions?: string[]        // Claude Code 版本
  permission_modes?: CommandCount[] // 权限模式分布（default/auto/…）
  attachments: number               // 附件（图片/粘贴）数
  subagent_messages: number         // 子代理（sidechain）消息数
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
  models_timeline?: ModelTimeline[]
  tools: {
    shell_calls: number; web_searches: number; file_changes: number; total_calls: number
    top_commands: CommandCount[]
    by_name?: NameCount[]              // 各工具被调用次数（Claude：Bash/Edit/Glob/mcp__… 计数）
    categories?: Record<string, number> // 工具类别计数：shell/web/file/search/mcp/other
  }
  repos: RepoReport[]
  hours: HourReport[]
  sources: UsageReport[]
  languages: UsageReport[]
  file_languages?: FileLanguage[]      // 按"读写/编辑文件扩展名"派生的语言文件数（仅扩展名，不含路径）
  git_habits: GitHabitsReport
  project_management: ProjectMgmtReport
  prompt_signals: PromptSignals
  error_signals: ErrorSignals
  rework_signals: ReworkSignals
  skills?: CommandCount[]
  environment?: EnvironmentSignals
  rate_limits: null           // 恒 null（配额是账号级，CLI 不输出）
  scope?: string              // "global" | "project" | "session"
  projects?: ProjectScope[]   // --scope project：每项目跨会话的派生信号桶
  sessions_detail?: SessionScope[] // --scope session：每会话的派生信号桶
  glossary?: Record<string, string>
}

export const REPORT_GLOSSARY: Record<string, string> = {
  _about: '仅本机数据，不跨机器汇总；不含任何账户级配额百分比（CLI 下 rate_limits 恒为 null）。',
  cache_hit_rate: 'cached_input /（cached_input + 非缓存输入）的缓存命中率，两平台口径统一、恒在 0–1（Codex 下 input 含缓存，等价于 cached/input）；越高越省钱（重复上下文被缓存复用）。',
  reasoning_ratio: 'reasoning_output / output，推理 token 占输出的比例；偏高常意味任务被反复推理。',
  estimated_cost_usd: '估算成本，仅供参考、不等于实际账单。算法对齐 ccusage（按各 token 类别 × LiteLLM 参考价）。',
  models_timeline: '每个模型的首/末出现日期（first_day/last_day，本机时区）与每日 token；用于时间感知判断：某旧模型占大头若只因新模型当时还没出现，不应判为浪费。（防 token 爆炸：列表取 token 前 10 个模型，每个 days[] 只列最近 31 天；first_day/last_day/tokens 为真实全量。repos/sources/languages 同样按 token 取前 N。）',
  tokens: 'input/cached_input/output/reasoning_output/cache_creation/total；cached_input 是 input 的子集。',
  prompt_signals: '仅由 user prompt 派生的数值信号（长度/结构化率/文件引用率/约束率/返工率），不含任何原文。',
  error_signals: '工具失败率/中断数/API错误，及失败按工具与按白名单类别（git/test/build/permission/network/timeout/not-read/other）。仅由工具结果派生计数+类别，绝不含原始 stderr/输出/文件内容/命令全行（隐私红线细化，ADR 0016）。',
  rework_signals: '编辑次数、用户事后手改率（userModified）、累计新增/删除行数（structuredPatch）。只派生计数，绝不含 diff 文本（ADR 0017）。',
  skills: '各 skill 被调用的次数（按 attributionSkill），反映 skill 使用画像。',
  environment: 'Claude Code 版本、权限模式分布、附件数、子代理消息数——只由记录元数据派生的非敏感标签/计数（ADR 0017）。',
  git_habits: 'git 子命令频次与评审/风险信号（如只 diff/status 不 commit）。',
  project_management: '各仓库是否有测试/构建/CI 信号。',
  'tools.by_name': '各工具被调用次数（仅工具名计数，如 Bash/Edit/Glob/mcp__…；不含命令行/参数）。',
  'tools.categories': '工具类别计数 shell/web/file/search/mcp/other（纯计数，无内容）。',
  file_languages: '按读写/编辑文件的扩展名派生的语言文件数（仅扩展名映射语言，绝不含路径/文件内容）。',
  'hours.count': '该时段的活跃事件数（与 tokens 并列；用于活跃度热力，不含内容）。',
  scope: '分析层级：global（默认，跨项目聚合）/ project（额外给 projects[]）/ session（额外给 sessions_detail[]）。',
  projects: '每项目跨会话的派生信号桶（tokens/tool_calls/cache_hit_rate/categories/git_top/prompt_signals）；仅 --scope project。',
  sessions_detail: '每会话的派生信号桶（含 session_id/duration_seconds 等）；仅 --scope session；不含 prompt 原文。',
  duration: '活跃时长（相邻事件间隔 ≤5 分钟才计入），非墙钟跨度。',
}
