// test/claude-code.test.ts
import { describe, it, expect } from 'vitest'
import { parseClaudeCode } from '../src/parsers/claude-code.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('parseClaudeCode', () => {
  it('用量：按 message.id 去重、计入 sidechain（对齐 ccusage）、排除窗口外', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    // 主 100 + sidechain 200 = 300；重复条目(m1:r1)去重；5/1 的 777 窗口外排除
    expect(r.tokens.input).toBe(300)
    expect(r.tokens.cached_input).toBe(40)
    expect(r.tokens.cache_creation).toBe(10)
    expect(r.tokens.output).toBe(150) // 主 50 + sidechain 100
    expect(r.sessions).toBe(1) // sidechain('sub') 不计为独立会话
    expect(r.repos[0].repo).toBe('ccoach')
    expect(r.models).toContain('claude-opus-4-8')
  })
  it('流式分片：同 message.id:requestId 多次落盘且 usage 递增 → 取最终(最大)值（对齐 ccusage）', () => {
    // ccusage 对同一 (messageId,requestId) 保留最终(最大)usage；ccoach 旧实现取首个早期分片会少算。
    const r = parseClaudeCode('test/fixtures/claude-stream', window)
    expect(r.tokens.input).toBe(10)
    expect(r.tokens.output).toBe(80) // 取最大分片 80，而非首个分片 5
    expect(r.tokens.total).toBe(90)
  })
  it('工具/习惯仅主会话：去重、排除 sidechain 工具', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.tools.shell_calls).toBe(1) // 仅主会话一次；重复与 sidechain 的 Bash 都不计
    expect(r.tools.file_changes).toBe(1)
    expect(r.git_habits.command_count).toBe(1)
    expect(r.git_habits.top_subcommands?.[0]).toEqual({ command: 'commit', count: 1 })
  })
  it('prompt 信号去重且仅数值；JSON 不含原文/sidechain 危险命令', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.prompt_signals.prompts).toBe(1) // 重复 user(uuid u1) 去重
    expect(r.prompt_signals.constraint_ratio).toBe(1)
    const j = JSON.stringify(r)
    expect(j).not.toContain('保留测试') // 不含 prompt 原文
    expect(j).not.toContain('rm -rf') // 不含 sidechain 命令
  })
  it('行为字段（采集并入 ccoach）：categories / by_name / hours.count / file_languages', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.tools.total_calls).toBe(2) // 仅主会话 Bash + Edit（旧版漏计非 shell/web/file 工具已修）
    expect(r.tools.categories).toEqual({ shell: 1, file: 1 })
    expect(r.tools.by_name).toEqual(
      expect.arrayContaining([{ name: 'Bash', count: 1 }, { name: 'Edit', count: 1 }]),
    )
    // 主 200 + 子代理 300 = 两条 token 事件，同在本机 03 时（UTC fixture + TZ=UTC）
    expect(r.hours).toEqual([{ hour: 3, tokens: 500, count: 2 }])
    expect(r.file_languages).toEqual([{ name: 'TypeScript', files: 1 }]) // Edit src/main.ts → ts
    expect(JSON.stringify(r)).not.toContain('main.ts') // file_languages 只留扩展名映射，不含路径/文件名
  })
  it('--scope project / session 产出派生信号桶（scope 并入 ccoach），不含 prompt 原文', () => {
    const proj = parseClaudeCode('test/fixtures/claude', window, 'project')
    expect(proj.scope).toBe('project')
    expect(proj.projects).toHaveLength(1)
    const p = proj.projects![0]
    expect(p).toMatchObject({
      repo: 'ccoach', sessions: 1, tokens: 500 /* 主 200 + 子代理 300：项目桶含 sidechain token */,
      tool_calls: 2, categories: { shell: 1, file: 1 }, git_top: [{ command: 'commit', count: 1 }],
    })
    expect(p.prompt_signals.prompts).toBe(1)

    const sess = parseClaudeCode('test/fixtures/claude', window, 'session')
    expect(sess.scope).toBe('session')
    expect(sess.sessions_detail).toHaveLength(1)
    const s = sess.sessions_detail![0]
    expect(s).toMatchObject({
      session_id: 's1', repo: 'ccoach', tokens: 200 /* 会话桶不含 sidechain */,
      tool_calls: 2, duration_seconds: 5 /* 03:00:00 → 03:00:05 */,
    })
    expect(JSON.stringify(sess)).not.toContain('保留测试') // scope 桶绝不含 prompt 原文
  })
  it('来源（entrypoint）：按 token 加权填 sources（双平台「来源」面板对称）', () => {
    const r = parseClaudeCode('test/fixtures/claude-sources', { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' })
    expect(r.sources.map((s) => s.name)).toEqual(['vscode', 'cli']) // token 降序：vscode 300 > cli 150
    const by = Object.fromEntries(r.sources.map((s) => [s.name, s]))
    expect(by.cli).toMatchObject({ sessions: 1, tokens: 150 })
    expect(by.vscode).toMatchObject({ sessions: 1, tokens: 300 })
  })
  it('claude_specific（ADR 0023 D2）：server_tool_use 计数（仅主会话，去重后取保留记录）', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.claude_specific).toEqual({ web_search_requests: 3, web_fetch_requests: 2 })
  })
})
