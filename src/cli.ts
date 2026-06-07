#!/usr/bin/env node
import { cac } from 'cac'
import { resolveWindow } from './window.js'
import { setLang } from './i18n.js'
import { VERSION, claudeProjectsDir, codexHome } from './index.js'
import { runReport, type ReportCliOptions } from './run-report.js'
import { listClaudeSessions, listCodexSessions, type SessionsOpts } from './sessions.js'
import { buildDigest, buildCodexDigest, BUDGETS, type DigestBudget } from './digest.js'

const cli = cac('ccoach')

cli
  .command('[...filter]', 'Local AI usage coach: read-only analysis of Claude Code / Codex usage & habits')
  .option('--date <date>', 'Single-day window (YYYY-MM-DD)')
  .option('--since <date>', 'From a date until today (YYYY-MM-DD)')
  .option('--days <n>', 'Last N days (including today)')
  .option('--by-repo', 'Expand all repos (default: top 8 only)')
  .option('--platform <platform>', 'Data source: claude-code | codex | all', { default: 'all' })
  .option('--claude-dir <dir>', 'Override Claude data dir: path to the projects dir directly (e.g. ~/.claude/projects); bypasses CLAUDE_CONFIG_DIR/projects')
  .option('--codex-home <dir>', 'Override Codex data dir: path to the Codex home (reads <dir>/sessions; e.g. ~/.codex)')
  .option('--scope <scope>', 'Analysis level: global | project | session | episode (adds projects[]/sessions_detail[]/episodes_detail[])', { default: 'global' })
  .option('--lang <lang>', 'Output language: en | zh (default en)', { default: 'en' })
  .option('--json', 'Emit machine-readable JSON (agent-friendly)')
  .option('--no-glossary', 'Omit the self-describing glossary block (~2KB token savings)')
  .action((_filter: string[], options: Record<string, unknown>) => {
    try {
      process.stdout.write(runReport(options as unknown as ReportCliOptions))
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

// 正文摘要钻取（ADR 0049）：opt-in、token 受控、redacted（assistant 回复 + tool_result，不含 thinking）。
cli
  .command('digest', 'opt-in token-bounded redacted content digest of ONE session (assistant replies + tool_result; no thinking/reasoning)')
  .option('--platform <platform>', 'Data source: claude-code | codex', { default: 'claude-code' })
  .option('--id <sessionId>', 'Session id to digest (substring match) — REQUIRED; names ONE session (no time window)')
  .option('--claude-dir <dir>', 'Override Claude data dir (path to projects dir)')
  .option('--codex-home <dir>', 'Override Codex home (reads <dir>/sessions)')
  .option('--budget <budget>', 'Token budget: tight (~7.5K) | rich (~30K)', { default: 'tight' })
  .option('--per-item <n>', 'Override per-item code-point cap')
  .option('--max-total <n>', 'Override total code-point cap')
  .option('--lang <lang>', 'Output language: en | zh', { default: 'en' })
  .action((options: Record<string, unknown>) => {
    try {
      setLang(options.lang as string | undefined)
      const platform = String(options.platform ?? 'claude-code')
      if (platform !== 'claude-code' && platform !== 'codex') throw new Error(`digest supports --platform claude-code|codex (got ${platform})`)
      if (!options.id) throw new Error('digest requires --id <sessionId> (opt-in, single session only)')
      const budget = String(options.budget ?? 'tight') as DigestBudget
      if (budget !== 'tight' && budget !== 'rich') throw new Error(`invalid --budget ${budget} (want tight|rich)`)
      const base = BUDGETS[budget]
      const perItem = options.perItem != null ? Number(options.perItem) : base.perItem
      const maxTotal = options.maxTotal != null ? Number(options.maxTotal) : base.maxTotal
      const sessionId = String(options.id)
      const out = platform === 'codex'
        ? buildCodexDigest((options.codexHome as string | undefined) || codexHome(), { sessionId, perItem, maxTotal })
        : buildDigest((options.claudeDir as string | undefined) || claudeProjectsDir(), { sessionId, perItem, maxTotal })
      process.stdout.write(JSON.stringify(out, null, 2) + '\n')
    } catch (e) {
      process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n')
      process.exit(1)
    }
  })

cli.help()
cli.version(VERSION)
cli.parse()
