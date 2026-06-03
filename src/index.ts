import { type Report } from './model.js'
import { type Window } from './window.js'
import { Aggregator, type Scope } from './aggregate.js'
import { parseClaudeCode, feedClaudeCode, claudeProjectsDir } from './parsers/claude-code.js'
import { parseCodex, feedCodex, codexHome } from './parsers/codex.js'

export const VERSION = '0.1.0'
export { claudeProjectsDir, codexHome }
export type { Report } from './model.js'
export type { Scope } from './aggregate.js'

export type Platform = 'claude-code' | 'codex' | 'all'

export interface BuildOpts {
  platform: Platform
  window: Window
  claudeDir?: string
  codexHome?: string
  scope?: Scope
}

// 库导出：单平台直接跑对应适配器；'all' 用同一个聚合器喂入两平台后 assemble 一次。
// 这样避免"合并两份已成形（已截断 top-N、已聚合）报告"带来的问题——重复截断 top_commands、
// 跨平台重复计数 branch_count/项目数、以及两套聚合逻辑漂移。cache_hit_rate 的非缓存输入按
// 模型判定（见 pricing.disjointInputBuckets），故混合平台聚合仍口径一致。
export function buildReport(opts: BuildOpts): Report {
  const { platform, window } = opts
  const scope: Scope = opts.scope ?? 'global'
  if (platform === 'claude-code') {
    return parseClaudeCode(opts.claudeDir ?? claudeProjectsDir(), window, scope)
  }
  if (platform === 'codex') {
    return parseCodex(opts.codexHome ?? codexHome(), window, scope)
  }
  const agg = new Aggregator('all', scope)
  feedClaudeCode(agg, opts.claudeDir ?? claudeProjectsDir(), window)
  feedCodex(agg, opts.codexHome ?? codexHome(), window)
  return agg.assemble(window, 'glob')
}
