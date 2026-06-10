import { dirname } from 'node:path'
import pkg from '../package.json'
import { type Report, type EndpointDetection } from './model.js'
import { type Window } from './window.js'
import { Aggregator, type Scope } from './aggregate.js'
import { feedClaudeCode, claudeProjectsDir } from './parsers/claude-code.js'
import { feedCodex, codexHome } from './parsers/codex.js'
import { detectCodexEndpoint, detectClaudeEndpoint } from './endpoint.js'
import { readFeatureAdoption, defaultClaudeJsonPath } from './feature-adoption.js'

export const VERSION: string = pkg.version
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
  claudeJsonPath?: string // 测试/覆盖用：~/.claude.json 路径（特性采用信号，ADR 0056）
}

// 库导出：用同一个聚合器按平台喂入后 assemble 一次（含 'all' 喂两平台）。统一走聚合器（不再分单/双平台
// 两条路径）便于在 buildReport 层拿到聚合器派生的 D2a 信号、再叠加 config 端点检测（D2b）。避免"合并两份
// 已成形报告"的重复截断/重复计数；cache_hit_rate 的非缓存输入按模型判定（pricing.disjointInputBuckets），
// 故混合平台聚合仍口径一致。
//
// 端点检测（ADR 0022 D2/D3/D4）是**账户级当前快照**（读 config），与窗口/历史 token 无关，故在 assemble 后叠加。
export function buildReport(opts: BuildOpts): Report {
  const { platform, window } = opts
  const scope: Scope = opts.scope ?? 'global'
  const claudeDir = opts.claudeDir ?? claudeProjectsDir()
  const cxHome = opts.codexHome ?? codexHome()
  const wantClaude = platform === 'claude-code' || platform === 'all'
  const wantCodex = platform === 'codex' || platform === 'all'

  const agg = new Aggregator(platform, scope)
  if (wantClaude) feedClaudeCode(agg, claudeDir, window)
  if (wantCodex) feedCodex(agg, cxHome, window)
  const report = agg.assemble(window, 'glob')

  // D2/D3/D4 端点检测：读本机 config 派生白名单标签（只读、不存 key/token/完整 URL）。
  const endpoints: EndpointDetection[] = []
  if (wantCodex) endpoints.push(detectCodexEndpoint(cxHome, agg.getCodexNonDefaultProvider()))
  if (wantClaude) endpoints.push(detectClaudeEndpoint(dirname(claudeDir)))
  if (endpoints.length) report.endpoints = endpoints
  // 特性采用信号（ADR 0056，仅 Claude）：账户级当前快照，读 ~/.claude.json 白名单键；缺文件静默跳过。
  // 仅在「真实 home 运行」（未覆盖 claudeDir）或显式给了 claudeJsonPath 时读取——
  // fixture/测试传了自定义 claudeDir 时不去摸真实 home，保证测试可重现。
  if (wantClaude) {
    const jsonPath = opts.claudeJsonPath ?? (opts.claudeDir ? null : defaultClaudeJsonPath())
    const fa = jsonPath ? readFeatureAdoption(jsonPath) : null
    if (fa) report.feature_adoption = fa
  }
  return report
}
