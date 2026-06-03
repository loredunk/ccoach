// test/sessions.test.ts — ccoach sessions（采集并入 ccoach·块C，取代 session_drilldown.py / claude_session_prompts.py）
import { describe, it, expect } from 'vitest'
import { listClaudeSessions, listCodexSessions, redact } from '../src/sessions.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('ccoach sessions', () => {
  it('redact：密钥/邮箱/IP 脱敏 + 深路径折叠 + 截断', () => {
    const out = redact(
      'k sk-ABCDEFGHIJKL token=supersecret mail a@b.com ip 10.0.0.1 at /home/u/work/secret/deep/file.ts',
      1000,
    )
    expect(out).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/)
    expect(out).toContain('sk-REDACTED')
    expect(out).toContain('token=REDACTED')
    expect(out).toContain('<email>')
    expect(out).toContain('<ip>')
    expect(out).toContain('/…/') // 深层绝对路径折叠到尾段
    expect(redact('x'.repeat(50), 10)).toContain('…[truncated]') // 码点截断
  })

  it('claude 列表：候选会话（数值），零 prompt 原文 / 无 selected_session', () => {
    const o = listClaudeSessions('test/fixtures/claude', window, { top: 10 })
    expect(o.includes_user_prompts).toBe(false)
    const sessions = o.sessions as Array<Record<string, any>>
    expect(sessions[0].session_id).toBe('s1')
    expect(sessions[0].tokens).toBe(200) // 子代理不计入会话
    expect(sessions[0].prompt_signals.constraint_ratio).toBe(1)
    const j = JSON.stringify(o)
    expect(j).not.toContain('保留测试') // 列表零 prompt 原文
    expect(j).not.toContain('selected_session')
  })

  it('claude 预览（opt-in）：单会话 redacted prompts + 每条 signals', () => {
    const o = listClaudeSessions('test/fixtures/claude', window, { includePrompts: true }) as Record<string, any>
    expect(o.prompt_scope).toBe('one selected session')
    expect(o.selected_session.prompts).toHaveLength(1)
    const p = o.selected_session.prompts[0]
    expect(p.signals).toMatchObject({ structured: true, file_ref: true, constraint: true, correction: false })
    expect(typeof p.preview).toBe('string')
    expect(p.idx).toBe(0)
  })

  it('codex 列表：候选会话（数值），零 user_prompts', () => {
    const o = listCodexSessions('test/fixtures/codex', window, { top: 10 }) as Record<string, any>
    expect(o.privacy.includes_user_prompts).toBe(false)
    expect(Array.isArray(o.sessions)).toBe(true)
    expect(o.sessions.length).toBeGreaterThanOrEqual(1)
    expect(typeof o.sessions[0].session_id).toBe('string')
    expect(o.sessions[0].tools.total_calls).toBeGreaterThanOrEqual(1)
    expect(o.sessions[0].user_prompts).toBeUndefined()
    expect(JSON.stringify(o)).not.toContain('"user_prompts"') // 列表无 prompt 内容字段（区别于 includes_user_prompts 标志）
  })
})
