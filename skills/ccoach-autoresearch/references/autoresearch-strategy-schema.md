# strategy ledger — schema

The ledger is the loop's persistent memory: one human-readable, diffable JSON per `(platform, project)`, stored locally at `~/.ccoach/autoresearch/<platform>--<project>.json`. It never leaves the machine and is never synced.

**Privacy:** the ledger is pure aggregate — dimension names, scores, counts, and **desensitized** finding titles only. It carries **zero** prompt text and **zero** assistant/digest content. Every write runs a guard that refuses to persist anything that looks like a real filesystem path or an over-long blob.

```json
{
  "version": 1,
  "key": { "platform": "claude-code", "project": "<repo>" },
  "updated_at": "2026-06-09",
  "strategy": {
    "strategy_hash": "a1b2c3d4",
    "dimension_order": ["verify_gate", "spiral_deepest_pit", "feature_gap"],
    "dimension_bandit": {
      "spiral_deepest_pit": { "alpha": 2, "beta": 3 },
      "rework_loop":        { "alpha": 1, "beta": 1 },
      "prompt_quality":     { "alpha": 1, "beta": 1 },
      "verify_gate":        { "alpha": 4, "beta": 1 },
      "feature_gap":        { "alpha": 3, "beta": 2 },
      "error_density":      { "alpha": 1, "beta": 1 },
      "inaction":           { "alpha": 1, "beta": 1 }
    },
    "framing": "Lead with the semantic root cause; name one official feature; demote every metric to the signal line.",
    "digest_threshold": { "trigger": "session_intent_claim && confidence>=high", "budget": "tight" }
  },
  "lessons": [
    { "ts": "2026-06-08", "criterion": "C2", "critique": "headline restated the spiral rate; lead with the cognitive gap, demote the metric." }
  ],
  "accepted_findings": [
    { "category": "workflow", "feature": "PostToolUse hook", "hot_file": "<settings.json>", "title": "<no auto-verify gate; edits land blind>" }
  ],
  "iterations": [
    { "ts": "2026-06-07", "strategy_hash": "00000000", "quality": 0.62, "cost": { "cli_calls": 2, "tokens_in": 9200, "digest_runs": 0, "wall_ms": 14000 }, "quality_per_1k_tokens": 0.067, "accepted_findings_delta": 1 }
  ],
  "ab": [
    { "ts": "2026-06-09", "incumbent_hash": "00000000", "candidate_hash": "a1b2c3d4",
      "incumbent": { "quality": 0.62, "tokens_in": 9200 }, "candidate": { "quality": 0.81, "tokens_in": 11000 },
      "verdict": "candidate kept: +0.19 quality within cost budget" }
  ]
}
```

## Fields

- **strategy** — the mutable "weights". `dimension_order` is the probe drill order; `dimension_bandit` holds Beta posteriors per dimension (plus an `inaction` arm that prunes dimensions surfacing nothing, so a healthy project produces "no change needed" cheaply); `framing` is injected into the insight prompt; `digest_threshold` decides when a falsification digest is worth spending. `strategy_hash` is a stable fingerprint used to label iterations and A/B rows.
- **lessons** — the verbal gradient. Each low-scoring eval criterion appends one short critique that is fed into the next iteration's insight prompt.
- **accepted_findings** — desensitized `(category, feature, hot_file, title)` of advice already given, used by the novelty criterion to stop the loop repeating itself.
- **iterations** — the climb: one row per run with `quality`, `cost`, and the headline `quality_per_1k_tokens`. This is what makes the loop measurable.
- **ab** — old-vs-new comparisons: the incumbent strategy vs. a candidate scored on the same project and window, with the keep/reject verdict. A candidate is kept only if it raises quality without a cost regression, or strictly improves cost at equal quality.
