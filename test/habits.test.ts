// test/habits.test.ts
import { describe, it, expect } from 'vitest'
import { buildGitHabits, buildProjectMgmt } from '../src/habits.js'

describe('habits', () => {
  it('只 diff/status 不 commit → 风险信号', () => {
    const g = buildGitHabits({ status: 5, diff: 4 }, /*branchCount*/2, /*multiBranchRepos*/1)
    expect(g.command_count).toBe(9)
    expect(g.risk_signals?.some(s => s.includes('commit'))).toBe(true)
  })
  it('有 commit + push → 评审/正常信号，无该风险', () => {
    const g = buildGitHabits({ commit: 3, push: 2, diff: 1 }, 1, 0)
    expect(g.risk_signals ?? []).not.toContainEqual(expect.stringContaining('只'))
  })
  it('project mgmt 统计含测试/构建的仓库数', () => {
    const p = buildProjectMgmt([
      { repo: 'a', sessions: 1, tokens: 1, estimated_cost_usd: 0, hasTests: true, hasBuild: true },
      { repo: 'b', sessions: 1, tokens: 1, estimated_cost_usd: 0, hasTests: false, hasBuild: true },
    ] as any)
    expect(p.repos_with_tests).toBe(1)
    expect(p.repos_with_build_system).toBe(2)
  })
})
