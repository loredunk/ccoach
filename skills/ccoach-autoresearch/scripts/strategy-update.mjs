// strategy-update.mjs — the OPTIMIZE step + the persistent ledger.
//
// The ledger is the loop's "weights": a human-readable, diffable JSON per (platform, project)
// holding the strategy (probe order, dimension bandit, framing, digest threshold), the
// verbal-gradient lessons, the accepted findings (for novelty), and the iteration history
// (quality x cost — the climb you can read).
//
// PRIVACY: pure aggregate. Stores dimension names / scores / counts / DESENSITIZED finding
// titles only. Zero prompt text, zero assistant/digest content. Every write runs assertClean()
// which throws if any value looks like a real path or an over-long blob.
//
// Phase 0 does the minimum: create the ledger if absent and append ONE iterations[] row.
// Strategy mutation (verbal-gradient lessons, bandit posterior, framing edits) lands in Phase 1/2.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const DIMENSIONS = ['spiral_deepest_pit', 'rework_loop', 'prompt_quality', 'verify_gate', 'feature_gap', 'error_density']

export function defaultStrategy() {
  const dimension_bandit = {}
  for (const d of [...DIMENSIONS, 'inaction']) dimension_bandit[d] = { alpha: 1, beta: 1 }
  const strategy = {
    dimension_order: [...DIMENSIONS],
    dimension_bandit,
    framing: 'Lead with the semantic root cause in plain language; name one official native feature; demote every metric to the signal line.',
    digest_threshold: { trigger: 'session_intent_claim && confidence>=high', budget: 'tight' },
  }
  strategy.strategy_hash = hashStrategy(strategy)
  return strategy
}

export function hashStrategy(strategy) {
  const { strategy_hash, ...rest } = strategy || {}
  return createHash('sha1').update(JSON.stringify(rest)).digest('hex').slice(0, 8)
}

export function defaultLedger(platform, project) {
  return {
    version: 1,
    key: { platform, project },
    updated_at: null,
    strategy: defaultStrategy(),
    lessons: [],
    accepted_findings: [],
    iterations: [],
    ab: [],
  }
}

function slug(s) {
  return String(s || 'unknown').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown'
}

export function ledgerPath(dir, platform, project) {
  return path.join(dir, `${slug(platform)}--${slug(project)}.json`)
}

export function loadOrInit(dir, platform, project) {
  const p = ledgerPath(dir, platform, project)
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      /* corrupt → reinit */
    }
  }
  return defaultLedger(platform, project)
}

export function appendIteration(ledger, { quality, cost, strategy_hash, ts, accepted_findings_delta = 0 }) {
  const tokens_in = Number(cost?.tokens_in ?? cost?.distilled_tokens_in ?? 0)
  const row = {
    ts,
    strategy_hash: strategy_hash || ledger?.strategy?.strategy_hash || null,
    quality: round(quality),
    cost: {
      cli_calls: Number(cost?.cli_calls ?? 0),
      tokens_in,
      digest_runs: Number(cost?.digest_runs ?? 0),
      wall_ms: Number(cost?.wall_ms ?? 0),
    },
    quality_per_1k_tokens: tokens_in ? round((Number(quality) || 0) / (tokens_in / 1000)) : null,
    accepted_findings_delta,
  }
  ledger.iterations = [...(ledger.iterations || []), row]
  return row
}

function round(x) {
  return Math.round((Number(x) || 0) * 1000) / 1000
}

// ── privacy guard ───────────────────────────────────────────────────────────────
const PATHLIKE_RE = /(^|[\s"'`])(\/(Users|home|var|tmp|etc)\/|[A-Za-z]:\\|~\/)[^\s"'`]+/
const MAX_FIELD = 200

export function redactTitle(s) {
  return String(s || '')
    .replace(/(\/(Users|home|var|tmp|etc)\/[^\s"'`]+|[A-Za-z]:\\[^\s"'`]+|~\/[^\s"'`]+)/g, '<…>')
    .slice(0, MAX_FIELD)
}

// Throws if the ledger carries anything that smells like real content (a path, an over-long blob).
export function assertClean(ledger) {
  const visit = (v, where) => {
    if (typeof v === 'string') {
      if (v.length > 4000) throw new Error(`ledger field too long (${where}); refusing to persist possible content`)
      if (PATHLIKE_RE.test(v)) throw new Error(`ledger field looks like a real path (${where}); desensitize to <…> first`)
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${where}[${i}]`))
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) visit(x, `${where}.${k}`)
    }
  }
  visit(ledger, 'ledger')
  return true
}

// ── I/O ─────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { platform: 'claude-code', project: 'unknown', dir: path.join(os.homedir(), '.ccoach', 'autoresearch') }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = argv[i + 1]
    if (k === '--platform') { a.platform = v; i++ }
    else if (k === '--project') { a.project = v; i++ }
    else if (k === '--quality') { a.quality = Number(v); i++ }
    else if (k === '--cost') { a.cost = v; i++ }
    else if (k === '--ledger-dir') { a.dir = v; i++ }
    else if (k === '--accepted-add') { a.acceptedAdd = v; i++ }
    else if (k === '--ts') { a.ts = v; i++ }
  }
  return a
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  const ledger = loadOrInit(a.dir, a.platform, a.project)
  const cost = a.cost ? safeJson(a.cost) : {}
  const ts = a.ts || new Date().toISOString().slice(0, 10)

  let delta = 0
  if (a.acceptedAdd) {
    const adds = safeJson(a.acceptedAdd)
    const list = Array.isArray(adds) ? adds : [adds]
    for (const f of list) {
      ledger.accepted_findings.push({
        category: f.category || 'other',
        feature: f.feature || '',
        hot_file: redactTitle(f.hot_file || f.file || ''),
        title: redactTitle(f.title || f.headline || ''),
      })
      delta++
    }
  }

  const row = appendIteration(ledger, {
    quality: Number.isFinite(a.quality) ? a.quality : 0,
    cost,
    strategy_hash: ledger.strategy?.strategy_hash,
    ts,
    accepted_findings_delta: delta,
  })
  ledger.updated_at = ts

  assertClean(ledger) // privacy gate — throws before any write if content leaked in

  if (!existsSync(a.dir)) mkdirSync(a.dir, { recursive: true })
  const p = ledgerPath(a.dir, a.platform, a.project)
  writeFileSync(p, JSON.stringify(ledger, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ ledger: p, appended: row, iterations: ledger.iterations.length }, null, 2) + '\n')
}

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
