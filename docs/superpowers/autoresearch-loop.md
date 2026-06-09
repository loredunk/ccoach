# ccoach-autoresearch — design + implementation plan

> Internal design doc (ADR refs allowed; never ships to users). Governing ADR: [`0052`](../adr/0052-autoresearch-self-evolving-loop.md).
> Real `--json` schema this is built on was captured from `node dist/cli.js --platform claude-code --days 60 --scope project|episode --json` on 2026-06-09.

## ccoach-autoresearch — a tiny self-evolving deep-insight loop (design doc)

### 0. One-paragraph thesis
ccoach-autoresearch is a small training loop **for the deep-insight *process itself*** (Karpathy Software-2.0: goal + skeleton + search). The "weights" are not a model — they are a human-readable **strategy artifact** describing *which probes to run, in what order, with what framing, and when to spend a digest*. Each iteration runs a minimal probe, reuses the existing `ccoach-deepinsight` method to produce a semantic root-cause insight, scores that insight with a verifiable eval rubric, and writes a verbal critique back into the strategy artifact. The objective is to climb the cost × quality frontier: highest insight quality per token. This is literally the North Star — more legible, less waste, dare to build (ADR 0048 governing rule: insights are semantic root-cause, never metrics).

It is a **new skill + 3 small .mjs + 1 JSON ledger**, sitting *on top of* `ccoach-deepinsight`. **The CLI gets zero changes** — the probe is built entirely on the existing `--json` contract.

### 1. Why a new skill, not edits to deepinsight (Boris #1, #8; Karpathy #7)
`ccoach-deepinsight` is the **forward pass**: an LLM-driven procedure that turns probe data + read-only code into semantic root causes (taxonomy: `cognitive_gap | prompt_issue | code_structure | workflow | unknown_feature`). We do **not** touch it; reinventing root-cause analysis would violate the brief. ccoach-autoresearch is the **outer loop** that *calls* deepinsight as its generate step and adds eval + optimize. Keeping it a separate skill keeps deepinsight shippable standalone and keeps the loop a flat, replayable trace (Boris #1: the loop must read top-to-bottom as one log). Smallest-thing-that-works (Boris #8): Phase 0 is a single linear pass; complexity is added only when a recorded eval regression licenses it.

### 2. The minimal probe (grounded in the real CLI cheap tier + local signal)
The probe is a thin .mjs (`probe-runner.mjs`) that shells the **already-existing** CLI and reads cheap local metadata. **Nothing here reads bodies; nothing escalates to digest** (digest is reserved for the eval-driven falsification gate, §4 criterion 5).

**Probe set (the whole forward-pass input):**
1. `ccoach --platform <P> --since <d> --scope project --json --no-glossary` — the ~40 KB headline payload. Carries (all cheap, single-pass): `episode_summary{spiral_episodes, task_mix, intervention_style, deepest_pit, autonomy_rate, corrected_rate}`, `error_signals`, `rework_signals`, `prompt_signals`, `skills`, `environment`, `git_habits`, `project_management`, `models_timeline`, `endpoints`, plus `projects[]` (per-repo buckets).
2. `ccoach --platform <P> --since <d> --scope episode --json` — **but the probe-runner immediately distills it** to only `episode_summary.deepest_pit` + the spiral-flagged subset of `episodes_detail[]` (those with `spiral.severity > 0`), discarding the rest of the ~200-record / ~210 KB dump. This directly attacks the single biggest token sink: the probe ingests it once, hands the model only the flagged subset. (Context engineering, Karpathy #5 — feed only the relevant slice.)
3. Read-only file peeks (Read/Grep/Glob, deepinsight Pass 1 step 3, unchanged): platform guide — **CLAUDE.md for claude-code, AGENTS.md for codex, never crossed** (platform-faithful rule); build/test manifest; `.claude/settings.json` verify-gate presence; git-churn hot files.
4. **One new zero-cost local cross-check** (label/count/precomputed only): `~/.claude/stats-cache.json` → `firstSessionDate` (tenure / time-aware guardrail input) + speculation/feature-usage signal; and `~/.claude/tasks/*.json` **status enum histogram** (pending/in_progress/completed counts only) as an abandoned-plan / TodoWrite-never-finished workflow signal. These are fixed labels / numeric counts / harness-precomputed aggregates — **no body read**, fully inside the controlled-non-content exception (ADR 0016/0017). Codex has no `~/.claude` equivalent, so this step is claude-code-only and explicitly skipped (labeled) for Codex.

**Why this is the right minimal probe:** the entire `report` command is a single metadata pass with no body reading; every dimension deepinsight needs (`spiral`, `edit_ring`, `structured_ratio`, `error_signals`, `rework_signals`, `skills`, `environment`, `task_mix`, `prompt_signals`) is cheap. The expensive tier (`digest`, `sessions --include-user-prompts`) is never in the baseline probe (Boris #5: high-signal, token-budgeted outputs).

### 3. Magic-dimension discovery (existing magic dimensions + bandit)
The "magic dimensions" are the depth axes the project already treats as load-bearing: **episodes (ADR 0032), spirals/deepest-pit (ADR 0034), counterfactual baselines own-history (ADR 0036), grounding window (ADR 0048).** The probe surfaces all of them cheaply; the loop's job is to pick the **1–3 that actually matter for *this* project** rather than analyzing everything (the "very long" pain is over-analysis).

Discovery is a deterministic rank in `probe-runner.mjs`: from the distilled probe, compute a per-dimension *anomaly score* against the user's **own** within-window baseline (ADR 0036: own history only, type-internal normalization, no cross-user) — e.g. spiral-dimension score = `spiral_episodes / episodes`; rework-dimension = `user_modified_rate` + `max_edits_per_file` outliers; verify-gate-dimension = boolean(`.claude/settings.json` has PostToolUse hook) × repo has tests; prompt-quality = inverse `structured_ratio`/`file_ref_ratio`; feature-gap = unused-but-applicable feature count (e.g. `plan` permission mode share). The loop then treats each dimension as a **bandit arm** (Phase 2): Thompson sampling allocates the tight per-run budget to the highest-anomaly dimensions, and an **"inaction" arm** prunes dimensions surfacing nothing (so a healthy project produces "no change needed" cheaply — the false-positive honesty rule). The chosen dimensions + their framing come from the strategy artifact (§6), so this is *optimizable*.

### 4. The verifiable eval rubric
`eval-judge.mjs` scores **one candidate insight** (a deepinsight `finding`) on **6 criteria, each 0–1, reproducibly**. Deterministic criteria run first as code (cheap, no LLM); subjective criteria run as a bias-defended LLM-judge.

| # | Criterion | Type | Exact scoring rule (0–1) |
|---|---|---|---|
| C1 | **grounded-in-window** | deterministic + judge | 1.0 if the finding cites ≥1 commit returned by `grounding.mjs` for the session's `[first,last]` window AND no out-of-window commit is referenced; 0.5 if project-scope finding grounded in code the probe actually read (file in git-hot-list); 0 if it references a commit outside the window or an unread file. (ADR 0048 grounding gate.) |
| C2 | **semantic-not-metric** | deterministic | 1.0 if `root_cause`/`headline` contain no raw metric token as subject (regex deny-list: `spiral|severity|edit_ring|pass.?rate|episode\b|structured_ratio` as grammatical subject) and `signal` carries ≤1 metric; 0.5 if exactly one slips into the body; 0 if the headline *is* a metric. |
| C3 | **actionable** | judge | 1.0 if the `fix` is a concrete next action a human can do today (imperative, names the artifact to change); 0.5 if vague; 0 if no fix. |
| C4 | **official-feature-only** | deterministic | 1.0 if `feature` ∈ the official whitelist (plan mode, @file refs, PostToolUse hook, /clear, /compact, subagents, CLAUDE.md commands+map, AGENTS.md, skills) OR `feature=''` legitimately; **0 (hard fail)** if it names any third-party/community habit skill. Plus time-aware guard: 0 if it recommends a newer-model default whose `models_timeline.first_day` postdates the window. |
| C5 | **survives-falsification** | conditional | Only when the finding is a session-intent claim at `confidence≥high`. 1.0 if a TIGHT `ccoach digest` (≈7.5 K, redacted, opt-in) did **not** contradict the root cause; 0 if it contradicted; **N/A → excluded from average** otherwise. (ADR 0048/0049.) |
| C6 | **novel-vs-prior** | deterministic | 1.0 if the finding's `(category, feature, hot-file)` triple is not already in the ledger's `accepted_findings[]`; 0.5 if same category different fix; 0 if a near-duplicate. |

**Aggregate quality** = mean of applicable criteria (C5 excluded when N/A), 0–1. **Cost** = `{cli_calls, distilled_tokens_in, digest_runs, wall_ms}`. A finding with C4=0 is auto-rejected (hard gate) regardless of mean.

**LLM-judge bias defenses** (non-negotiable for trust): C1/C3/C5 judging is done **pairwise old-vs-new with order swapped and averaged** (cancels position bias); the judge prompt masks model identity; the judge is **calibrated once against a small frozen golden set** of hand-labeled good/bad insights (target ≥80% agreement) before the loop is trusted to self-modify. Deterministic criteria (C2/C4/C6) are the honest floor.

### 5. The optimization / feedback loop + how improvement is measured
The loop is one flat, replayable trace (Boris #1), implemented as the SKILL.md procedure orchestrating the three .mjs:

1. **extract** — `probe-runner.mjs` runs the minimal probe (§2), distills, computes anomaly ranks (§3), reads current strategy from the ledger.
2. **insight** — the skill invokes the existing **ccoach-deepinsight method** on the chosen dimensions, **conditioned on the strategy's `framing` + injected `lessons[]`** (Reflexion memory) and **inner self-refined once** against the rubric before emitting (Self-Refine). Noisy multi-session scanning runs inside a deepinsight subagent that returns only the distilled finding (Boris #6: protect main context).
3. **eval** — `eval-judge.mjs` scores each finding (§4), emits `{quality, cost, per-criterion}`.
4. **optimize** — `strategy-update.mjs` is the **backward pass**: for each criterion that scored low, it appends a *verbal critique* to `strategy.lessons[]`, updates dimension bandit posteriors, and may mutate `dimension_order` / `digest_threshold` / `framing`. It writes a new `iterations[]` row `{ts, strategy_hash, quality, cost, accepted_findings_delta}`.
5. **loop** — between iterations the loop **compacts** (one clean handoff per cycle, Boris #7) and **re-reads the ledger + ADRs from disk** rather than trusting in-context summary.

**Measuring improvement (optimizable, A/B):** the ledger's `iterations[]` is the measurable history. A `--ab` mode runs the **same project, same window** twice — once with the frozen incumbent strategy, once with the candidate — and compares `quality` and `cost`. A candidate is **kept only if it beats the incumbent on quality without a cost regression past threshold, OR strictly Pareto-improves cost at equal quality**. Across iterations, the headline metric is **quality-per-1k-tokens**; the loop reports its own score, so the user can read the climb.

### 6. The persistent strategy / ledger artifact (privacy-compliant)
Lives at **`~/.ccoach/autoresearch/strategy.json`** (sibling to `~/.ccoach/extracts/` from ADR 0038; per-machine, never synced). **Pure aggregate: dimension names, scores, counts, and desensitized finding *titles* only — zero prompt text, zero assistant/digest content.** One file per `(platform, project)` key keeps it legible and diffable. Shape: see `references/autoresearch-strategy-schema.md`. Privacy self-check on every write: no field may contain a prompt, assistant text, digest body, or un-desensitized path; `title`/`hot_file` desensitized to `<…>`; the writer runs the same redaction guard before persisting.

### 7. Closed-loop diagram
```
                ┌─────────────────────────────────────────────────────────┐
                │  ~/.ccoach/autoresearch/strategy.json  (disk = ground    │
                │  truth: strategy + bandit + lessons + iterations + ab)   │
                └──────────────▲───────────────────────────┬──────────────┘
        read strategy/lessons  │                           │ write critique + new iteration row
                               │                           ▼
   ┌─────────────┐   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
   │   EXTRACT   │──▶│     INSIGHT      │──▶│      EVAL        │──▶│    OPTIMIZE      │
   │ probe-runner│   │ ccoach-deepinsight│   │  eval-judge.mjs  │   │strategy-update.mjs│
   │  (cheap CLI │   │  method (reused) │   │ 6 criteria 0-1 + │   │ verbal-gradient  │
   │  + local    │   │  + framing/lessons│   │ cost; det. first,│   │ + bandit update  │
   │  metadata)  │   │  + self-refine×1 │   │ judge swap/cal'd │   │ + maybe digest   │
   └─────────────┘   └──────────────────┘   └────────┬─────────┘   └────────┬─────────┘
          ▲                                          │ C5 falsify?           │
          │                                  opt-in TIGHT ccoach digest      │
          │                                  (redacted, ≤7.5K, discard)      │
          └──────────────────── loop (compact between cycles) ◀──────────────┘
                                          │
                                   --ab: same project, frozen vs candidate → keep iff Pareto-improves
```

### 8. File layout (small + legible — Karpathy #7)
```
skills/ccoach-autoresearch/
  SKILL.md                         # the loop procedure (extract→insight→eval→optimize); allowed-tools
  scripts/
    probe-runner.mjs               # minimal probe + distill + anomaly rank + bandit pick (no LLM, no bodies)
    eval-judge.mjs                 # 6-criterion rubric: deterministic C2/C4/C6 + judge harness for C1/C3/C5
    strategy-update.mjs            # verbal-gradient writer + bandit posterior update + iteration/ab rows
  references/
    autoresearch-rubric.md         # the 6 criteria, exact scoring rules, judge bias defenses
    autoresearch-strategy-schema.md# the strategy.json shape
    golden-insights/               # frozen hand-labeled good/bad insight examples (judge calibration)
docs/adr/0052-autoresearch-self-evolving-loop.md
~/.ccoach/autoresearch/strategy.json   # per-(platform,project) ledger, runtime, per-machine, gitignored
```
The loop **reuses** deepinsight's `grounding.mjs` (C1) and `render_deepinsight.mjs` (optional dossier) — no duplication.

### 9. CLI changes: none required
Every probe call uses the existing `--json` contract. The loop respects the CLI↔skill decoupling. *Optional, non-blocking* future affordances (deferred): a `--spiral-only` filter on `--scope episode`, a `--repo` filter on `report`. Until then `probe-runner.mjs` distills client-side.

### 10. Privacy compliance summary (every red line)
- **Read-only, local, no exfiltration, this-machine-only**: probe shells read-only CLI + read-only git + reads only label/count/precomputed local metadata; ledger is per-machine, never synced.
- **Never reads assistant/thinking/system/file-content**: probe is metadata-only; the *only* body read is the eval C5 falsification gate (opt-in TIGHT `ccoach digest`, redacted, ≤7.5K, no thinking, transient-discard).
- **Desensitize + truncate before any write**: ledger writer runs the redaction guard; titles/paths → `<…>`; zero prompt/assistant/digest text persisted.
- **No quota %**: loop never emits quota; cost is an estimate label.
- **Controlled non-content exception** (ADR 0016/0017): the new `~/.claude` signals are booleans/counts/precomputed aggregates only.
- **Official-feature-only / platform-faithful**: C4 hard-gates third-party skills; probe reads CLAUDE.md for claude-code and AGENTS.md for codex, never crossed.

---

## Implementation phases

### Phase 0 — smallest end-to-end closed loop (one pass, no mutation yet)
- SKILL.md with the linear extract→insight→eval→optimize procedure + allowed-tools.
- `probe-runner.mjs`: 2 cheap CLI calls, distill episode dump to `deepest_pit` + `spiral.severity>0` subset, read `stats-cache.json` + `tasks/*.json` status histogram, deterministic anomaly rank, emit compact probe JSON.
- `eval-judge.mjs`: deterministic C2/C4/C6 (regex deny-list, official whitelist, novelty vs ledger); C1/C3/C5 stubbed N/A; print `{quality, per-criterion, cost}`.
- `strategy-update.mjs`: create `~/.ccoach/autoresearch/strategy.json` if absent, append one `iterations[]` row; no strategy mutation yet.
- `references/autoresearch-strategy-schema.md` + `autoresearch-rubric.md`.
- Reuse ccoach-deepinsight as the insight step.
- **Verify:** probe-runner emits valid JSON with distilled (small) spiral subset; eval-judge prints 0–1 quality, hard-fails C4 on a third-party skill and C2 on a metric headline; strategy-update writes the ledger with one iterations row and zero prompt/path leak; vitest covers C4 hard-fail + C2 metric-headline; `node tools/check_adrs.mjs` passes with 0052.

### Phase 1 — full rubric + verbal-gradient mutation (self-improving)
- eval-judge.mjs: add C1 (grounding.mjs), C3 (actionable judge), C5 (opt-in tight digest falsification on confidence≥high session-intent); judge bias defenses (order-swap, identity-masked); `--calibrate` vs golden set (gate ≥0.80).
- `references/golden-insights/`: 8–12 frozen hand-labeled good/bad examples.
- strategy-update.mjs: write verbal critiques into `lessons[]`; SKILL injects `framing` + `lessons[]` into the deepinsight prompt and self-refines once.
- SKILL: compact-between-iterations; re-read ledger+ADRs from disk each cycle.
- **Verify:** `--calibrate` agreement ≥0.80; two consecutive iterations on ccoach itself — iteration 2 injects iteration 1's critique; a high-confidence session-intent finding triggers exactly one tight digest (C5 scored); project-scope findings show C5=N/A; ledger still zero body text.

### Phase 2 — bandit budget allocation + old-vs-new A/B + Pareto report
- probe-runner.mjs: dimension anomaly scoring + Thompson bandit (inaction arm) reading/writing `dimension_bandit`; allocates which 1–3 dimensions to drill.
- strategy-update.mjs: bandit posterior update from eval rewards; `--ab` mode (frozen incumbent vs candidate, same window snapshot, write `ab[]` row, keep iff non-regressing/Pareto-improving).
- SKILL: document the `--ab` gate + quality-per-1k-tokens headline.
- Optional: render iteration history via render_deepinsight.mjs.
- **Verify:** `--ab` writes an `ab[]` row with both quality+tokens and an explicit verdict; a quality-dropping candidate is REJECTED; over ≥3 iterations the bandit concentrates on the highest-anomaly dimension and pulls inaction on a quiet window; self-reported quality-per-1k-tokens is non-decreasing for a fixed project (or prints why it plateaued); vitest covers the Pareto keep/reject function.

## Open questions — decided defaults (override on review)
- **OQ1 golden set ownership:** I seed 8–12 hand-labeled good/bad insights on the ccoach repo itself; calibrate judge to ≥0.80 agreement before trusting self-modify.
- **OQ2 ledger in VC:** No — runtime-only, per-machine, lives at `~/.ccoach/` outside the repo (inherently untracked).
- **OQ3 A/B reproducibility:** Freeze a one-shot probe snapshot to disk so incumbent and candidate score the exact same input.
- **OQ4 future CLI affordance:** Keep CLI frozen this cycle; probe-runner distills client-side. `--spiral-only`/`report --repo` noted as deferred.
- **OQ5 ~/.claude metadata scope:** User explicitly authorized mining `~/.claude`; include `stats-cache.json` (firstSessionDate, speculation) + `tasks/*.json` status histogram — strictly labels/counts/precomputed aggregates, never bodies.

## Biggest risk + mitigation
**Eval-signal dishonesty.** Insight quality is soft; the rubric leans on an LLM-judge for C1/C3/C5, and a biased/miscalibrated judge turns self-optimization into a noise amplifier (it "improves" toward whatever the judge rewards — the exact failure mode Karpathy warns about). Mitigations baked in as non-negotiable gates: (1) deterministic C2/C4/C6 are pure code and form an honest floor even if the judge drifts, and C4=0 auto-rejects regardless of the mean; (2) the judge is calibrated against a frozen golden set with a ≥0.80 human-agreement gate **before** the loop may self-modify, run pairwise old-vs-new with order swapped + identity masked; (3) the Pareto A/B gate keeps a strategy change only if it beats the incumbent on the full rubric without cost regression, so a single judge fluke cannot ratchet badly; (4) the loop stays a flat replayable trace with the strategy diffable on disk, so a human can read why a strategy changed and revert. If the judge cannot clear ≥0.80 after calibration, fall back to the deterministic floor (C2/C4/C6) and route C1/C3/C5 to human accept/reject — degrade to verifier-assisted manual review rather than fabricate a quality signal.
