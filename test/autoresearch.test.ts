// autoresearch loop regression — the verifiable floor of the self-evolving deep-insight loop.
// Asserts the eval rubric's deterministic criteria, the probe distillation/anomaly ranking,
// and the strategy ledger's privacy guard + iteration accounting.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs, no types
import { scoreC2, scoreC4, scoreC6, aggregate, evaluate } from '../skills/ccoach-autoresearch/scripts/eval-judge.mjs'
// @ts-expect-error — plain .mjs, no types
import { distillEpisodes, computeAnomalies, buildProbe } from '../skills/ccoach-autoresearch/scripts/probe-runner.mjs'
// @ts-expect-error — plain .mjs, no types
import { defaultLedger, appendIteration, assertClean, redactTitle, hashStrategy, defaultStrategy } from '../skills/ccoach-autoresearch/scripts/strategy-update.mjs'

describe('eval-judge — deterministic rubric floor', () => {
  it('C4 hard-fails a third-party / community habit skill', () => {
    const r = scoreC4({ feature: 'superpowers:brainstorming', fix: 'install the brainstorming skill' })
    expect(r.score).toBe(0)
    expect(r.hard_fail).toBe(true)
  })

  it('C4 hard-fails a plugin-namespaced skill even named only in the fix', () => {
    const r = scoreC4({ feature: '', fix: 'add the foo-habits:daily skill to your flow' })
    expect(r.score).toBe(0)
    expect(r.hard_fail).toBe(true)
  })

  it('C4 passes an official native feature and an empty feature', () => {
    expect(scoreC4({ feature: 'plan mode', fix: 'open in plan mode first' }).score).toBe(1)
    expect(scoreC4({ feature: 'PostToolUse hook', fix: 'add a .claude/settings.json hook' }).score).toBe(1)
    expect(scoreC4({ feature: '', fix: 'split the oversized module' }).score).toBe(1)
  })

  it('C2 fails when the headline IS a metric, passes a semantic headline', () => {
    expect(scoreC2({ title: 'Spiral rate is 0.21 across episodes', root_cause: 'x' }).score).toBe(0)
    expect(scoreC2({ title: 'You re-discover where logic lives each session', root_cause: 'no module map in the guide' }).score).toBe(1)
  })

  it('C2 demotes (0.5) when extra metric tokens leak into the body', () => {
    const r = scoreC2({ title: 'Edits land blind without a verify gate', root_cause: 'high error rate and spiral severity recur' })
    expect(r.score).toBe(0.5)
  })

  it('C6 scores novelty against the ledger accepted findings', () => {
    const accepted = [{ category: 'workflow', feature: 'PostToolUse hook', hot_file: '<settings.json>' }]
    expect(scoreC6({ category: 'cognitive_gap', feature: 'CLAUDE.md', hot_file: '<x>' }, accepted).score).toBe(1)
    expect(scoreC6({ category: 'workflow', feature: '@file references', hot_file: '<y>' }, accepted).score).toBe(0.5)
    expect(scoreC6({ category: 'workflow', feature: 'PostToolUse hook', hot_file: '<settings.json>' }, accepted).score).toBe(0)
  })

  it('aggregate excludes N/A criteria and flags hard-fail rejection', () => {
    const rej = evaluate({ title: 'Use the cool skill', category: 'workflow', feature: 'superpowers:tdd', fix: 'install it' })
    expect(rej.rejected).toBe(true)
    expect(rej.applicable).not.toContain('C1') // N/A in this phase
    const ok = evaluate({ title: 'Logic is re-discovered each session', category: 'cognitive_gap', feature: 'CLAUDE.md', fix: 'add a module map', signal: 'each session re-greps' })
    expect(ok.rejected).toBe(false)
    expect(ok.quality).toBeGreaterThan(0.9)
  })
})

describe('probe-runner — distillation + anomaly ranking', () => {
  const episodeJson = {
    episode_summary: { episodes: 100, spiral_episodes: 40, deepest_pit: { severity: 4 }, task_mix: {} },
    episodes_detail: Array.from({ length: 60 }, (_, i) => ({
      session_id: `s${i}`,
      index: i,
      max_edits_per_file: i % 9,
      spiral: { severity: i < 40 ? (i % 4) + 1 : 0 },
    })),
  }

  it('keeps only spiral>0 episodes, caps the subset, but preserves the full count', () => {
    const d = distillEpisodes(episodeJson, 25)
    expect(d.total_episodes).toBe(60)
    expect(d.spiral_count).toBe(40) // full count preserved
    expect(d.spiral_subset.length).toBe(25) // capped
    expect(d.truncated).toBe(true)
    expect(d.spiral_subset.every((e: any) => e.spiral.severity > 0)).toBe(true)
    // sorted worst-first
    expect(d.spiral_subset[0].spiral.severity).toBeGreaterThanOrEqual(d.spiral_subset[24].spiral.severity)
  })

  it('ranks dimensions deterministically; verify_gate fires when tests exist but no hook', () => {
    const projectJson = {
      episode_summary: episodeJson.episode_summary,
      error_signals: { error_rate: 0.05 },
      rework_signals: { user_modified_rate: 0 },
      prompt_signals: { file_ref_ratio: 0.07, structured_ratio: 0.01, correction_rate: 0.0 },
      environment: { permission_modes: [{ command: 'auto', count: 100 }, { command: 'plan', count: 1 }] },
      project_management: { repos_with_tests: 0 },
    }
    const d = distillEpisodes(episodeJson, 25)
    const a = computeAnomalies(projectJson, d, { hasTestableManifest: true, hasVerifyHook: false })
    const byName = Object.fromEntries(a.dimensions.map((x: any) => [x.name, x.score]))
    expect(byName.verify_gate).toBeGreaterThan(0.8) // testable manifest, no hook → high
    expect(byName.feature_gap).toBeGreaterThan(0.5) // spirals present, plan mode barely used
    expect(a.ranked[0].score).toBeGreaterThanOrEqual(a.ranked[a.ranked.length - 1].score)
  })

  it('buildProbe emits a bounded probe with an honest token cost', () => {
    const probe = buildProbe({ platform: 'claude-code', window: '--days 30', projectJson: { episode_summary: episodeJson.episode_summary }, episodeJson, localMeta: { present: true }, repoSignals: { repo: '<r>' } })
    expect(probe.schema).toBe('autoresearch-probe/1')
    expect(probe.episodes.spiral_subset.length).toBeLessThanOrEqual(25)
    expect(probe.cost.cli_calls).toBe(2)
    expect(probe.cost.distilled_tokens_in).toBeGreaterThan(0)
  })
})

describe('strategy-update — ledger accounting + privacy guard', () => {
  it('defaultLedger carries a stable strategy hash and a bandit arm per dimension + inaction', () => {
    const l = defaultLedger('claude-code', 'demo')
    expect(l.strategy.strategy_hash).toMatch(/^[0-9a-f]{8}$/)
    expect(l.strategy.dimension_bandit.inaction).toEqual({ alpha: 1, beta: 1 })
    expect(hashStrategy(defaultStrategy())).toMatch(/^[0-9a-f]{8}$/)
  })

  it('appendIteration records quality, cost and quality-per-1k-tokens', () => {
    const l = defaultLedger('claude-code', 'demo')
    const row = appendIteration(l, { quality: 0.8, cost: { cli_calls: 2, tokens_in: 4000, digest_runs: 0 }, ts: '2026-06-09' })
    expect(l.iterations.length).toBe(1)
    expect(row.quality).toBe(0.8)
    expect(row.quality_per_1k_tokens).toBe(0.2) // 0.8 / (4000/1000)
  })

  it('redactTitle desensitizes real paths', () => {
    expect(redactTitle('edits in /Users/mac/workspace/ccoach/src/model.ts churn')).not.toMatch(/\/Users\//)
    expect(redactTitle('edits in /Users/mac/secret.ts')).toContain('<…>')
  })

  it('assertClean throws if a real path or an over-long blob slips into the ledger', () => {
    const l = defaultLedger('claude-code', 'demo')
    l.accepted_findings.push({ category: 'x', feature: '', hot_file: '', title: 'leaked /Users/mac/secret/file.ts here' })
    expect(() => assertClean(l)).toThrow()
    const l2 = defaultLedger('claude-code', 'demo')
    l2.lessons.push({ ts: '2026-06-09', criterion: 'C2', critique: 'x'.repeat(5000) })
    expect(() => assertClean(l2)).toThrow()
  })

  it('a clean aggregate-only ledger passes the guard', () => {
    const l = defaultLedger('claude-code', 'demo')
    appendIteration(l, { quality: 0.7, cost: { tokens_in: 5000 }, ts: '2026-06-09' })
    l.accepted_findings.push({ category: 'workflow', feature: 'PostToolUse hook', hot_file: '<settings.json>', title: '<no auto-verify gate>' })
    expect(assertClean(l)).toBe(true)
  })
})
