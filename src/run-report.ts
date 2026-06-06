// src/run-report.ts
// 默认命令（usage 报告）的核心：解析后的选项 → buildReport → emit 字符串。
// 从 cli.ts 抽出，便于单测「选项 → 报告」这层（旗标/校验逻辑所在），且 import 不触发 cac 的 cli.parse()。
import { resolveWindow } from './window.js'
import { setLang } from './i18n.js'
import { buildReport, type Platform, type Scope } from './index.js'
import { emitJson } from './emit/json.js'
import { emitText } from './emit/text.js'

const PLATFORMS: Platform[] = ['claude-code', 'codex', 'all']
const SCOPES: Scope[] = ['global', 'project', 'session', 'episode']

export interface ReportCliOptions {
  date?: string
  since?: string
  days?: number | string
  byRepo?: boolean
  platform?: string
  scope?: string
  lang?: string
  json?: boolean
  glossary?: boolean
  // 数据目录直传（ADR 0011 适配器口径）：绕过 env 默认，消除 CLAUDE_CONFIG_DIR 的 `+/projects` 隐式拼接坑。
  claudeDir?: string // Claude projects 目录（直传；含 <project>/<session>.jsonl）
  codexHome?: string // Codex home 目录（内部读 <home>/sessions）
  now?: Date // 可注入「现在」用于确定性测试；默认 new Date()
}

export function runReport(options: ReportCliOptions): string {
  setLang(options.lang) // 默认 en；先设语言，再 resolveWindow/buildReport/emit
  const platform = String(options.platform ?? 'all') as Platform
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`invalid --platform ${platform} (want claude-code|codex|all)`)
  }
  const scope = String(options.scope ?? 'global') as Scope
  if (!SCOPES.includes(scope)) {
    throw new Error(`invalid --scope ${scope} (want global|project|session|episode)`)
  }
  const daysRaw = options.days
  const days = daysRaw != null ? Number(daysRaw) : undefined
  if (days !== undefined && !Number.isFinite(days)) {
    throw new Error(`invalid --days ${String(daysRaw)}`)
  }
  const window = resolveWindow(
    { date: options.date, since: options.since, days },
    options.now ?? new Date(),
  )
  const report = buildReport({
    platform,
    window,
    scope,
    claudeDir: options.claudeDir,
    codexHome: options.codexHome,
  })
  if (options.glossary === false) delete report.glossary // cac：--no-glossary => glossary:false
  return options.json ? emitJson(report) + '\n' : emitText(report, Boolean(options.byRepo))
}
