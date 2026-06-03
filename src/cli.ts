#!/usr/bin/env node
import { cac } from 'cac'
import { resolveWindow } from './window.js'
import { buildReport, VERSION, claudeProjectsDir, codexHome, type Platform, type Scope } from './index.js'
import { emitJson } from './emit/json.js'
import { emitText } from './emit/text.js'
import { listClaudeSessions, listCodexSessions, type SessionsOpts } from './sessions.js'

const PLATFORMS: Platform[] = ['claude-code', 'codex', 'all']
const SCOPES: Scope[] = ['global', 'project', 'session']

const cli = cac('ccoach')

cli
  .command('[...filter]', '本机 AI 用量教练：只读分析 Claude Code / Codex 用量与习惯')
  .option('--date <date>', '单日窗口 (YYYY-MM-DD)')
  .option('--since <date>', '从某日至今 (YYYY-MM-DD)')
  .option('--days <n>', '最近 N 天（含今天）')
  .option('--by-repo', '展开全部仓库（默认仅前 8）')
  .option('--platform <platform>', '数据源：claude-code | codex | all', { default: 'all' })
  .option('--scope <scope>', '分析层级：global | project | session（额外给 projects[]/sessions_detail[]）', { default: 'global' })
  .option('--json', '输出机器可读 JSON（agent 友好）')
  .option('--no-glossary', '省略 glossary 自描述块（省 ~2KB token）')
  .action((_filter: string[], options: Record<string, unknown>) => {
    try {
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
  .command('sessions', '会话候选清单 + opt-in 单会话 redacted prompt 预览（content-layer review）')
  .option('--platform <platform>', '数据源：claude-code | codex', { default: 'claude-code' })
  .option('--date <date>', '单日窗口 (YYYY-MM-DD)')
  .option('--since <date>', '从某日至今 (YYYY-MM-DD)')
  .option('--days <n>', '最近 N 天（含今天）')
  .option('--repo <substr>', '按 repo 名/路径子串过滤')
  .option('--id <sessionId>', '钻取的会话 id（子串匹配）')
  .option('--rollout <path>', 'Codex：指定 rollout JSONL 路径')
  .option('--top <n>', '候选清单条数', { default: 20 })
  .option('--include-user-prompts', 'opt-in：产出单会话脱敏 prompt 预览（隐私门控）')
  .option('--prompt-char-limit <n>', 'prompt 预览截断长度（码点）', { default: 1200 })
  .action((options: Record<string, unknown>) => {
    try {
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
