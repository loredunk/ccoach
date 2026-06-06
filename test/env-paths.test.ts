// test/env-paths.test.ts
// 锁住 env 覆盖路径的解析语义 —— 这是「Claude 半边静默失效」footgun 的根源：
//   CLAUDE_CONFIG_DIR 解析为 `<dir>/projects`（会拼 /projects），CODEX_HOME 原样返回（parser 再拼 /sessions）。
// 纯函数单测、不依赖 fixture。数据目录直传的端到端覆盖见 run-report.test.ts（--claude-dir / --codex-home）。
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { claudeProjectsDir, codexHome } from '../src/index.js'

describe('env path resolution (CLAUDE_CONFIG_DIR / CODEX_HOME)', () => {
  const saved = { c: process.env.CLAUDE_CONFIG_DIR, x: process.env.CODEX_HOME }
  afterEach(() => {
    if (saved.c === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = saved.c
    if (saved.x === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = saved.x
  })

  it('CLAUDE_CONFIG_DIR resolves to <dir>/projects (the +/projects append — footgun root)', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/cfg'
    expect(claudeProjectsDir()).toBe(join('/tmp/cfg', 'projects'))
  })

  it('claudeProjectsDir falls back to ~/.claude/projects when unset', () => {
    delete process.env.CLAUDE_CONFIG_DIR
    expect(claudeProjectsDir()).toBe(join(homedir(), '.claude', 'projects'))
  })

  it('CODEX_HOME resolves verbatim (the parser appends /sessions, not the resolver)', () => {
    process.env.CODEX_HOME = '/tmp/cx'
    expect(codexHome()).toBe('/tmp/cx')
  })

  it('codexHome falls back to ~/.codex when unset', () => {
    delete process.env.CODEX_HOME
    expect(codexHome()).toBe(join(homedir(), '.codex'))
  })
})
