// test/codex-digest.test.ts — Codex 正文 digest（ADR 0050 D3：opt-in、脱敏、不含 reasoning/developer/system）
import { describe, it, expect } from 'vitest'
import { buildCodexDigest } from '../src/digest.js'

describe('ccoach digest --platform codex', () => {
  const d = buildCodexDigest('test/fixtures/codex-digest', { sessionId: 'cxdig1' }) as any

  it('提取 assistant 文本 + 工具 args + 工具结果（含 custom_tool_call_output 的 .output）', () => {
    expect(d.platform).toBe('codex')
    expect(d.session_id).toBe('cxdig1')
    const kinds = d.items.map((i: any) => i.kind)
    expect(kinds).toContain('ASSISTANT')
    expect(kinds).toContain('TOOL')
    expect(kinds).toContain('RESULT')
    const j = JSON.stringify(d)
    expect(j).toContain('check the queue') // assistant 正文
    expect(j).toContain('rg queue') // 工具 args
    expect(j).toContain('Updated files: a.ts') // custom_tool_call_output 的 .output 被抽出
  })

  it('红线：reasoning / developer 绝不进 digest；密钥被脱敏', () => {
    const j = JSON.stringify(d)
    expect(j).not.toContain('SECRET_REASONING_DO_NOT_LEAK') // 思维链排除
    expect(j).not.toContain('DEV_PROMPT_SECRET') // developer 消息排除
    expect(j).not.toMatch(/sk-ABCDEFGHIJKLMN/)
    expect(j).toContain('sk-REDACTED')
    expect(typeof d.stats.est_tokens).toBe('number')
  })
})
