// Codex 特性采用信号（ADR 0057）：从 $CODEX_HOME 本机文件/索引库派生「哪些原生特性还没被用上」。
// 与 Claude 侧 ADR 0056（~/.claude.json 计数器）对称，但证据源完全不同：
//   config.toml（配置意图）/ rules/default.rules（智能审批已接受规则数）/ skills/（装机清单计数）/
//   state_5.sqlite（threads 索引 + thread_spawn_edges 子代理边 + stage1_outputs 记忆产出，只 COUNT）/
//   sqlite/codex-dev.db（automations / inbox 计数）/ .codex-global-state.json（Codex App 自报估算）/
//   version.json / ambient-suggestions / memories/ / AGENTS.md（存在性+字节数）。
// 隐私（ADR 0016/0017 同一原则）：只产出布尔、纯计数、白名单枚举标签；trusted 项目路径仅瞬时用于
// 计数与 broad_trust 布尔判定、绝不存储；规则/命令全行、记忆正文（stage1_outputs.raw_memory /
// rollout_summary 为 assistant 蒸馏内容，红线）、prompt 文本一律不读不存。任一源读不到→静默跳过。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { type CodexFeatureAdoption } from './model.js'

function readText(p: string): string | null {
  try { return readFileSync(p, 'utf8') } catch { return null }
}
function readJson(p: string): any {
  const t = readText(p)
  if (t == null) return null
  try { return JSON.parse(t) } catch { return null }
}
function listDirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
  } catch { return [] }
}
function countFiles(p: string): number {
  try {
    return readdirSync(p, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).length
  } catch { return 0 }
}

// ── config.toml（行级解析，与 endpoint.ts 同风格；不引 TOML 依赖）────────────
const TOP_KEYS = ['personality', 'model_reasoning_effort', 'plan_mode_reasoning_effort'] as const
interface ConfigSignals {
  personality: string | null
  model_reasoning_effort: string | null
  plan_mode_reasoning_effort: string | null
  trusted_projects: number
  broad_trust: boolean
  plugins_enabled: string[]
  features_enabled: string[]
}
export function parseConfigSignals(toml: string, home: string): ConfigSignals {
  const out: ConfigSignals = {
    personality: null, model_reasoning_effort: null, plan_mode_reasoning_effort: null,
    trusted_projects: 0, broad_trust: false, plugins_enabled: [], features_enabled: [],
  }
  let section = '' // 当前 [section] 全名
  let sectionArg = '' // [projects."…"] / [plugins."…"] 的引号参数（瞬时，仅本函数内使用）
  for (const raw of toml.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sec = /^\[([a-z_]+)(?:\."([^"]*)")?\]$/i.exec(line)
    if (sec) { section = sec[1]; sectionArg = sec[2] ?? ''; continue }
    const kv = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.+)$/.exec(line)
    if (!kv) continue
    const key = kv[1]
    const val = kv[2].trim().replace(/^"|"$/g, '')
    if (section === '' && (TOP_KEYS as readonly string[]).includes(key)) {
      ;(out as any)[key] = val
    } else if (section === 'projects' && key === 'trust_level' && val === 'trusted') {
      out.trusted_projects += 1
      if (sectionArg === home || sectionArg === homedir()) out.broad_trust = true // 路径仅瞬时比较，不存储
    } else if (section === 'plugins' && key === 'enabled' && val === 'true') {
      if (sectionArg) out.plugins_enabled.push(sectionArg.split('@')[0]) // 仅插件名标签，去 marketplace 后缀
    } else if (section === 'features' && val === 'true') {
      out.features_enabled.push(key)
    }
  }
  return out
}

// ── node:sqlite（实验特性）：动态 require + 屏蔽其 ExperimentalWarning；不可用→null ──
type SqliteCtor = new (path: string, opts: { readOnly: boolean }) => {
  prepare(sql: string): { get(): any; all(): any[] }
  close(): void
}
function loadSqlite(): SqliteCtor | null {
  const orig = process.emitWarning
  try {
    // 只在 require 瞬间屏蔽 SQLite 实验告警，避免污染 CLI stderr；其它告警照常
    ;(process as any).emitWarning = (...args: unknown[]) => {
      if (String(args[0] ?? '').includes('SQLite')) return
      return (orig as any).apply(process, args)
    }
    const req = createRequire(import.meta.url)
    return (req('node:sqlite') as any).DatabaseSync as SqliteCtor
  } catch {
    return null
  } finally {
    ;(process as any).emitWarning = orig
  }
}
// 只跑 COUNT/GROUP 类聚合查询；任何错误（库缺失/表缺失/损坏）→ null
function sqliteCounts(ctor: SqliteCtor | null, path: string, queries: Record<string, string>): Record<string, any> | null {
  if (!ctor) return null
  try { statSync(path) } catch { return null }
  let db: InstanceType<SqliteCtor> | null = null
  try {
    db = new ctor(path, { readOnly: true })
    const out: Record<string, any> = {}
    for (const [k, sql] of Object.entries(queries)) out[k] = db.prepare(sql).get()
    return out
  } catch { return null } finally { try { db?.close() } catch { /* noop */ } }
}

export function readCodexFeatureAdoption(home: string): CodexFeatureAdoption | null {
  const fa: CodexFeatureAdoption = { unadopted: [], caveats: [
    'sqlite-index-may-drift-from-rollouts',
    'app-global-state-fields-undocumented-may-drift',
    'fast-mode-saved-ms-is-app-self-reported-estimate',
    'memories-pipeline-requires-newer-cli-version',
  ] }
  let found = false

  // config.toml → 配置意图（白名单枚举/计数）
  const toml = readText(join(home, 'config.toml'))
  if (toml != null) { fa.config = parseConfigSignals(toml, home); found = true }

  // rules/default.rules → 智能审批已接受 prefix 规则数（只计行数，绝不读规则内容）
  const rules = readText(join(home, 'rules', 'default.rules'))
  if (rules != null) {
    fa.approvals = { prefix_rules: rules.split('\n').filter((l) => /^\s*prefix_rule\(/.test(l)).length }
    found = true
  }

  // skills/ → 装机清单计数（用户装的 vs 系统内置 .system）
  const userSkills = listDirs(join(home, 'skills')).length
  const systemSkills = listDirs(join(home, 'skills', '.system')).length
  if (userSkills > 0 || systemSkills > 0) { fa.skills = { user: userSkills, system: systemSkills }; found = true }

  // state_5.sqlite → threads 索引 / 子代理边 / 记忆产出（只 COUNT/GROUP，绝不 SELECT 正文列）
  const sqlite = loadSqlite()
  const state = sqliteCounts(sqlite, join(home, 'state_5.sqlite'), {
    threads: 'SELECT count(*) c, sum(archived) a FROM threads',
    spawn: 'SELECT count(*) c, count(DISTINCT parent_thread_id) p FROM thread_spawn_edges',
    memory: "SELECT (SELECT count(*) FROM stage1_outputs) s, (SELECT count(*) FROM threads WHERE memory_mode = 'enabled') e",
  })
  if (state) {
    fa.sessions_db = { threads: Number(state.threads?.c ?? 0), archived: Number(state.threads?.a ?? 0) }
    fa.multi_agent = { spawn_edges: Number(state.spawn?.c ?? 0), parent_threads: Number(state.spawn?.p ?? 0) }
    fa.memories = {
      memory_files: countFiles(join(home, 'memories')),
      stage1_rollouts: Number(state.memory?.s ?? 0),
      enabled_threads: Number(state.memory?.e ?? 0),
    }
    found = true
  } else {
    const mf = countFiles(join(home, 'memories'))
    if (mf > 0) { fa.memories = { memory_files: mf, stage1_rollouts: null, enabled_threads: null }; found = true }
  }

  // sqlite/codex-dev.db → Automations / Inbox（Codex App 定时任务）计数
  const dev = sqliteCounts(sqlite, join(home, 'sqlite', 'codex-dev.db'), {
    n: 'SELECT (SELECT count(*) FROM automations) a, (SELECT count(*) FROM automation_runs) r, (SELECT count(*) FROM inbox_items) i',
  })
  if (dev) {
    fa.automations = { automations: Number(dev.n?.a ?? 0), runs: Number(dev.n?.r ?? 0), inbox_items: Number(dev.n?.i ?? 0) }
    found = true
  }

  // .codex-global-state.json → Codex App 在场 + fast-mode 自报节省估算（防御式解析，字段随版本漂移）
  const gs = readJson(join(home, '.codex-global-state.json'))
  if (gs && typeof gs === 'object') {
    const app: NonNullable<CodexFeatureAdoption['app']> = { present: true }
    const atom = gs['electron-persisted-atom-state']
    if (atom && typeof atom === 'object') {
      const fm = atom['fast-mode-personalized-estimate']
      if (fm && typeof fm.estimatedSavedMs === 'number' && isFinite(fm.estimatedSavedMs)) {
        app.fast_mode_saved_ms = Math.round(fm.estimatedSavedMs)
        if (typeof fm.rolloutCountWithCompletedTurns === 'number') app.fast_mode_rollouts = fm.rolloutCountWithCompletedTurns
      }
      if (typeof atom.codexCloudAccess === 'string') app.cloud_access = atom.codexCloudAccess // 枚举标签
    }
    fa.app = app; found = true
  }

  // version.json → 版本陈旧度素材（最新已知版本 + 检查时间；实装版本在 codex_specific/threads）
  const ver = readJson(join(home, 'version.json'))
  if (ver && typeof ver === 'object' && typeof ver.latest_version === 'string') {
    fa.version = { latest: ver.latest_version, last_checked_at: typeof ver.last_checked_at === 'string' ? ver.last_checked_at : null }
    found = true
  }

  // ambient-suggestions/*/ambient-suggestions.json → App 主动建议产出量
  const ambRoot = join(home, 'ambient-suggestions')
  const ambDirs = listDirs(ambRoot)
  if (ambDirs.length > 0) {
    let suggestions = 0
    for (const d of ambDirs) {
      const j = readJson(join(ambRoot, d, 'ambient-suggestions.json'))
      if (Array.isArray(j?.suggestions)) suggestions += j.suggestions.length
    }
    fa.ambient = { projects: ambDirs.length, suggestions }
    found = true
  }

  // 全局 AGENTS.md → missing | empty | present（0 字节空文件是真实常见态，单独点名）
  try {
    const st = statSync(join(home, 'AGENTS.md'))
    fa.guides = { global_agents_md: st.size === 0 ? 'empty' : 'present', global_agents_md_bytes: st.size }
    found = true
  } catch { fa.guides = { global_agents_md: 'missing', global_agents_md_bytes: 0 } }

  if (!found) return null

  // unadopted 仅由无歧义的 0 计数判定（与 ADR 0056 同一证据纪律）
  if (fa.automations && fa.automations.automations === 0) fa.unadopted.push('automations')
  if (fa.multi_agent && fa.multi_agent.spawn_edges === 0) fa.unadopted.push('multi-agent')
  if (fa.approvals && fa.approvals.prefix_rules === 0) fa.unadopted.push('smart-approvals')
  if (fa.skills && fa.skills.user === 0) fa.unadopted.push('skills')
  if (fa.memories && fa.memories.memory_files === 0 && (fa.memories.stage1_rollouts === 0 || fa.memories.stage1_rollouts === null)) fa.unadopted.push('memories')
  if (fa.ambient && fa.ambient.suggestions === 0) fa.unadopted.push('ambient-suggestions')
  return fa
}
