// test/feature-adoption.test.ts — 特性采用信号（ADR 0056）：白名单计数器为主、条件型 tip 水位为旁证。
import { describe, it, expect } from 'vitest'
import { readFeatureAdoption } from '../src/feature-adoption.js'
import { buildReport } from '../src/index.js'

const FIX = 'test/fixtures/claude-config/claude.json'

describe('readFeatureAdoption', () => {
  const fa = readFeatureAdoption(FIX)!

  it('白名单计数器透传；unadopted 仅由计数器判定', () => {
    expect(fa.num_startups).toBe(386)
    expect(fa.counters).toEqual({
      prompt_queue_use_count: 4300,
      memory_usage_count: 0,
      btw_use_count: 12,
      has_used_background_task: false,
    })
    // memory_usage_count=0 + hasUsedBackgroundTask=false → 未采用；prompt-queue 用了 4300 次 → 不在列
    expect(fa.unadopted).toEqual(['memory', 'background-tasks'])
  })

  it('条件型 tip 白名单水位 + still_showing；宣传型/未知 tip 排除', () => {
    const byId = Object.fromEntries(fa.tips!.map((t) => [t.tip, t]))
    expect(byId['memory-command']).toMatchObject({ last_shown_at_startup: 384, still_showing: true })
    expect(byId['git-worktrees']).toMatchObject({ last_shown_at_startup: 375, still_showing: true })
    expect(byId['prompt-queue']).toMatchObject({ last_shown_at_startup: 8, still_showing: false }) // 已采用、tip 退场
    expect(byId['todo-list']).toBeUndefined()          // 无条件轮播的宣传位：零画像价值
    expect(byId['unknown-future-tip']).toBeUndefined() // 不在白名单
  })

  it('隐私：绝不泄露白名单之外的内容（projects 路径/邮箱/工具行）', () => {
    const out = JSON.stringify(fa)
    expect(out).not.toContain('/Users/secret')
    expect(out).not.toContain('secret@example.com')
    expect(out).not.toContain('rm -rf')
    expect(fa.caveats.length).toBeGreaterThan(0)
  })

  it('缺文件 → null（纯 Codex 机器是正常情况）', () => {
    expect(readFeatureAdoption('test/fixtures/claude-config/nope.json')).toBeNull()
  })
})

describe('buildReport wiring', () => {
  const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }
  it('显式 claudeJsonPath → feature_adoption 出现在报告', () => {
    const r = buildReport({ platform: 'claude-code', window, claudeDir: 'test/fixtures/claude', claudeJsonPath: FIX })
    expect(r.feature_adoption?.unadopted).toContain('memory')
  })
  it('fixture claudeDir 且未给 claudeJsonPath → 不摸真实 home（无 feature_adoption 或可重现）', () => {
    const r = buildReport({ platform: 'claude-code', window, claudeDir: 'test/fixtures/claude' })
    expect(r.feature_adoption).toBeUndefined()
  })
})
