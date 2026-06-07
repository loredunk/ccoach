// test/digest.test.ts — ccoach digest（ADR 0049：opt-in、token 受控、redacted、不含 thinking）
import { describe, it, expect } from 'vitest'
import { buildDigest, BUDGETS } from '../src/digest.js'

describe('ccoach digest', () => {
  it('提取 assistant 文本 + 工具输入 + tool_result（含 error 标记），排除 thinking', () => {
    const d = buildDigest('test/fixtures/claude-digest', { sessionId: 'd1' }) as any
    expect(d.session_id).toBe('d1')
    const kinds = d.items.map((i: any) => i.kind)
    expect(kinds).toContain('ASSISTANT')
    expect(kinds).toContain('TOOL')
    expect(kinds).toContain('RESULT')
    expect(kinds).toContain('RESULT_ERR')
    const j = JSON.stringify(d)
    expect(j).not.toContain('PRIVATE_THOUGHT_DO_NOT_LEAK') // thinking 绝不进 digest
    expect(j).not.toContain('please fix the failing build') // 人类 prompt 不在 digest（走 sessions --include-user-prompts）
    expect(j).toContain('npm test') // 工具输入保留
  })

  it('脱敏：密钥被 redact', () => {
    const d = buildDigest('test/fixtures/claude-digest', { sessionId: 'd1' }) as any
    const j = JSON.stringify(d)
    expect(j).not.toMatch(/sk-ABCDEFGHIJKLMN/)
    expect(j).toContain('sk-REDACTED')
  })

  it('token 受控：总量封顶触发 dropped、stats 含 est_tokens', () => {
    const d = buildDigest('test/fixtures/claude-digest', { sessionId: 'd1', perItem: 20, maxTotal: 30 }) as any
    expect(d.stats.dropped).toBeGreaterThan(0)
    expect(d.stats.emitted_chars).toBeLessThanOrEqual(60) // 封顶附近（最多溢出一项）
    expect(typeof d.stats.est_tokens).toBe('number')
    expect(BUDGETS.tight.maxTotal).toBe(30000)
  })

  // papercut 回归：--id 点名单会话不受时间窗影响（fixture 日期 2026-06-02 ≠ 今天；旧实现按"今天"窗会过滤空）。
  it('点名 --id 的会话不被日期窗过滤（无 window 参数）', () => {
    const d = buildDigest('test/fixtures/claude-digest', { sessionId: 'd1' }) as any
    expect(d.session_id).toBe('d1')
    expect(d.stats.items).toBeGreaterThan(0)
    expect(d.items.length).toBeGreaterThan(0)
  })
})
