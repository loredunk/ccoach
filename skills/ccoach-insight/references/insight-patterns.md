# Insight Patterns

Use this reference when generating `insight_ladder` for the enriched HTML report.

> **These patterns are a scaffold, not a ceiling — illustrative, not exhaustive.** They show the *shape*
> of a good insight (signals → interpretation → intervention). When the data supports a pattern not listed
> here, write it — aim for at least one finding beyond this list per report when the evidence allows.
> Before recommending any feature/config, verify it against the current official docs/changelog at run time
> (WebFetch/WebSearch) and check whether a newer native feature fits better; the lookup is the source of
> truth, not this file.

## Insight Ladder

Each useful insight should move from observation to action:

1. Evidence: exact metric(s) from the report.
2. Meaning: what the metric likely represents in actual Codex use.
3. Impact: why it matters for cost, speed, quality, or user workflow.
4. Drilldown: which project/session/time/tool pattern should be inspected next.
5. Intervention: what to change in prompts, project docs, AGENTS.md, skills, or work splitting.

Do not stop at "high tokens" or "many tool calls". Explain the operating pattern behind the metric.

## High-Value Insight Patterns

### Long Session / Large Context Reuse

Signals:

- Very high total tokens.
- High `cached_input` and high `cache_hit_rate`.
- Few sessions relative to token count.
- One project dominates tokens.

Interpretation:

- The user likely worked in long sessions with a large repeated context.
- Prompt cache is working, so this is not necessarily full-price repeated reading.
- Cost can still accumulate because a large cached prefix is carried across many turns.

Example wording (illustrative — rewrite for the actual data, never recite):

> High total tokens plus high cached input suggests long context reuse: the session kept carrying a large shared context across many turns. Cache reduced repeated-processing cost, but the repeated large prefix still accumulated meaningful usage.

Next drilldown:

- Identify the dominant project.
- List highest-token sessions for that project.
- Inspect whether the session crossed phases: exploration, implementation, report writing, validation, and docs.

Interventions:

- Split long work into phase-specific sessions.
- Ask for a checkpoint summary before switching phases.
- Persist stable rules in AGENTS.md or a project skill instead of keeping them only in conversation context.
- Generate factual JSON first, then do lightweight analysis in a separate step.

### Low Cache / Repeated Reloading

Signals:

- High total tokens.
- Low `cache_hit_rate`.
- Many sessions or many source entries for the same project.

Interpretation:

- The user may be restarting context often, switching entry points, or causing different prompts/files to miss the cache.

Interventions:

- Keep related work in one session until a phase boundary.
- Use a short handoff summary when starting a new session.
- Put stable setup instructions in AGENTS.md.

### Tool Loop / Exploration Drift

Signals:

- Shell calls or web searches are high relative to file changes.
- `rg`, `sed`, `nl`, `find`, browser/search tools dominate.
- Few tests or no final validation.

Interpretation:

- The agent may be spending tokens rediscovering context or chasing broad evidence.

Interventions:

- Ask for a bounded discovery pass.
- Require the agent to state what it has learned before expanding scope.
- Provide file paths, failing commands, or acceptance criteria earlier.

### Implementation Without Verification

Signals:

- File changes are present.
- No test commands observed for a repo with a known build/test system.
- CI exists but local test commands are absent.

Interpretation:

- The session may have produced changes without a tight local feedback loop.

Interventions:

- Add the canonical fast test/typecheck command to AGENTS.md.
- Ask Codex to run verification before final summary.

### Human-Gated Git Flow

Signals:

- Many `git status` and `git diff` commands.
- No `git commit` or `git push`.

Interpretation:

- This may be an intentional workflow where Codex prepares and reviews changes but humans commit.

Interventions:

- Document whether Codex should commit automatically or only summarize diffs.
- Ask for final `git status --short` and a commit-message suggestion.

### Model Version Distribution (time-aware)

Signals:

- Spend/tokens concentrated on an older model, with a newer model at a small share.
- The per-day, per-model timeline shows the newer model only appearing recently (or not at all).
  Read it from `models_timeline` in `ccoach report --json` (`first_day` / `last_day` / per-day tokens).

Interpretation:

- Usage is historical. A model split is **not** a free choice between equally-available options — the
  newer model may not have existed for most of the window. "94% on the old model" across a month where
  the new model shipped 7 days ago is an artifact of release timing, **not** waste or a user mistake.

Example wording (illustrative — rewrite for the actual data, never recite):

> Most spend is on `<old-model>` because `<new-model>` only became available on `<date>` (it appears in
> the data starting then). That earlier spend was expected. Going forward, `<new-model>` is the stronger
> default — and you've already started switching, which is the right move.

Interventions:

- Only suggest defaulting to the newer model **going forward**, and only after web-verifying it was
  actually available during the window. Web-verify release dates before asserting availability.
- Never compute a "% wasted on the old model" over a span where the newer model didn't exist.
- If the user already started adopting it recently, acknowledge it as good behavior — no correction needed.

### Context Shelf Life (context rot)

Signals:

- `episode_summary.context_rot` with `low_confidence: false` and a non-null `inflection_index`.
- Per-bucket `rot_rate` rising with the in-session turn index.

Interpretation:

- The user's sessions degrade past a certain turn count: later turns spiral or get corrected more often.
- "Your personal context shelf life is ≈ N turns" is the headline form — concrete and memorable.

Interventions:

- `/clear` or a fresh session at task boundaries before hitting the inflection point.
- Push exploration into subagents to keep the main context clean.
- If `low_confidence: true` or no inflection: do not headline this; at most note it as an observation.

## Writing Rules

- Phrase insights as likely interpretations, not absolute truth, unless the report directly proves them.
- Prefer "this suggests..." or "likely..." for behavioral inference.
- Connect each insight to an observable next step.
- Avoid generic advice that would apply to any report.
- **Feature-first**: when an intervention can be a native Claude Code / Codex feature, name it.
  See `feature-mapping.md` for illustrative finding → feature examples — but always verify against
  current official docs/changelog at run time; the lookup, not the table, is the source of truth.
- **Policy claims need samples**: any "default to X / always do Y" advice must compare within the same
  task type and respect the CLI's `low_confidence` flags (`effort_calibration`, `context_rot`). With thin
  samples, present the observation explicitly labeled low-confidence — never a conclusion.
- **Open pattern set**: these patterns are examples, not a checklist ceiling — novel, evidence-backed
  findings beyond this file are encouraged.
