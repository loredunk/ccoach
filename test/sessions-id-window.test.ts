// test/sessions-id-window.test.ts — `ccoach sessions --id` 不带时间窗也能钻取历史会话
// （--id 点名会话即范围，对齐 digest 的去时间窗语义；曾经默认「只看今天」导致历史会话返回空）。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

function runSessions(args: string[]): any {
  const out = execFileSync('npx', ['tsx', 'src/cli.ts', 'sessions', ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: 'test/fixtures/claude-home', TZ: 'UTC' },
    encoding: 'utf8',
    timeout: 60_000,
  })
  return JSON.parse(out)
}

describe('sessions --id window', () => {
  it('--id 不带 --since/--date/--days → 全时段，历史会话可钻取', () => {
    const r = runSessions(['--platform', 'claude-code', '--id', 'se1', '--include-user-prompts'])
    expect(r.generated_for).toContain('all time')
    expect(r.selected_session.repo).toBe('proj')
    expect(r.selected_session.prompts.length).toBe(2) // fixture 里 2026-06-02 的两条人类 prompt
  })
  it('--id 带显式 --date → 尊重用户给的窗口（窗口外返回空）', () => {
    const r = runSessions(['--platform', 'claude-code', '--id', 'se1', '--include-user-prompts', '--date', '2020-01-01'])
    expect(r.generated_for).not.toContain('all time')
    expect(r.sessions.length).toBe(0) // 窗口外：会话整个不出现
  })
})
