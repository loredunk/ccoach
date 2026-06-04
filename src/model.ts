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
// 每个模型的全窗口 token 分桶——供 skill 层联网查官方价后自行计价（计价公式按模型族不同：
// Claude 互斥桶 vs Codex cached⊆input，需要分桶才能算）。estimated_cost_usd 仅离线 fallback。
export interface ModelTokenBreakdown {
  model: string
  tokens: Tokens             // 全窗口 input/cached_input/output/reasoning_output/cache_creation/total
  estimated_cost_usd: number // 离线 fallback 估算（仅在 skill 未联网查价时用）
  priced: boolean            // 离线价表是否命中（与 unpriced_models 互补）
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
// 计费维度（仅 Codex 填，ADR 0022 D1）：按订阅 plan tier 拆 token。
// 只从 rate_limits 的「存在性 + plan_type 标签值」派生 token 归类，绝不输出配额百分比/余额/重置时间
// （rate_limits 顶层字段仍恒 null，CLAUDE.md 红线不放宽）。plan_type 可被中转伪造，故附固定告警标签。
export interface BillingReport {
  by_plan_tier: Record<string, number> // plan_type 标签(plus/pro/…) -> token 数
  unclassified: number                 // 有 token 但整段会话未观测到 plan_type 的 token 数（≠ 确定 API）
  sessions_with_plan: number           // 观测到 plan_type 的 rollout 数
  sessions_unclassified: number         // 有 token 但无 plan_type 的 rollout 数
  confidence: string                   // 固定标签 'spoofable-by-relay'：plan_type 来自后端响应、可被中转透传/伪造
}
// 平台特色：Codex 执行画像（仅 Codex 填，ADR 0023 D1）。全部为派生计数/白名单枚举标签（ADR 0017）；
// collaboration_mode 仅取 mode 名，绝不读其 payload 内的 developer_instructions 正文。
export interface CodexSpecific {
  effort?: Record<string, number>             // turn_context.effort（high/medium/…）分布
  approval_policy?: Record<string, number>    // 审批策略（on-request/never/untrusted）分布
  sandbox?: Record<string, number>            // 沙箱档（workspace-write/…）分布，仅 mode 名
  collaboration_mode?: Record<string, number> // 协作模式（default/plan）分布，仅 mode 名
  personality?: Record<string, number>        // 人格档（pragmatic/…）分布
  originators?: Record<string, number>        // 客户端身份（codex_cli_rs/codex_vscode/codex-tui/codex_exec）分布
  compactions: number                         // 上下文压缩事件数
  aborted_turns: number                       // turn_aborted（主动放弃回合）数
  context_window?: number                     // model_context_window 众数（上下文窗口规格）
  git_repo_identity: boolean                  // 是否带 git 仓库身份（repository_url/commit_hash），仅布尔不存 URL
}
// 端点/计费模式检测（ADR 0022 D2/D3/D4）：账户级**当前快照**，读本机 config 派生白名单标签。
// 隐私：只读、只派生布尔/host 白名单/枚举标签，**绝不存或输出 key/token/完整 base_url URL**。
// 与历史 token 拆分（billing 块）不同——这是「现在这台机器怎么计费/是否走中转」，非历史归属。
export interface EndpointDetection {
  platform: string                                    // 'codex' | 'claude-code'
  endpoint: 'official' | 'custom' | 'unknown'         // 活跃端点是否官方域名
  official_host?: string                              // 仅 official 时给（公开域名，如 api.anthropic.com）；custom 绝不回显中转域名
  relay_suspected: boolean                            // endpoint=custom 即 true（中转/镜像/自建网关）
  auth_mode?: string                                  // 白名单标签：codex chatgpt|apikey；claude oauth-subscription|auth-token|api-key
  subscription_type?: string                         // claude 账户订阅档（max/pro/…）标签（D4，账户级当前快照）
  non_default_provider?: boolean                      // codex：历史 JSONL 见过 model_provider≠openai（D2a，可被命名规避，低置信）
  billing_mode: 'subscription' | 'api_or_relay' | 'unknown' // D3 综合判定；有 plan_type 但端点非官方 → api_or_relay（保守）
  confidence: 'high' | 'medium' | 'low'
  basis: string[]                                     // 判定依据（仅安全白名单标签，如 auth_mode:chatgpt / base_url:official）
}
// 平台特色：Claude 独有补充（ADR 0023 D2）。Claude 多数差异化信号已在 environment/skills/rework 等覆盖，
// 此处只补尚未采的 server_tool_use 计数（服务端 web 搜索/抓取）。仅纯计数。
export interface ClaudeSpecific {
  web_search_requests: number  // usage.server_tool_use.web_search_requests 累计
  web_fetch_requests: number   // usage.server_tool_use.web_fetch_requests 累计
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
  model_tokens?: ModelTokenBreakdown[] // 每模型全窗口 token 分桶；供 skill 层用联网官方价计价
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
  billing?: BillingReport      // 计费维度（仅 Codex 填，ADR 0022 D1）：按订阅 plan tier 拆 token
  codex_specific?: CodexSpecific // 平台特色：Codex 执行画像（ADR 0023 D1）
  claude_specific?: ClaudeSpecific // 平台特色：Claude 服务端工具计数（ADR 0023 D2）
  endpoints?: EndpointDetection[] // 端点/计费模式检测（ADR 0022 D2/D3/D4）：账户级当前快照，读 config 派生白名单标签
  rate_limits: null           // 恒 null（配额是账号级，CLI 不输出）
  scope?: string              // "global" | "project" | "session"
  projects?: ProjectScope[]   // --scope project：每项目跨会话的派生信号桶
  sessions_detail?: SessionScope[] // --scope session：每会话的派生信号桶
  glossary?: Record<string, string>
}

// Self-describing glossary for --json consumers (agents). English-only by design (ADR 0026):
// it documents the contract for agents, is not shown to end users, and dual-maintaining it is not
// worth it. The report's user-facing language is set by --lang (see src/i18n.ts) / the skill renderer.
export const REPORT_GLOSSARY: Record<string, string> = {
  _about: 'Local-machine data only, never aggregated across machines; contains no account-level quota percentages (rate_limits is always null in the CLI).',
  cache_hit_rate: 'cached_input / (cached_input + non-cached input) — cache hit rate, unified across platforms and always 0–1 (for Codex, input includes cache, so this equals cached/input); higher saves money (repeated context served from cache).',
  reasoning_ratio: 'reasoning_output / output — share of output that is reasoning tokens; a high value often means the task was reasoned over repeatedly.',
  estimated_cost_usd: 'Best-effort offline fallback estimate, for reference only — not an actual bill. The authoritative cost is computed by the skill layer after looking up each model official price online; this field is only a fallback when no online pricing was queried (uses the built-in offline price table).',
  models_timeline: 'Each model first/last appearance date (first_day/last_day, local tz) plus per-day tokens; used for time-aware judgment: an older model dominating only because the newer one did not yet exist is not waste. (Token-explosion guard: top 10 models by token, each days[] lists only the last 31 days; first_day/last_day/tokens are the true full totals. repos/sources/languages are likewise top-N by token.)',
  model_tokens: 'Per-model full-window token buckets (input/cached_input/output/reasoning_output/cache_creation/total) plus an offline fallback cost estimate and a priced flag. For the skill layer to price each model after looking up its official price online (Claude disjoint buckets vs Codex cached⊆input use different formulas, so buckets are required). Top 10 models by token.',
  tokens: 'input/cached_input/output/reasoning_output/cache_creation/total. Note the two platforms define input differently: for Claude, input is only "fresh non-cached input"; cached_input (cache_read) and cache_creation are separate, mutually-exclusive buckets (input+cached_input+cache_creation+output=total). For Codex, input already includes cache (cached_input ⊆ input) and reasoning_output ⊆ output (input+output=total). total is the sum of all tokens on both platforms and is directly comparable; to show "total input-side" for Claude, add cached_input+cache_creation (see skill rendering, ADR 0024).',
  prompt_signals: 'Numeric signals derived only from user prompts (length / structured ratio / file-reference ratio / constraint ratio / correction rate); contains no raw text.',
  error_signals: 'Tool failure rate / interruptions / API errors, plus failures by tool and by whitelisted category (git/test/build/permission/network/timeout/not-read/other). Derived only as counts + categories from tool results, never raw stderr/output/file contents/full command lines (privacy red line, ADR 0016).',
  rework_signals: 'Edit count, post-hoc user-modified rate (userModified), cumulative added/removed line counts (structuredPatch). Counts only, never diff text (ADR 0017).',
  skills: 'Times each skill was invoked (by attributionSkill), reflecting the skill usage profile.',
  environment: 'Claude Code versions, permission-mode distribution, attachment count, subagent message count — non-sensitive labels/counts derived only from record metadata (ADR 0017).',
  billing: 'Codex only: token split by subscription plan tier (plus/pro/…) plus an unclassified bucket (has tokens but no plan_type, ≠ definitely API). Derived only from the presence of rate_limits + the plan_type label; emits no quota percentage, remaining-credit, or reset-time fields (top-level rate_limits stays null). confidence=spoofable-by-relay: plan_type comes from the backend response and can be passed through or spoofed by relays, so it cannot prove an "official subscription" (ADR 0022 D1).',
  codex_specific: 'Codex-only execution profile: effort / approval policy / sandbox / collaboration mode / personality / client identity (originators) distributions, plus compactions / aborted_turns / context_window / git repo identity (boolean). All derived counts/whitelisted enum labels; collaboration_mode takes only the mode name, never reading developer_instructions (ADR 0023 D1 / 0017).',
  claude_specific: 'Claude-only server-side tool counts: web search/fetch request counts (usage.server_tool_use). Most Claude-specific signals are already covered by environment/skills/rework; this only adds server_tool_use (ADR 0023 D2).',
  endpoints: 'Endpoint/billing-mode detection (account-level current snapshot, from local config): endpoint(official|custom|unknown)+relay_suspected+auth_mode+subscription_type+billing_mode(subscription|api_or_relay|unknown)+confidence. Derives only booleans/host whitelist/enum labels, never storing key/token/full base_url URL (custom does not echo the relay domain). Orthogonal to the billing block (historical token split): this is "how billing works now / whether a relay is used". When endpoint=custom the plan_type label may be spoofed by a relay, so billing_mode is conservatively judged api_or_relay (ADR 0022 D2/D3/D4).',
  git_habits: 'git subcommand frequency plus review/risk signals (e.g. only diff/status, never commit).',
  project_management: 'Whether each repo shows test/build/CI signals.',
  'tools.by_name': 'Times each tool was invoked (tool-name counts only, e.g. Bash/Edit/Glob/mcp__…; no command lines/arguments).',
  'tools.categories': 'Tool-category counts shell/web/file/search/mcp/other (counts only, no content).',
  file_languages: 'Language file counts derived from read/edited file extensions (extension→language mapping only, never paths/file contents).',
  'hours.count': 'Active-event count for the hour (alongside tokens; for activity heat, no content).',
  scope: 'Analysis level: global (default, cross-project aggregate) / project (adds projects[]) / session (adds sessions_detail[]).',
  projects: 'Per-project cross-session derived-signal buckets (tokens/tool_calls/cache_hit_rate/categories/git_top/prompt_signals); only with --scope project.',
  sessions_detail: 'Per-session derived-signal buckets (incl. session_id/duration_seconds); only with --scope session; contains no raw prompt text.',
  duration: 'Active duration (counted only when adjacent events are ≤5 minutes apart), not wall-clock span.',
}
