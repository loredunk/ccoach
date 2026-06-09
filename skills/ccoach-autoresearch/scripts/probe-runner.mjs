// probe-runner.mjs — the EXTRACT step of the autoresearch loop.
//
// Runs the MINIMAL high-signal probe over the existing `ccoach --json` contract,
// distills the biggest token sink (full episodes_detail) down to the spiral-flagged
// subset, reads a few zero-cost local metadata signals, and computes a deterministic
// per-dimension anomaly rank so the loop can drill the 1-3 "magic" dimensions that
// actually matter for THIS project instead of analysing everything.
//
// PRIVACY: read-only. Shells the read-only ccoach CLI + read-only git, and reads only
// labels / counts / precomputed aggregates from ~/.claude (stats-cache.json firstSessionDate,
// tasks/*.json status enum). NEVER reads prompt / assistant / thinking / file content.
// Emits aggregate numbers only — no prompt text ever leaves this script.
//
// Pure functions (distill / anomaly / readers) are exported for vitest; I/O lives in main().

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── pure: distillation ────────────────────────────────────────────────────────

// Keep ONLY deepest_pit + the spiral.severity>0 subset of episodes_detail, dropping
// the ~200-record / ~210KB dump. This is the single biggest token saving in the loop.
const SPIRAL_CAP = 25 // hand the model the worst N pits, not all of them — bounds the probe

export function distillEpisodes(episodeJson, cap = SPIRAL_CAP) {
  const detail = Array.isArray(episodeJson?.episodes_detail) ? episodeJson.episodes_detail : []
  const flagged = detail
    .filter((e) => e && e.spiral && Number(e.spiral.severity) > 0)
    .map((e) => ({
      session_id: e.session_id,
      repo: e.repo,
      index: e.index,
      start_ts: e.start_ts,
      end_ts: e.end_ts,
      tokens: e.tokens,
      tool_calls: e.tool_calls,
      files_touched: e.files_touched,
      max_edits_per_file: e.max_edits_per_file,
      error_count: e.error_count,
      error_rate: e.error_rate,
      end_type: e.end_type,
      task_type: e.task_type,
      spiral: e.spiral,
    }))
    .sort((a, b) => (b.spiral?.severity || 0) - (a.spiral?.severity || 0))
  return {
    total_episodes: detail.length,
    spiral_count: flagged.length, // full count is preserved even when the list is capped
    truncated: flagged.length > cap,
    deepest_pit: episodeJson?.episode_summary?.deepest_pit || null,
    spiral_subset: flagged.slice(0, cap),
  }
}

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0))

// ── pure: per-dimension anomaly scoring ─────────────────────────────────────────
// v0 heuristics with documented formulas. Own-history baseline + bandit replace these
// in Phase 2; for the smallest closed loop these absolute thresholds are enough to rank.
export function computeAnomalies(projectJson, distill, repoSignals = {}) {
  const es = projectJson?.episode_summary || {}
  const err = projectJson?.error_signals || {}
  const rw = projectJson?.rework_signals || {}
  const ps = projectJson?.prompt_signals || {}
  const env = projectJson?.environment || {}
  const pm = projectJson?.project_management || {}

  const episodes = Number(es.episodes) || 0
  const spiralRate = episodes ? clamp01((Number(es.spiral_episodes) || 0) / episodes) : 0
  const deepestSeverity = Number(distill?.deepest_pit?.severity || es?.deepest_pit?.severity || 0)
  const maxEdits = (distill?.spiral_subset || []).reduce((m, e) => Math.max(m, Number(e.max_edits_per_file) || 0), 0)

  // permission-mode shares (feature-gap: is plan mode used at all?)
  const modes = Array.isArray(env.permission_modes) ? env.permission_modes : []
  const modeTotal = modes.reduce((s, m) => s + (Number(m.count) || 0), 0)
  const planShare = modeTotal ? (modes.find((m) => m.command === 'plan')?.count || 0) / modeTotal : 0

  const dims = [
    {
      name: 'spiral_deepest_pit',
      score: clamp01(spiralRate * 0.7 + (deepestSeverity / 4) * 0.3),
      evidence: { spiral_rate: round(spiralRate), spiral_count: Number(es.spiral_episodes) || 0, deepest_severity: deepestSeverity },
    },
    {
      name: 'rework_loop',
      // user_modified_rate is often 0 (no edits reverted); lean on edit-ring depth.
      score: clamp01((Number(rw.user_modified_rate) || 0) * 0.5 + clamp01(maxEdits / 10) * 0.5),
      evidence: { user_modified_rate: round(Number(rw.user_modified_rate) || 0), max_edits_per_file: maxEdits },
    },
    {
      name: 'prompt_quality',
      // low file-ref + low structure + corrections = thin opener pattern.
      score: clamp01((1 - clamp01(Number(ps.file_ref_ratio) || 0)) * 0.45 + (1 - clamp01(Number(ps.structured_ratio) || 0)) * 0.25 + clamp01((Number(ps.correction_rate) || 0) * 4) * 0.3),
      evidence: { file_ref_ratio: round(Number(ps.file_ref_ratio) || 0), structured_ratio: round(Number(ps.structured_ratio) || 0), correction_rate: round(Number(ps.correction_rate) || 0) },
    },
    {
      name: 'verify_gate',
      // repo has tests/build but no PostToolUse auto-verify hook = edits land blind.
      score: clamp01(repoSignals.hasTestableManifest && !repoSignals.hasVerifyHook ? 0.9 : repoSignals.hasVerifyHook ? 0 : 0.4),
      evidence: { has_testable_manifest: !!repoSignals.hasTestableManifest, has_verify_hook: !!repoSignals.hasVerifyHook, repos_with_tests: Number(pm.repos_with_tests) || 0 },
    },
    {
      name: 'feature_gap',
      // spirals present but plan mode barely used = an official feature is going unused.
      score: clamp01(spiralRate > 0.05 ? 1 - planShare * 5 : 0),
      evidence: { plan_mode_share: round(planShare), spiral_rate: round(spiralRate) },
    },
    {
      name: 'error_density',
      score: clamp01((Number(err.error_rate) || 0) / 0.1),
      evidence: { error_rate: round(Number(err.error_rate) || 0), tool_errors: Number(err.tool_errors) || 0, api_errors: Number(err.api_errors) || 0 },
    },
  ]
  const ranked = [...dims].sort((a, b) => b.score - a.score)
  return { dimensions: dims, ranked: ranked.map((d) => ({ name: d.name, score: round(d.score) })) }
}

function round(x) {
  return Math.round((Number(x) || 0) * 1000) / 1000
}

// ── pure-ish: local ~/.claude metadata (labels/counts/precomputed only, NO bodies) ──
export function readLocalMeta(claudeHome) {
  const meta = { first_session_date: null, speculation_time_saved_ms: null, tasks_status_histogram: null, present: false }
  if (!claudeHome || !existsSync(claudeHome)) return meta
  meta.present = true
  try {
    const statsPath = path.join(claudeHome, 'stats-cache.json')
    if (existsSync(statsPath)) {
      const stats = JSON.parse(readFileSync(statsPath, 'utf8'))
      // precomputed aggregates only — never any message body lives here
      meta.first_session_date = stats.firstSessionDate || stats.firstStartTime || null
      meta.speculation_time_saved_ms = numOrNull(stats.totalSpeculationTimeSavedMs)
    }
  } catch {}
  try {
    // tasks live at tasks/<session-id>/<n>.json — one task object per file.
    // We read ONLY the `status` label (a fixed enum); subject/description are never used or stored.
    const tasksDir = path.join(claudeHome, 'tasks')
    if (existsSync(tasksDir) && statSync(tasksDir).isDirectory()) {
      const hist = { pending: 0, in_progress: 0, completed: 0, other: 0 }
      for (const sess of readdirSync(tasksDir)) {
        const sd = path.join(tasksDir, sess)
        let isDir = false
        try { isDir = statSync(sd).isDirectory() } catch {}
        if (!isDir) continue
        for (const f of readdirSync(sd)) {
          if (!f.endsWith('.json')) continue
          try {
            const obj = JSON.parse(readFileSync(path.join(sd, f), 'utf8'))
            const s = String(obj?.status || 'other') // label only
            if (s in hist) hist[s]++
            else hist.other++
          } catch {}
        }
      }
      meta.tasks_status_histogram = hist
    }
  } catch {}
  return meta
}

function numOrNull(x) {
  return Number.isFinite(Number(x)) ? Number(x) : null
}

// ── pure: assemble the compact probe ────────────────────────────────────────────
export function buildProbe({ platform, window, projectJson, episodeJson, localMeta, repoSignals }) {
  const distill = distillEpisodes(episodeJson || {})
  const anomalies = computeAnomalies(projectJson || {}, distill, repoSignals || {})
  const probe = {
    schema: 'autoresearch-probe/1',
    platform,
    window,
    repo: repoSignals?.repo || null,
    // cheap aggregate signal blocks straight from the project-scope payload
    signals: {
      episode_summary: projectJson?.episode_summary || null,
      error_signals: projectJson?.error_signals || null,
      rework_signals: projectJson?.rework_signals || null,
      prompt_signals: projectJson?.prompt_signals || null,
      project_management: projectJson?.project_management || null,
      git_habits: projectJson?.git_habits || null,
      skills_top: Array.isArray(projectJson?.skills) ? projectJson.skills.slice(0, 10) : null,
      permission_modes: projectJson?.environment?.permission_modes || null,
      models_timeline: projectJson?.models_timeline || null,
    },
    episodes: distill, // distilled — only spiral subset + deepest pit
    local_meta: localMeta || null,
    repo_signals: repoSignals || null,
    anomalies,
  }
  // honest token proxy = chars/4 of everything the model actually ingests (the whole probe minus the cost wrapper)
  probe.cost = {
    cli_calls: 2,
    distilled_tokens_in: Math.round(JSON.stringify(probe).length / 4),
  }
  return probe
}

// ── I/O: resolve ccoach, run the two cheap calls, read local meta, print ────────

function resolveCcoach(override) {
  if (override) return override.split(' ')
  if (process.env.CCOACH_CMD) return process.env.CCOACH_CMD.split(' ')
  const distCli = path.resolve(__dirname, '../../../dist/cli.js')
  if (existsSync(distCli)) return ['node', distCli]
  return ['ccoach'] // on PATH; SKILL.md documents the npx fallback
}

function parseArgs(argv) {
  const a = { platform: 'claude-code', repo: process.cwd(), claudeHome: path.join(os.homedir(), '.claude') }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = argv[i + 1]
    if (k === '--platform') { a.platform = v; i++ }
    else if (k === '--since') { a.since = v; i++ }
    else if (k === '--days') { a.days = v; i++ }
    else if (k === '--date') { a.date = v; i++ }
    else if (k === '--repo') { a.repo = v; i++ }
    else if (k === '--claude-home') { a.claudeHome = v; i++ }
    else if (k === '--claude-dir') { a.claudeDir = v; i++ }
    else if (k === '--codex-home') { a.codexHome = v; i++ }
    else if (k === '--ccoach') { a.ccoach = v; i++ }
  }
  return a
}

function windowArgs(a) {
  if (a.since) return ['--since', a.since]
  if (a.date) return ['--date', a.date]
  if (a.days) return ['--days', String(a.days)]
  return ['--days', '30']
}

// git log speaks --since/--until (not ccoach's --days/--date); translate.
function gitWindowArgs(a) {
  if (a.since) return ['--since', a.since]
  if (a.date) return ['--since', a.date, '--until', `${a.date} 23:59:59`]
  const n = a.days || 30
  return ['--since', `${n} days ago`]
}

function runCcoach(cmd, args) {
  const [bin, ...pre] = cmd
  const out = execFileSync(bin, [...pre, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return JSON.parse(out)
}

function repoFsSignals(repo) {
  const sig = { repo, hasTestableManifest: false, hasVerifyHook: false, hot_files: [] }
  try {
    const pkg = path.join(repo, 'package.json')
    if (existsSync(pkg)) {
      const p = JSON.parse(readFileSync(pkg, 'utf8'))
      sig.hasTestableManifest = !!(p.scripts && (p.scripts.test || p.scripts.typecheck || p.scripts.build))
    }
    if (existsSync(path.join(repo, 'pyproject.toml')) || existsSync(path.join(repo, 'Cargo.toml')) || existsSync(path.join(repo, 'go.mod'))) {
      sig.hasTestableManifest = true
    }
    const settings = path.join(repo, '.claude', 'settings.json')
    if (existsSync(settings)) {
      const s = readFileSync(settings, 'utf8')
      sig.hasVerifyHook = /PostToolUse/.test(s)
    }
  } catch {}
  return sig
}

function gitHotFiles(repo, win) {
  try {
    const args = ['-C', repo, 'log', ...win.map((x) => x), '--pretty=format:', '--name-only']
    const raw = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const counts = new Map()
    for (const line of raw.split('\n')) {
      const f = line.trim()
      if (!f) continue
      counts.set(f, (counts.get(f) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([file, churn]) => ({ file, churn }))
  } catch {
    return []
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  const cmd = resolveCcoach(a.ccoach)
  const win = windowArgs(a)
  const common = ['--platform', a.platform, ...win, '--json', '--no-glossary']
  if (a.claudeDir) common.push('--claude-dir', a.claudeDir)
  if (a.codexHome) common.push('--codex-home', a.codexHome)

  const projectJson = runCcoach(cmd, [...common, '--scope', 'project'])
  let episodeJson = {}
  try {
    episodeJson = runCcoach(cmd, [...common, '--scope', 'episode'])
  } catch {
    episodeJson = {}
  }

  const repoSignals = repoFsSignals(a.repo)
  repoSignals.hot_files = gitHotFiles(a.repo, gitWindowArgs(a))
  // ~/.claude metadata only applies to claude-code
  const localMeta = a.platform === 'codex' ? { present: false, note: 'codex: no ~/.claude metadata' } : readLocalMeta(a.claudeHome)

  const probe = buildProbe({
    platform: a.platform,
    window: win.join(' '),
    projectJson,
    episodeJson,
    localMeta,
    repoSignals,
  })
  process.stdout.write(JSON.stringify(probe, null, 2) + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
