// eval-judge.mjs — the EVAL step. Scores ONE deepinsight finding on the 6-criterion
// rubric, each 0-1, reproducibly. This is the loop's "loss": a verifiable quality signal.
//
// Phase 0 implements the DETERMINISTIC floor (no LLM, no network, no content):
//   C2 semantic-not-metric · C4 official-feature-only (hard gate) · C6 novel-vs-prior.
// The subjective criteria (C1 grounded-in-window, C3 actionable, C5 survives-falsification)
// are scored 'N/A' here and wired up in Phase 1 with bias-defended judging + opt-in digest.
//
// A finding is the deepinsight schema object:
//   { title, category, confidence, root_cause, fix, feature, signal }
//
// Usage:
//   echo '<finding-json>' | node eval-judge.mjs [--accepted <accepted.json>]
//   node eval-judge.mjs --finding <finding.json> [--accepted <accepted.json>]
// Output: { title, per_criterion, applicable, quality, rejected, cost }

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ── C2: semantic-not-metric (deterministic) ─────────────────────────────────────
const METRIC_SUBJECT_RE = /^\W*(your |the |a |an )?(spirals?|severity|edit[ -]?rings?|pass.?rate|episodes?|structured.?ratio|error.?rate|tokens?|cache.?hit|autonomy.?rate|corrected.?rate|interrupted.?rate)\b/i
const METRIC_TOKEN_RE = /\b(spirals?|severity|edit[ -]?rings?|pass.?rate|episodes?|structured.?ratio|error.?rate|autonomy.?rate|corrected.?rate|interrupted.?rate|cache.?hit.?rate)\b/gi

export function scoreC2(finding) {
  const headline = String(finding.headline || finding.title || '').trim()
  const root = String(finding.root_cause || '')
  if (METRIC_SUBJECT_RE.test(headline)) return { score: 0, why: 'headline leads with a raw metric (machine-speak)' }
  const bodyHits = (headline.match(METRIC_TOKEN_RE) || []).length + (root.match(METRIC_TOKEN_RE) || []).length
  if (bodyHits > 1) return { score: 0.5, why: `${bodyHits} metric tokens leaked into headline/root_cause` }
  return { score: 1, why: 'semantic root cause; metrics demoted to the signal line' }
}

// ── C4: official-feature-only (deterministic, HARD GATE) ─────────────────────────
const OFFICIAL = [
  'plan mode', 'file references', '@file references', 'posttooluse hook', 'pretooluse hook', 'hook',
  'settings.json', '.claude/settings.json', '/clear', '/compact', 'clear', 'compact',
  'subagents', 'subagent', 'claude.md', 'agents.md', 'commands block', 'module map',
  'skills', 'slash command', 'slash commands', 'output styles', 'memory',
]
// third-party / community HABIT skills are a hard fail (PRD non-negotiable).
const THIRD_PARTY_RE = /\b(superpowers|document-skills|habit skill|community skill|third[- ]party)\b|\b[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*\b/i

function norm(s) {
  return String(s || '').toLowerCase().replace(/[`*_]/g, '').trim()
}
function isOfficial(feat) {
  const f = norm(feat)
  return OFFICIAL.some((o) => f === o || f.includes(o))
}

export function scoreC4(finding) {
  const feat = String(finding.feature || '').trim()
  const fix = String(finding.fix || '')
  if (THIRD_PARTY_RE.test(feat) || THIRD_PARTY_RE.test(fix)) {
    return { score: 0, hard_fail: true, why: 'recommends a third-party / community habit skill (not an official native feature)' }
  }
  if (!feat) return { score: 1, why: 'no feature named — legitimate (a workflow/code fix can stand alone)' }
  if (isOfficial(feat)) return { score: 1, why: 'official native feature' }
  return { score: 0.5, why: 'feature not recognized in the official whitelist — verify against current docs' }
}

// ── C6: novel-vs-prior (deterministic, against the ledger's accepted_findings) ───
function tripleKey(f) {
  return [norm(f.category), norm(f.feature), norm(f.hot_file || f.file || '')].join('|')
}
export function scoreC6(finding, accepted = []) {
  const key = tripleKey(finding)
  const cat = norm(finding.category)
  let sameCatDiffFix = false
  for (const a of accepted) {
    if (tripleKey(a) === key) return { score: 0, why: 'near-duplicate of an already-accepted finding' }
    if (norm(a.category) === cat) sameCatDiffFix = true
  }
  if (sameCatDiffFix) return { score: 0.5, why: 'same category as a prior finding, different fix' }
  return { score: 1, why: 'new (category, feature, hot-file) triple' }
}

// ── aggregate ───────────────────────────────────────────────────────────────────
export function aggregate(perCriterion) {
  const applicable = Object.entries(perCriterion).filter(([, v]) => v && v.score !== 'N/A' && v.score != null)
  const mean = applicable.length ? applicable.reduce((s, [, v]) => s + Number(v.score), 0) / applicable.length : 0
  const c4 = perCriterion.C4
  const rejected = !!(c4 && c4.hard_fail)
  return {
    applicable: applicable.map(([k]) => k),
    quality: Math.round(mean * 1000) / 1000,
    rejected,
  }
}

export function evaluate(finding, accepted = []) {
  const perCriterion = {
    C1: { score: 'N/A', why: 'grounded-in-window — wired in Phase 1 (grounding.mjs)' },
    C2: scoreC2(finding),
    C3: { score: 'N/A', why: 'actionable judge — wired in Phase 1' },
    C4: scoreC4(finding),
    C5: { score: 'N/A', why: 'survives-falsification — wired in Phase 1 (opt-in tight digest)' },
    C6: scoreC6(finding, accepted),
  }
  const agg = aggregate(perCriterion)
  return {
    title: finding.title || finding.headline || '(untitled)',
    per_criterion: perCriterion,
    applicable: agg.applicable,
    quality: agg.quality,
    rejected: agg.rejected,
    cost: { judge_llm_calls: 0, digest_runs: 0 },
  }
}

// ── I/O ─────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--finding') { a.finding = argv[++i] }
    else if (argv[i] === '--accepted') { a.accepted = argv[++i] }
  }
  return a
}
function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  const raw = a.finding ? readFileSync(a.finding, 'utf8') : readStdin()
  if (!raw.trim()) {
    process.stderr.write('usage: echo <finding-json> | node eval-judge.mjs [--accepted <accepted.json>]\n')
    process.exit(1)
  }
  const finding = JSON.parse(raw)
  let accepted = []
  if (a.accepted) {
    try {
      const j = JSON.parse(readFileSync(a.accepted, 'utf8'))
      accepted = Array.isArray(j) ? j : Array.isArray(j?.accepted_findings) ? j.accepted_findings : []
    } catch {}
  }
  const findings = Array.isArray(finding) ? finding : [finding]
  const results = findings.map((f) => evaluate(f, accepted))
  process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
