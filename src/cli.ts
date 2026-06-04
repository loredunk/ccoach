#!/usr/bin/env node
import { cac } from 'cac'
import { resolveWindow } from './window.js'
import { setLang } from './i18n.js'
import { buildReport, VERSION, claudeProjectsDir, codexHome, type Platform, type Scope } from './index.js'
import { emitJson } from './emit/json.js'
import { emitText } from './emit/text.js'
import { listClaudeSessions, listCodexSessions, type SessionsOpts } from './sessions.js'

const PLATFORMS: Platform[] = ['claude-code', 'codex', 'all']
const SCOPES: Scope[] = ['global', 'project', 'session']

const cli = cac('ccoach')

cli
  .command('[...filter]', 'Local AI usage coach: read-only analysis of Claude Code / Codex usage & habits')
  .option('--date <date>', 'Single-day window (YYYY-MM-DD)')
  .option('--since <date>', 'From a date until today (YYYY-MM-DD)')
  .option('--days <n>', 'Last N days (including today)')
  .option('--by-repo', 'Expand all repos (default: top 8 only)')
  .option('--platform <platform>', 'Data source: claude-code | codex | all', { default: 'all' })
  .option('--scope <scope>', 'Analysis level: global | project | session (adds projects[]/sessions_detail[])', { default: 'global' })
  .option('--lang <lang>', 'Output language: en | zh (default en)', { default: 'en' })
  .option('--json', 'Emit machine-readable JSON (agent-friendly)')
  .option('--no-glossary', 'Omit the self-describing glossary block (~2KB token savings)')
  .action((_filter: string[], options: Record<string, unknown>) => {
    try {
      setLang(options.lang as string | undefined) // 默认 en；先设语言，再 resolveWindow/buildReport/emit
      const platform = String(options.platform ?? 'all') as Platform
      if (!PLATFORMS.includes(platform)) {
        throw new Error(`invalid --platform ${platform} (want claude-code|codex|all)`)
      }
      const scope = String(options.scope ?? 'global') as Scope
      if (!SCOPES.includes(scope)) {
        throw new Error(`invalid --scope ${scope} (want global|project|session)`)
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
      const report = buildReport({ platform, window, scope })
      if (options.glossary === false) delete report.glossary // cac：--no-glossary => glossary:false
      const out = options.json ? emitJson(report) + '\n' : emitText(report, Boolean(options.byRepo))
      process.stdout.write(out)
    } catch (e) {
      process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n')
      process.exit(1)
    }
  })

// 会话钻取：候选清单（数值、零原文）+ opt-in 单会话 redacted prompt 预览（ADR 0018）。
cli
  .command('sessions', 'Session candidate list + opt-in single-session redacted prompt preview (content-layer review)')
  .option('--platform <platform>', 'Data source: claude-code | codex', { default: 'claude-code' })
  .option('--date <date>', 'Single-day window (YYYY-MM-DD)')
  .option('--since <date>', 'From a date until today (YYYY-MM-DD)')
  .option('--days <n>', 'Last N days (including today)')
  .option('--repo <substr>', 'Filter by repo name/path substring')
  .option('--id <sessionId>', 'Session id to drill into (substring match)')
  .option('--rollout <path>', 'Codex: explicit rollout JSONL path')
  .option('--top <n>', 'Number of candidates to list', { default: 20 })
  .option('--include-user-prompts', 'opt-in: emit single-session redacted prompt preview (privacy-gated)')
  .option('--prompt-char-limit <n>', 'Prompt preview truncation length (code points)', { default: 1200 })
  .option('--lang <lang>', 'Output language: en | zh (default en)', { default: 'en' })
  .action((options: Record<string, unknown>) => {
    try {
      setLang(options.lang as string | undefined)
      const platform = String(options.platform ?? 'claude-code')
      if (platform !== 'claude-code' && platform !== 'codex') {
        throw new Error(`invalid --platform ${platform} (want claude-code|codex)`)
      }
      const daysRaw = options.days
      const days = daysRaw != null ? Number(daysRaw) : undefined
      if (days !== undefined && !Number.isFinite(days)) throw new Error(`invalid --days ${String(daysRaw)}`)
      const window = resolveWindow(
        { date: options.date as string | undefined, since: options.since as string | undefined, days },
        new Date(),
      )
      const includePrompts = options.includeUserPrompts === true
      // Codex 预览需显式选择会话（延续 session_drilldown 的 opt-in 门控）；Claude 缺 id 时自动选 token 最高单会话（ADR 0015）。
      if (platform === 'codex' && includePrompts && !options.id && !options.rollout) {
        throw new Error('codex --include-user-prompts requires --id or --rollout')
      }
      const topRaw = options.top
      const opts: SessionsOpts = {
        repo: options.repo as string | undefined,
        sessionId: options.id as string | undefined,
        rollout: options.rollout as string | undefined,
        top: topRaw != null ? Number(topRaw) : 20,
        includePrompts,
        promptCharLimit: options.promptCharLimit != null ? Number(options.promptCharLimit) : 1200,
      }
      const out =
        platform === 'codex'
          ? listCodexSessions(codexHome(), window, opts)
          : listClaudeSessions(claudeProjectsDir(), window, opts)
      process.stdout.write(JSON.stringify(out, null, 2) + '\n')
    } catch (e) {
      process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n')
      process.exit(1)
    }
  })

cli.help()
cli.version(VERSION)
cli.parse()
