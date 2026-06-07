# deep-insight method — root-cause taxonomy, grounding gate, honesty

## Root-cause ladder (semantic-first)
For each observed churn/waste: 1) what the work was trying to do (from prompts + code, paraphrased); 2) the SEMANTIC reason it churned (from reading the code); 3) classify: cognitive_gap | prompt_issue | code_structure | workflow | unknown_feature; 4) the concrete fix (official feature named); 5) at most ONE supporting metric line. Metrics never lead.

## Grounding gate (never violate)
A session's intent claim ("this turn did X / shipped / drifted") must be anchored to that session's own prompts + commits inside its [first,last] window (via scripts/grounding.mjs). NEVER time-correlate to commits outside the window. Proven failure: a trace-only diagnosis confidently asserted a session "drifted and didn't ship" by matching commits 7–11h outside the session; git+prompts showed it TDD-shipped the right features. When intent matters and confidence≥high, run a tight `ccoach digest` to falsify first.

## False-positive honesty
A high single-file edit count + long no-edit stretches + a verification workflow + green tests = a healthy refactor/localization sweep, not a spiral. Say "this is the good case, no change needed."

## Dogfooding honesty
When a signal reflects the tool's own instrument limitation (e.g. task_mix mostly "unknown" = uncalibrated task-type classifier), label it as such, not as user behavior.

## Token discipline
Content (`ccoach digest`) is default OFF. Trigger only on spiral-flagged/ambiguous sessions where the root cause hinges on intent. tight (~7.5K) captures ~90% of value; rich (~30K) only on explicit drill-down; never full.
