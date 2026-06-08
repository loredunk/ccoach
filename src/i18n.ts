// CLI 输出层 i18n（ADR 0026）。默认英文（英文市场），保留 `--lang zh`。
// 模块级当前语言：cli.ts 在 resolveWindow/buildReport/emit 之前 setLang()，
// 之后 window.ts / habits.ts / emit/text.ts 调 t()/tf() 即按当前语言出文案。
// 只覆盖"会进 --json 值或人读文本"的串；cac help 文案与 REPORT_GLOSSARY 走英文单语（见 cli.ts / model.ts）。
export type Lang = 'en' | 'zh'

let current: Lang = 'en'
export function setLang(l: string | undefined | null): void {
  current = l === 'zh' ? 'zh' : 'en' // 默认 + 未知 → en
}
export function getLang(): Lang {
  return current
}

type Dict = Record<string, string>

const EN: Dict = {
  // window.ts
  win_since_to: '{since} to {today}',
  win_last_days: 'last {days} days ({from} to {today})',
  // habits.ts — git/项目管理信号短语（进 --json git_habits/project_management）
  hab_review_status: 'Frequently checks workspace status: git status ×{n}',
  hab_review_diff: 'Reviews diffs: git diff ×{n}',
  hab_review_history: 'Reads historical context (git log/show)',
  hab_risk_nocommit: 'Only diff/status checks, no commit — may leave the final commit to the human',
  hab_risk_push: 'push observed — consider documenting pre-push checks in AGENTS.md',
  hab_pm_notests: 'No test commands observed across active projects',
  hab_pm_tests: '{a}/{b} active projects run tests',
  hab_pm_ci: '{n} active projects use GitHub Actions',
  // emit/text.ts — labels
  tx_platform_all: 'All platforms',
  tx_bill_subscription: 'Subscription',
  tx_bill_api_or_relay: 'API/relay',
  tx_bill_unknown: 'Unknown',
  tx_conf_high: 'High',
  tx_conf_medium: 'Medium',
  tx_conf_low: 'Low',
  // emit/text.ts — breakdown
  tx_sessions_n: '{n} sessions',
  tx_more_items: '…and {n} more',
  tx_skills_label: 'Skill: ',
  tx_mcp_servers: 'MCP: ',
  tx_mcp_tools: 'MCP tools: ',
  // emit/text.ts — endpoint / billing / codex profile
  tx_endpoint_header: 'Endpoint / billing mode (account-level snapshot, from local config)',
  tx_ep_official: 'Official ({host})',
  tx_ep_custom: 'Custom/relay',
  tx_ep_unknown: 'Unknown endpoint',
  tx_ep_relay_flag: ' ⚠️ suspected relay',
  tx_ep_plan: ' · plan {tier}',
  tx_ep_line: '{host} · billing {mode} (confidence {conf}){plan}{relay}',
  tx_billing_header: 'Billing split (Codex, by subscription plan tier)',
  tx_unclassified: 'Unclassified',
  tx_unclassified_note: ' (has tokens, no plan_type, ≠ definitely API)',
  tx_plan_type_note: 'ⓘ plan_type comes from the backend response and can be spoofed by relays (confidence: {conf})',
  tx_codex_profile: 'Codex execution profile',
  tx_effort: 'Reasoning effort',
  tx_approval: 'Approval policy',
  tx_sandbox: 'Sandbox',
  tx_collab: 'Collaboration mode',
  tx_client: 'Client',
  tx_compactions: 'context compaction {n}',
  tx_aborted: 'aborted turns {n}',
  tx_ctxwin: 'context window {n}',
  tx_personality: 'personality {names}',
  tx_git_identity: 'git repo identity ✓',
  tx_claude_server: 'Claude server-side tools: web search {s} · web fetch {f}',
  // emit/text.ts — main body
  tx_report_title: 'ccoach Report',
  tx_local_meta: 'Local-only data (source: {source}) · {sessions} sessions · duration {dur}',
  tx_no_records: '(no usage records in this time window)',
  tx_cache_reasoning: 'cache hit rate {chr}% · reasoning/output {rr}%',
  tx_models_suffix: ' · models: {m}',
  tx_est_cost: 'estimated cost {cost} (estimate, reference only{models})',
  tx_unpriced: 'note: models without built-in pricing, excluded from cost: {m}',
  tx_timeline_header: 'model timeline (first→last, local tz):',
  tx_tool_calls: 'tool calls (total {n})',
  tx_tool_breakdown: 'shell {a} · web search {b} · file edits {c}',
  tx_top_commands: 'top commands: ',
  tx_by_source: 'By source',
  tx_by_language: 'By language (estimated from local repo files)',
  tx_errors_header: 'Errors / stalls',
  tx_errors_line: 'tool failures {e}/{n} ({r}%) · interrupted {i} · API errors {a}',
  tx_by_category: 'by category: ',
  tx_by_tool: 'by tool: ',
  tx_rework_header: 'Rework / changes',
  tx_rework_line: 'edits {n} · user-modified {r}% · +{a}/-{d} lines',
  tx_env_label: 'Environment: ',
  tx_env_version: 'version {v}',
  tx_env_perm: 'permissions {p}',
  tx_env_attachments: 'attachments {n}',
  tx_env_subagent: 'subagent messages {n}',
  tx_habits_header: 'Habits',
  tx_habits_git: 'git commands {a} · branch contexts {b} · multi-branch repos {c}',
  tx_pm_prefix: 'project mgmt: {s}',
  tx_by_repo: 'By repo',
  tx_more_repos: '…and {n} more repos (use --by-repo to see all)',
  tx_by_hour: 'By hour (local time)',
  // emit/text.ts — episodes (ADR 0032/0034)
  tx_episodes_header: 'Episodes',
  tx_episodes_line: '{n} episodes · autonomy {a}% · style {s} · spirals {sp}',
  tx_episode_taskmix: 'task mix: ',
  tx_episode_deepest: 'deepest pit: {type} · severity {sev} · {tok} token',
  tx_episodes_note: 'An episode = one instruction you gave → the work the agent did for it; the next instruction starts the next episode.',
  tx_spiral_note: 'Spirals = episodes where the agent got stuck (same file re-edited, repeated errors, no progress). Costly — split the task, give sharper context, or give it a way to self-verify.',
  tx_style_micro: 'micro-manager',
  tx_style_balanced: 'balanced',
  tx_style_free: 'free-range',
}

// zh 值逐字对齐当前硬编码中文，保证 `--lang zh` 复现今日输出。
const ZH: Dict = {
  win_since_to: '{since} 至 {today}',
  win_last_days: '最近 {days} 天 ({from} 至 {today})',
  hab_review_status: '经常检查工作区状态: git status {n} 次',
  hab_review_diff: '会查看差异: git diff {n} 次',
  hab_review_history: '会读取历史上下文',
  hab_risk_nocommit: '只看到 diff/status 等检查、没有 commit 提交；可能偏向让人类最后提交',
  hab_risk_push: '观察到 push 命令；适合在 AGENTS.md 中写清推送前检查',
  hab_pm_notests: '活跃项目中没有观察到测试命令',
  hab_pm_tests: '{a}/{b} 个活跃项目观察到测试命令',
  hab_pm_ci: '{n} 个活跃项目检测到 GitHub Actions',
  tx_platform_all: '全部平台',
  tx_bill_subscription: '订阅',
  tx_bill_api_or_relay: 'API/中转',
  tx_bill_unknown: '未知',
  tx_conf_high: '高',
  tx_conf_medium: '中',
  tx_conf_low: '低',
  tx_sessions_n: '{n} 会话',
  tx_more_items: '…另有 {n} 项',
  tx_skills_label: '技能: ',
  tx_mcp_servers: 'MCP: ',
  tx_mcp_tools: 'MCP 工具: ',
  tx_endpoint_header: '端点 / 计费模式（账户级当前快照，读本机 config）',
  tx_ep_official: '官方({host})',
  tx_ep_custom: '自定义/中转',
  tx_ep_unknown: '未知端点',
  tx_ep_relay_flag: ' ⚠️疑似中转',
  tx_ep_plan: ' · 订阅档 {tier}',
  tx_ep_line: '{host} · 计费 {mode}（置信{conf}）{plan}{relay}',
  tx_billing_header: '计费拆分（Codex，按订阅 plan tier）',
  tx_unclassified: '未分类',
  tx_unclassified_note: '（有token无plan_type，≠确定API）',
  tx_plan_type_note: 'ⓘ plan_type 来自后端响应、可被中转伪造（confidence: {conf}）',
  tx_codex_profile: 'Codex 执行画像',
  tx_effort: '推理强度',
  tx_approval: '审批策略',
  tx_sandbox: '沙箱',
  tx_collab: '协作模式',
  tx_client: '客户端',
  tx_compactions: '上下文压缩 {n}',
  tx_aborted: '放弃回合 {n}',
  tx_ctxwin: '上下文窗口 {n}',
  tx_personality: '人格 {names}',
  tx_git_identity: 'git 仓库身份 ✓',
  tx_claude_server: 'Claude 服务端工具: web 搜索 {s} · web 抓取 {f}',
  tx_report_title: 'ccoach 报告',
  tx_local_meta: '仅本机数据 (来源: {source}) · {sessions} 个会话 · 时长 {dur}',
  tx_no_records: '（该时间窗口内没有使用记录）',
  tx_cache_reasoning: '缓存命中率 {chr}% · reasoning 占 output {rr}%',
  tx_models_suffix: ' · 模型: {m}',
  tx_est_cost: '估算成本 {cost}（估算价，仅供参考{models}）',
  tx_unpriced: '注意: 以下模型无内置价格，未计入成本: {m}',
  tx_timeline_header: '模型时间线 (首次→最后, 本机时区):',
  tx_tool_calls: '工具调用 (共 {n})',
  tx_tool_breakdown: 'shell {a} · web 搜索 {b} · 改文件 {c}',
  tx_top_commands: 'top 命令: ',
  tx_by_source: '按来源',
  tx_by_language: '按语言（根据本机仓库文件估算）',
  tx_errors_header: '错误 / 卡顿',
  tx_errors_line: '工具失败 {e}/{n} ({r}%) · 中断 {i} · API 错误 {a}',
  tx_by_category: '按类别: ',
  tx_by_tool: '按工具: ',
  tx_rework_header: '返工 / 改动',
  tx_rework_line: '编辑 {n} 次 · 手改率 {r}% · +{a}/-{d} 行',
  tx_env_label: '环境: ',
  tx_env_version: '版本 {v}',
  tx_env_perm: '权限 {p}',
  tx_env_attachments: '附件 {n}',
  tx_env_subagent: '子代理消息 {n}',
  tx_habits_header: '习惯',
  tx_habits_git: 'Git 命令 {a} 次 · 分支上下文 {b} 个 · 多分支仓库 {c} 个',
  tx_pm_prefix: '项目管理: {s}',
  tx_by_repo: '按仓库',
  tx_more_repos: '…另有 {n} 个仓库（用 --by-repo 查看全部）',
  tx_by_hour: '按时段 (本机时间)',
  tx_episodes_header: '回合',
  tx_episodes_line: '{n} 个回合 · 自主完成率 {a}% · 干预风格 {s} · 卡壳 {sp}',
  tx_episode_taskmix: '任务构成: ',
  tx_episode_deepest: '最深的坑: {type} · 严重程度 {sev} · {tok} token',
  tx_episodes_note: '一个回合 = 你下的一条指令 → agent 为它做的事；下一条指令开启下一个回合。',
  tx_spiral_note: '卡壳 = agent 卡住、原地空转的回合（反复改同一文件、连环报错、没进展）。很烧 token——拆小任务、给更明确上下文、或给它一个能自我验证的手段。',
  tx_style_micro: '微操型',
  tx_style_balanced: '均衡型',
  tx_style_free: '放养型',
}

const TABLES: Record<Lang, Dict> = { en: EN, zh: ZH }

// 取文案：当前语言 → 缺失回退 en → 回退 key 本身。
export function t(key: string): string {
  const tbl = TABLES[current] ?? EN
  return tbl[key] ?? EN[key] ?? key
}

// 带 {name} 占位插值。
export function tf(key: string, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''))
}
