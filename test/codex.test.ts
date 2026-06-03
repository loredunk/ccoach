// test/codex.test.ts
import { describe, it, expect } from 'vitest'
import { parseCodex } from '../src/parsers/codex.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('parseCodex（glob）', () => {
  it('用 last_token_usage 累计、识别模型与 repo（含子代理用量）', () => {
    const r = parseCodex('test/fixtures/codex', window)
    // 主会话(100/50/10/150) + 子代理 rollout(5000/5000/0/10000) 的 token 都计入用量（对齐 ccusage）。
    expect(r.tokens.input).toBe(5100)
    expect(r.tokens.cached_input).toBe(40)
    expect(r.tokens.output).toBe(5050)
    expect(r.tokens.reasoning_output).toBe(10)
    expect(r.tokens.total).toBe(10150)
    expect(r.models).toContain('gpt-5.1')
    expect(r.repos[0].repo).toBe('ccoach')
    expect(r.git_habits.top_subcommands?.[0]).toEqual({ command: 'status', count: 1 })
  })
  it('subagent rollout：token 计入用量，但不计入会话数 / 工具 / 活跃时长（对齐 Claude sidechain）', () => {
    const r = parseCodex('test/fixtures/codex', window)
    expect(r.tokens.total).toBe(10150) // 子代理 10000 token 已计入（ccusage 也计入）
    expect(r.sessions).toBe(1) // 子代理会话 c2 不计入会话数（只有主会话 c1）
    expect(r.tools.shell_calls).toBe(1) // 仅主会话 git status；子代理工具不计入习惯
  })
  it('混合 last-only / total-only 事件不重复计数（prevTotal 推进）', () => {
    // last=10，再来一个仅 total=15 的事件：应得 10 + (15-10) = 15，而非 10 + 15 = 25。
    const r = parseCodex('test/fixtures/codex-mixed', window)
    expect(r.tokens.input).toBe(15)
    expect(r.tokens.total).toBe(15)
  })
  it('error_signals：function_call_output exit code + error 事件（格式推断）', () => {
    const e = parseCodex('test/fixtures/codex-errors', window).error_signals
    expect(e.tool_calls).toBe(2) // c1(err) + c2(ok)
    expect(e.tool_errors).toBe(1) // c1 exit 128
    expect(e.api_errors).toBe(1) // error 事件
    expect(e.by_category).toEqual(expect.arrayContaining([{ command: 'git', count: 1 }]))
    // 隐私：不含原始输出
    expect(JSON.stringify(parseCodex('test/fixtures/codex-errors', window))).not.toContain('fatal: not a git repository')
  })
})
