# finding (5 categories) → official Claude Code feature

> Feature-first, official only. Verify against current docs before recommending.

| Root-cause category | Typical signature | Official fix to name |
|---|---|---|
| code_structure | same file re-edited 7-8x; a signal threads many layers | open in **plan mode** to enumerate cross-layer edit sites first; or **subagents** (one per layer); split oversized files |
| workflow (no verify gate) | edits land blind; converge by re-editing; repo has test/typecheck but no `.claude/settings.json` | add a **PostToolUse hook** (`.claude/settings.json`) running typecheck+test → red/green instead of blind loop |
| cognitive_gap (re-discovery) | each session re-greps where logic lives; CLAUDE.md has no commands/map | add a **Commands block + module map to CLAUDE.md**; use **@file references** to point at the artifact |
| prompt_issue | terse, file-less openers on a layered codebase; serial re-steers | front-load the target with **@file references** + acceptance criteria; **plan mode** to align before editing |
| unknown_feature | manual context reloading; long single threads bundling unrelated tasks | **/clear** at task boundaries; **/compact**; persist stable rules in **CLAUDE.md**; **skills**/slash-commands for repeated flows |

Demote metrics to support. Never claim an activity ccoach doesn't measure.
