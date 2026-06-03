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
})
