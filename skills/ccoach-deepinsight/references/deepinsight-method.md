# deep-insight method — root-cause taxonomy, grounding gate, honesty

## Root-cause ladder (semantic-first)
For each observed churn/waste: 1) what the work was trying to do (from prompts + code, paraphrased); 2) the SEMANTIC reason it churned (from reading the code); 3) classify: cognitive_gap | prompt_issue | code_structure | workflow | unknown_feature — **or a new category you create when the evidence fits none** (snake_case, mark `novel_category: true`; never shoehorn); 4) the concrete fix (official feature named, verified against current official docs at run time); 5) at most ONE supporting metric line. Metrics never lead.

## Open taxonomy
The five categories are a scaffold, not a ceiling. Each report must attempt ≥1 finding outside the known list; if none survives the evidence bar, say so honestly in one line. Novel categories that recur across reports are candidates for promotion into the known list.

## Policy-recommendation gate
Any policy advice (effort defaults, model choice, /clear timing, "always X") must compare within the SAME task_type and clear the minimum-sample bar — honor every `low_confidence: true` the CLI emits (effort_calibration rows, context_rot). Under-sampled → state as a low-confidence observation, never a conclusion.

## Grounding gate (never violate)
A session's intent claim ("this turn did X / shipped / drifted") must be anchored to that session's own prompts + commits inside its [first,last] window (via scripts/grounding.mjs). NEVER time-correlate to commits outside the window. Proven failure: a trace-only diagnosis confidently asserted a session "drifted and didn't ship" by matching commits 7–11h outside the session; git+prompts showed it TDD-shipped the right features. When intent matters and confidence≥high, run a tight `ccoach digest` to falsify first.

## False-positive honesty
A high single-file edit count + long no-edit stretches + a verification workflow + green tests = a healthy refactor/localization sweep, not a spiral. Say "this is the good case, no change needed."

## Dogfooding honesty
When a signal reflects the tool's own instrument limitation (e.g. task_mix mostly "unknown" = uncalibrated task-type classifier), label it as such, not as user behavior.

## Token discipline
Content (`ccoach digest`) is default OFF. Trigger only on spiral-flagged/ambiguous sessions where the root cause hinges on intent. tight (~7.5K) captures ~90% of value; rich (~30K) only on explicit drill-down; never full.

## Project blind-spot coach (Beta) — stage gate · attention · wording
Coach, not auditor: name the blind spot, assign the homework — the audit itself is the agent's job in a
follow-up session. ccoach never issues a clean bill of health, so it never owes one.

**Stage gate (run FIRST, from verifiable signals only):** commit frequency over the window, CI config
presence, deployment/real-user mentions in sessions or commit messages.
- `prototype` (young/low-frequency repo, no CI, no user mentions) → report ONLY security-redline blind
  spots (hardcoded secrets/credentials in the repo; an exposed endpoint with no auth — presence facts);
  mark the other dimensions `locked: true`. A weekend prototype told it "lacks observability" gets
  anxiety, not coaching.
- `shipping` (CI present, or deploy mentions) → unlock `verification_testing` + `stability_resources`.
- `serving` (real-user signals: user-facing deploys, incident/user mentions) → all four dimensions.
The "what stage should care about what" model is the coaching content itself — show the locked rows so
the user sees what unlocks later.

**Attention per unlocked dimension** — how often the dimension appeared in THIS window's sessions and
commits: `never` (0 hits) / `touched` (isolated hits) / `practiced` (a regular part of the workflow).
Omit `attention` when you did not actually check — renders as "not checked"; never guess.

**Wording discipline — absence statements, not audit verdicts.** A statement must be a verifiable
behavior/presence fact: "X never appeared in your sessions/commits this window", "no CI config file
exists", "a ~1,400-line file imported by 5 modules". Absence of behavior is checkable; project quality
is not. Never "your project lacks/is weak at X" — tests in an unusual directory ≠ no tests, and one
false positive there costs the feature all its trust. `basis` states how you checked.

**Homework** — one assignment per unlocked blind spot the user can paste into the next session, anchored
to an official feature (the verification-first rule applies): a security-review run over named files, a
post-edit typecheck/test hook, a refactor assessment of a named oversized file.

Beta: stage thresholds and attention buckets are still being calibrated. Local report only; never in
shareable artifacts.
