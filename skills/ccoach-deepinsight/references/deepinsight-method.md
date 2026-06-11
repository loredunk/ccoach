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

## Project health check (Beta) — scoring rubric
Four dimensions, each scored 0-4 ONLY from files actually opened during the project pass. Omit the score
when not assessed (and say why in `status`) — an omitted score renders as "not assessed", never as zero.
Shared anchors: **0** missing entirely · **1** weak/ad-hoc traces only · **2** real but with material gaps ·
**3** good, minor gaps · **4** solid, nothing material missing.
- `security_data` — auth/account handling shape; hardcoded credentials (grep key/password/token patterns —
  report the finding, never the value); DB schema changes via migrations vs ad-hoc; backup/restore traces.
- `stability_resources` — error handling at I/O boundaries; leak-prone patterns (listeners/connections/
  timers acquired but never released); cleanup on shutdown paths.
- `verification_testing` — test directory + runnable test script; typecheck/lint gates in the manifest;
  CI workflow files.
- `architecture_layering` — oversized files, mixed responsibilities, fan-in concentration. The `threshold`
  field states when refactoring starts to pay off, anchored to this repo's real numbers ("~1,400-line file
  imported by 5 modules"), never generic dogma.
Beta: the anchors are still being calibrated against real projects — present scores as a first read, not a
grade. Local report only; never in shareable artifacts.
