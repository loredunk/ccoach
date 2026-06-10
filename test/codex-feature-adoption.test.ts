// Codex 特性采用信号（ADR 0057）：fixture home 全源解析 + sqlite 计数 + 隐私断言。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { readCodexFeatureAdoption, parseConfigSignals } from '../src/codex-feature-adoption.js'
import { buildReport } from '../src/index.js'

const FIXTURE = 'test/fixtures/codex-adoption'
const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }
const req = createRequire(import.meta.url)

// node:sqlite 为实验特性（Node 22.5+）；不可用时 sqlite 相关断言降级为 null 路径
function sqliteAvailable(): boolean {
  try { req('node:sqlite'); return true } catch { return false }
}

describe('readCodexFeatureAdoption · file-based sources', () => {
  const fa = readCodexFeatureAdoption(FIXTURE)!

  it('parses config.toml intent signals', () => {
    expect(fa).not.toBeNull()
    expect(fa.config).toMatchObject({
      personality: 'pragmatic',
      model_reasoning_effort: 'medium',
      plan_mode_reasoning_effort: 'high',
      trusted_projects: 2, // untrusted 不计
      plugins_enabled: ['superpowers'], // enabled=false 不计；去 @marketplace 后缀
      features_enabled: ['sandbox_v2'], // false 开关不计
    })
  })

  it('counts accepted prefix rules without storing rule content', () => {
    expect(fa.approvals).toEqual({ prefix_rules: 3 })
  })

  it('counts installed skills (user vs bundled .system)', () => {
    expect(fa.skills).toEqual({ user: 1, system: 1 })
  })

  it('reads App global state defensively (fast-mode self-estimate, enum labels)', () => {
    expect(fa.app).toMatchObject({ present: true, fast_mode_saved_ms: 4439029, fast_mode_rollouts: 56, cloud_access: 'enabled_needs_setup' })
  })

  it('reads version + ambient + guide-file state', () => {
    expect(fa.version).toEqual({ latest: '0.125.0', last_checked_at: '2026-04-28T12:35:38.865156Z' })
    expect(fa.ambient).toEqual({ projects: 1, suggestions: 2 })
    expect(fa.guides).toEqual({ global_agents_md: 'empty', global_agents_md_bytes: 0 }) // 0 字节空文件单独点名
  })

  it('derives unadopted only from unambiguous zero counters', () => {
    // fixture：无 automations/state 库（null → 不判）；空 memories/ 目录单独算弱证据也不判（sqlite 路径才判）
    expect(fa.unadopted).not.toContain('memories')
    expect(fa.unadopted).not.toContain('automations')
    expect(fa.unadopted).not.toContain('smart-approvals') // 有 3 条规则
    expect(fa.unadopted).not.toContain('skills')
    expect(fa.unadopted).not.toContain('ambient-suggestions') // 有 2 条建议
  })

  it('privacy: output carries no paths, no rule contents, no prompt text', () => {
    const s = JSON.stringify(fa)
    expect(s).not.toContain('/Users/someone') // trusted 项目路径瞬时用于计数，绝不存储
    expect(s).not.toContain('proj-a')
    expect(s).not.toContain('pattern=') // 规则内容不外漏
    expect(s).not.toContain('git')
  })

  it('returns null for a home with none of the sources', () => {
    expect(readCodexFeatureAdoption('test/fixtures/does-not-exist')).toBeNull()
  })
})

describe('parseConfigSignals · broad_trust', () => {
  it('flags a trusted root equal to the codex home argument', () => {
    const toml = '[projects."/srv/home"]\ntrust_level = "trusted"\n'
    expect(parseConfigSignals(toml, '/srv/home').broad_trust).toBe(true)
    expect(parseConfigSignals(toml, '/srv/other').broad_trust).toBe(false)
  })
})

describe('readCodexFeatureAdoption · sqlite index sources', () => {
  const home = join(tmpdir(), `ccoach-cfa-${process.pid}`)

  beforeAll(() => {
    cpSync(FIXTURE, home, { recursive: true })
    if (!sqliteAvailable()) return
    const { DatabaseSync } = req('node:sqlite')
    const state = new DatabaseSync(join(home, 'state_5.sqlite'))
    state.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, archived INTEGER NOT NULL DEFAULT 0, memory_mode TEXT NOT NULL DEFAULT 'enabled');
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT NOT NULL, child_thread_id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE stage1_outputs (thread_id TEXT PRIMARY KEY, raw_memory TEXT NOT NULL, rollout_summary TEXT NOT NULL);
      INSERT INTO threads VALUES ('t1', 0, 'enabled'), ('t2', 1, 'enabled'), ('t3', 0, 'disabled');
      INSERT INTO thread_spawn_edges VALUES ('t1', 'c1', 'completed'), ('t1', 'c2', 'completed');`)
    state.close()
    mkdirSync(join(home, 'sqlite'), { recursive: true })
    const dev = new DatabaseSync(join(home, 'sqlite', 'codex-dev.db'))
    dev.exec(`CREATE TABLE automations (id TEXT PRIMARY KEY);
      CREATE TABLE automation_runs (id TEXT PRIMARY KEY);
      CREATE TABLE inbox_items (id TEXT PRIMARY KEY);`)
    dev.close()
  })
  afterAll(() => { rmSync(home, { recursive: true, force: true }) })

  it('aggregates counts only (threads/spawn-edges/stage1/automations)', () => {
    const fa = readCodexFeatureAdoption(home)!
    if (!sqliteAvailable()) {
      expect(fa.sessions_db).toBeUndefined()
      return
    }
    expect(fa.sessions_db).toEqual({ threads: 3, archived: 1 })
    expect(fa.multi_agent).toEqual({ spawn_edges: 2, parent_threads: 1 })
    expect(fa.memories).toEqual({ memory_files: 0, stage1_rollouts: 0, enabled_threads: 2 })
    expect(fa.automations).toEqual({ automations: 0, runs: 0, inbox_items: 0 })
    expect(fa.unadopted).toContain('automations') // 0 行 = 未采用
    expect(fa.unadopted).toContain('memories') // enabled 但零产出
    expect(fa.unadopted).not.toContain('multi-agent') // 有 spawn 边
  })
})

describe('buildReport wiring', () => {
  it('attaches codex_feature_adoption for the codex platform', () => {
    const r = buildReport({ platform: 'codex', window, codexHome: FIXTURE })
    expect(r.codex_feature_adoption?.config?.personality).toBe('pragmatic')
  })
  it('omits the field when the home has no adoption sources', () => {
    const r = buildReport({ platform: 'codex', window, codexHome: 'test/fixtures/codex' })
    expect(r.codex_feature_adoption).toBeUndefined()
  })
  it('never attaches it on the claude-code platform', () => {
    const r = buildReport({ platform: 'claude-code', window, claudeDir: 'test/fixtures/claude' })
    expect(r.codex_feature_adoption).toBeUndefined()
  })
})
