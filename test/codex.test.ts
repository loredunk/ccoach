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

  it('billing（ADR 0022 D1）：按 plan_type 拆 token，子代理无 plan_type 入未分类，总和守恒', () => {
    const r = parseCodex('test/fixtures/codex', window)
    const b = r.billing!
    expect(b.by_plan_tier).toEqual({ plus: 150 }) // 主会话 c1 标了 plus
    expect(b.unclassified).toBe(10000) // 子代理 c2 无 rate_limits → 未分类（≠确定API）
    expect(b.sessions_with_plan).toBe(1)
    expect(b.sessions_unclassified).toBe(1)
    expect(b.confidence).toBe('spoofable-by-relay')
    // 守恒不变式：sum(by_plan_tier) + unclassified === tokens.total
    const sumTier = Object.values(b.by_plan_tier).reduce((a, c) => a + c, 0)
    expect(sumTier + b.unclassified).toBe(r.tokens.total)
  })

  it('codex_specific（ADR 0023 D1）：执行画像计数/枚举标签（子代理不计入习惯）', () => {
    const cs = parseCodex('test/fixtures/codex', window).codex_specific!
    expect(cs.effort).toEqual({ high: 1 })
    expect(cs.approval_policy).toEqual({ 'on-request': 1 })
    expect(cs.sandbox).toEqual({ 'workspace-write': 1 })
    expect(cs.collaboration_mode).toEqual({ default: 1 }) // 仅 mode 名
    expect(cs.personality).toEqual({ pragmatic: 1 })
    expect(cs.originators).toEqual({ codex_cli_rs: 1 }) // 子代理 c2 originator 不计入
    expect(cs.compactions).toBe(1) // 顶层 compacted 记录
    expect(cs.aborted_turns).toBe(1) // event_msg turn_aborted
    expect(cs.context_window).toBe(258400)
    expect(cs.git_repo_identity).toBe(true) // 仅布尔，绝不存 repository_url
  })

  it('隐私红线：rate_limits 恒 null；配额%/余额/重置/developer_instructions/repository_url 绝不泄露', () => {
    const r = parseCodex('test/fixtures/codex', window)
    expect(r.rate_limits).toBeNull() // CLAUDE.md 红线：rate_limits 顶层恒 null
    const blob = JSON.stringify(r)
    for (const leak of ['used_percent', 'resets_at', 'window_minutes', 'balance', 'SECRET_DEV_INSTRUCTIONS_SHOULD_NOT_LEAK', 'private-ccoach', 'deadbeef']) {
      expect(blob).not.toContain(leak)
    }
  })
})

import { parseCodex as parseCodexEp } from '../src/parsers/codex.js'
import { dirname as dn, join as jn } from 'node:path'
import { fileURLToPath as f2url } from 'node:url'
const CX_EP = jn(dn(f2url(import.meta.url)), 'fixtures', 'codex-episodes')

describe('Codex episode 切分', () => {
  it('边界=turn_context；interrupted 归因；无 corrected', () => {
    const r = parseCodexEp(CX_EP, { fromYmd: '2026-06-05', toYmd: '2026-06-05', desc: 'd' }, 'episode')
    expect(r.episode_summary!.episodes).toBe(2)
    expect(r.episode_summary!.corrected_rate).toBe(0)
    expect(r.episodes_detail!.find((e) => e.index === 1)!.end_type).toBe('interrupted')
  })
})
