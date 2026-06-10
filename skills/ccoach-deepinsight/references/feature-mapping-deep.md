# root cause → official feature — illustrative examples, NOT a knowledge base

> **Run-time verification is the primary mechanism; this table is not.** Before recommending any feature,
> WebFetch/WebSearch the current official docs/changelog for the user's platform to (1) confirm the feature
> still exists and behaves as you'll describe, and (2) check whether a **newer** native feature fits the root
> cause better. The rows below are a few-shot style guide — **illustrative, not exhaustive** — showing the
> *shape* of a good mapping (signature → named official feature). The harness ships new features faster than
> any bundled table; the lookup, not the table, is the source of truth. Feature-first, official only.

| Root-cause category | Typical signature | Official fix to name (example) |
|---|---|---|
| code_structure | same file re-edited 7-8x; a signal threads many layers | open in **plan mode** to enumerate cross-layer edit sites first; or **subagents** (one per layer); split oversized files |
| workflow (no verify gate) | edits land blind; converge by re-editing; repo has test/typecheck but no `.claude/settings.json` | add a **PostToolUse hook** (`.claude/settings.json`) running typecheck+test → red/green instead of blind loop |
| cognitive_gap (re-discovery) | each session re-greps where logic lives; CLAUDE.md has no commands/map | add a **Commands block + module map to CLAUDE.md**; use **@file references** to point at the artifact |
| prompt_issue | terse, file-less openers on a layered codebase; serial re-steers | front-load the target with **@file references** + acceptance criteria; **plan mode** to align before editing |
| unknown_feature | manual context reloading; long single threads bundling unrelated tasks | **/clear** at task boundaries; **/compact**; persist stable rules in **CLAUDE.md**; **skills**/slash-commands for repeated flows |

For novel categories you create, derive the fix the same way: verify against current official docs first, then
name the feature. Demote metrics to support. Never claim an activity ccoach doesn't measure.
