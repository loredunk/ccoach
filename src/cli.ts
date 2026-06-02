#!/usr/bin/env node
import { cac } from 'cac'
import { resolveWindow } from './window.js'
import { buildReport, VERSION, type Platform } from './index.js'
import { emitJson } from './emit/json.js'
import { emitText } from './emit/text.js'

const PLATFORMS: Platform[] = ['claude-code', 'codex', 'all']

const cli = cac('ccoach')

cli
  .command('[...filter]', '本机 AI 用量教练：只读分析 Claude Code / Codex 用量与习惯')
  .option('--date <date>', '单日窗口 (YYYY-MM-DD)')
  .option('--since <date>', '从某日至今 (YYYY-MM-DD)')
  .option('--days <n>', '最近 N 天（含今天）')
  .option('--by-repo', '展开全部仓库（默认仅前 8）')
  .option('--platform <platform>', '数据源：claude-code | codex | all', { default: 'all' })
  .option('--json', '输出机器可读 JSON（agent 友好）')
  .action((_filter: string[], options: Record<string, unknown>) => {
    try {
      const platform = String(options.platform ?? 'all') as Platform
      if (!PLATFORMS.includes(platform)) {
        throw new Error(`invalid --platform ${platform} (want claude-code|codex|all)`)
      }
      const daysRaw = options.days
      const days = daysRaw != null ? Number(daysRaw) : undefined
      if (days !== undefined && !Number.isFinite(days)) {
        throw new Error(`invalid --days ${String(daysRaw)}`)
      }
      const window = resolveWindow(
        {
          date: options.date as string | undefined,
          since: options.since as string | undefined,
          days,
        },
        new Date(),
      )
      const report = buildReport({ platform, window })
      const out = options.json ? emitJson(report) + '\n' : emitText(report, Boolean(options.byRepo))
      process.stdout.write(out)
    } catch (e) {
      process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n')
      process.exit(1)
    }
  })

cli.help()
cli.version(VERSION)
cli.parse()
