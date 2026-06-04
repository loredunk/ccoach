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

export const REPORT_GLOSSARY: Record<string, string> = {
  _about: '仅本机数据，不跨机器汇总；不含任何账户级配额百分比（CLI 下 rate_limits 恒为 null）。',
  cache_hit_rate: 'cached_input /（cached_input + 非缓存输入）的缓存命中率，两平台口径统一、恒在 0–1（Codex 下 input 含缓存，等价于 cached/input）；越高越省钱（重复上下文被缓存复用）。',
  reasoning_ratio: 'reasoning_output / output，推理 token 占输出的比例；偏高常意味任务被反复推理。',
  estimated_cost_usd: '离线 best-effort fallback 估算，仅供参考、不等于实际账单。权威成本由 skill 层联网查询各模型官方定价后计算覆盖；本字段仅在未联网查价时作兜底（用内置离线 fallback 价表）。',
  models_timeline: '每个模型的首/末出现日期（first_day/last_day，本机时区）与每日 token；用于时间感知判断：某旧模型占大头若只因新模型当时还没出现，不应判为浪费。（防 token 爆炸：列表取 token 前 10 个模型，每个 days[] 只列最近 31 天；first_day/last_day/tokens 为真实全量。repos/sources/languages 同样按 token 取前 N。）',
  model_tokens: '每个模型的全窗口 token 分桶（input/cached_input/output/reasoning_output/cache_creation/total）+ 离线 fallback 估算成本与 priced 标记。供 skill 层按实际模型名联网查官方定价后自行计价（Claude 互斥桶 vs Codex cached⊆input 公式不同，必须分桶）。按 token 取前 10 个模型。',
  tokens: 'input/cached_input/output/reasoning_output/cache_creation/total。注意两平台 input 口径不同：Claude 的 input 仅"非缓存新输入"，cached_input(cache_read) 与 cache_creation 是与之并列的独立互斥桶（input+cached_input+cache_creation+output=total）；Codex 的 input 已含缓存（cached_input ⊆ input）、reasoning_output ⊆ output（input+output=total）。total 两平台都是全部 token 之和、可直接相比；展示"输入侧总量"时 Claude 需把 cached_input+cache_creation 计入（见 skill 渲染 ADR 0024）。',
  prompt_signals: '仅由 user prompt 派生的数值信号（长度/结构化率/文件引用率/约束率/返工率），不含任何原文。',
  error_signals: '工具失败率/中断数/API错误，及失败按工具与按白名单类别（git/test/build/permission/network/timeout/not-read/other）。仅由工具结果派生计数+类别，绝不含原始 stderr/输出/文件内容/命令全行（隐私红线细化，ADR 0016）。',
  rework_signals: '编辑次数、用户事后手改率（userModified）、累计新增/删除行数（structuredPatch）。只派生计数，绝不含 diff 文本（ADR 0017）。',
  skills: '各 skill 被调用的次数（按 attributionSkill），反映 skill 使用画像。',
  environment: 'Claude Code 版本、权限模式分布、附件数、子代理消息数——只由记录元数据派生的非敏感标签/计数（ADR 0017）。',
  billing: '仅 Codex：按订阅 plan tier(plus/pro/…) 拆 token + 未分类桶（有 token 无 plan_type，≠确定API）。只从 rate_limits 的存在性+plan_type 标签派生 token 归类，不输出任何配额%/余额/重置时间（rate_limits 顶层仍恒 null）。confidence=spoofable-by-relay：plan_type 来自后端响应、可被中转透传或伪造，不能据此断言"官方订阅"（ADR 0022 D1）。',
  codex_specific: '仅 Codex 的执行画像：effort/审批策略/沙箱/协作模式/personality/客户端身份(originators) 分布 + 压缩(compactions)/放弃回合(aborted_turns)/上下文窗口(context_window)/git 仓库身份(布尔)。全为派生计数/白名单枚举标签，collaboration_mode 仅取 mode 名、绝不读 developer_instructions 正文（ADR 0023 D1 / 0017）。',
  claude_specific: '仅 Claude 的服务端工具计数：web 搜索/抓取请求数（usage.server_tool_use）。Claude 多数差异化信号已在 environment/skills/rework 覆盖，此处仅补 server_tool_use（ADR 0023 D2）。',
  endpoints: '端点/计费模式检测（账户级当前快照，读本机 config）：endpoint(official|custom|unknown)+relay_suspected+auth_mode+subscription_type+billing_mode(subscription|api_or_relay|unknown)+confidence。只派生布尔/host 白名单/枚举标签，绝不存 key/token/完整 base_url URL（custom 不回显中转域名）。与 billing 块（历史 token 拆分）正交：这是"现在怎么计费/是否走中转"。endpoint=custom 时 plan_type 标签可能被中转伪造，billing_mode 保守判 api_or_relay（ADR 0022 D2/D3/D4）。',
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
