# autoresearch eval rubric — the loop's verifiable quality signal

Each candidate insight (a deepinsight finding: `title`, `category`, `confidence`, `root_cause`, `fix`, `feature`, `signal`) is scored on **6 criteria, each 0–1**. The aggregate quality is the mean of the *applicable* criteria. Deterministic criteria run first as plain code (no model, no network, no content); the subjective criteria use a bias-defended judge.

| # | Criterion | Type | Scoring rule (0–1) |
|---|---|---|---|
| **C1** | grounded-in-window | deterministic + judge | 1.0 if the finding cites ≥1 commit that actually falls inside the session's `[first,last]` window (proven via the grounding helper) **and** references no out-of-window commit; 0.5 if it is a project-scope finding grounded in code the probe actually read (a git hot-file); 0 if it cites a commit outside the window or a file nobody read. |
| **C2** | semantic-not-metric | deterministic | 1.0 if the headline / root cause read as a plain-language *why* and metrics appear only in the demoted `signal` line; 0.5 if one raw metric leaks into the body; 0 if the headline itself *is* a metric. |
| **C3** | actionable | judge | 1.0 if the fix is a concrete next action a person can take today (imperative, names the artifact to change); 0.5 if vague; 0 if there is no fix. |
| **C4** | official-feature-only | deterministic (hard gate) | 1.0 if `feature` is an official native feature (plan mode, @file references, PostToolUse hook, /clear, /compact, subagents, a CLAUDE.md commands block + module map, AGENTS.md, skills/slash commands) **or** is legitimately empty; **0 (hard fail → finding auto-rejected)** if it recommends any third-party / community habit skill. A finding that recommends a model default newer than the analysis window also fails (time-aware guard). |
| **C5** | survives-falsification | conditional | Evaluated **only** when the finding is a session-intent claim at `confidence ≥ high`. 1.0 if a tight, redacted, opt-in content digest does **not** contradict the root cause; 0 if it contradicts; **N/A (excluded from the mean)** otherwise — most project-scope findings never trigger this. |
| **C6** | novel-vs-prior | deterministic | 1.0 if the finding's `(category, feature, hot-file)` triple is not already in the ledger's accepted findings; 0.5 if it shares a category but proposes a different fix; 0 if it is a near-duplicate of advice already given. |

**Aggregate quality** = mean of the applicable criteria (C5 dropped when N/A), reported 0–1. **Cost** is recorded alongside every score: `{cli_calls, tokens_in, digest_runs, wall_ms}`. The headline efficiency metric is **quality per 1k tokens** — the number the loop is climbing.

**Hard gate:** a finding with C4 = 0 is rejected outright, regardless of its mean. Naming a non-official habit skill is never acceptable.

## Why the deterministic floor matters

C2, C4, and C6 are pure code — they hold even if the judge drifts. They are the honest floor of the rubric. The subjective criteria (C1, C3, C5) are the only place a model judges, and that is exactly where bias can creep in, so:

- **Order-swap:** when comparing an old vs. new insight, the judge runs the pair both ways and averages, cancelling position bias.
- **Identity-masked:** the judge prompt never reveals which model or strategy produced an insight, so it can't prefer its own.
- **Calibrated before trust:** the judge is checked against a small frozen set of hand-labeled good/bad insights; it must agree with the human labels at ≥ 80% before the loop is allowed to self-modify on its verdicts. If it can't clear that bar, the loop falls back to the deterministic floor and routes the subjective calls to a human accept/reject — it never fabricates a quality signal it can't honestly compute.
