---
name: ccoach-deepinsight
description: Deep, semantic root-cause coaching for how you work with Claude Code or Codex in a specific project. Goes beyond aggregate metrics — reads your own real code (read-only) and, on spiral-flagged sessions, an opt-in token-bounded content digest — to tell you in plain language WHY work churned and the concrete fix, anchored to official native features. Distinct from the entertainment-flavored ccoach-insight report. Claude Code + Codex (symmetric); read-only, local, desensitized.
when_to_use: 'Trigger when the user wants a SERIOUS productivity / behavioral deep-dive on how they use Claude Code in a project — "why do I keep reworking this", "where am I wasting effort", "deep insight", "what should I change to use Claude Code better", "/ccoach-deepinsight". NOT for the fun usage scorecard (that is ccoach-insight).'
argument-hint: "[YYYY-MM-DD | N (days back)]"
arguments: period
allowed-tools: Read Grep Glob WebSearch WebFetch Bash(ccoach *) Bash(npx *) Bash(node *) Bash(git *)
---

# ccoach-deepinsight — semantic root-cause deep coach (Claude Code + Codex)

## Purpose

Tell the user, in plain human language, WHY their work in a project churns/wastes effort and the concrete fix — so they wield the AI harness more consciously. The deliverable is **solutions and results**, not metrics.

**First principle (non-negotiable):** CLI aggregate metrics (spiral, edit_ring, structured_ratio, any "pass rate") mislead and are machine-speak. They are **minor supporting evidence only — never the headline.** The real product is the **semantic root cause**, found by reading the user's own real code (read-only) and, when needed, an opt-in content digest.

Every root cause is classified and stated as a human fix. The known categories:
- **cognitive_gap** — didn't know something about the domain/code/tool.
- **prompt_issue** — communication; say it as "next time do X", never a scold.
- **code_structure** — the code made it hard.
- **workflow** — process.
- **unknown_feature** — an official Claude Code feature already solves it.

**The taxonomy is a scaffold, not a ceiling.** If the evidence supports a root cause that fits none of the
known categories, CREATE the category (snake_case, human-meaningful) and mark the finding `novel_category: true`
— do not shoehorn it into the closest known bucket. Every report must **attempt at least one finding outside
the known taxonomy**; if nothing novel survives the evidence bar, say so in one honest line instead of forcing one.

**Verification-first feature advice (the primary rule):** before recommending ANY feature or config, WebFetch /
WebSearch the current official docs/changelog for the user's platform and (1) confirm the feature still exists
and works the way you'll describe, (2) check whether a NEWER native feature fits this root cause better than the
one you had in mind. The harness evolves faster than any bundled table — the lookup is the source of truth;
`references/feature-mapping-deep.md` is a handful of illustrative examples, not a knowledge base. Official only —
never recommend third-party habit skills.

## Privacy (red lines)

Read-only; local; never exfiltrate. Read the user's own current-project code (never modify it) and CLI-derived signals. Reading assistant/tool_result content is **opt-in and only via `ccoach digest`** (token-bounded, redacted, NO thinking). **Never** read thinking / system·developer prompts / file contents as content. All surfaced/written output is **desensitized** (paths/identifiers → `<…>`); no raw prompt text, no assistant/thinking content.

## Workflow — two passes

> **Windows:** these steps are Bash command sequences (`/tmp`, `${CLAUDE_SKILL_DIR}`, POSIX shell syntax), so run them under **Git Bash or WSL** on Windows. The `ccoach` CLI and the `.mjs` scripts are themselves cross-platform Node.

Two platforms, **symmetric**: **Claude Code** (default) and **Codex** — pass `--platform claude-code|codex`. The two passes below are written for Claude Code; the Codex equivalents are identical (just swap the flag) — see **Codex notes** at the end. Locate `ccoach` (prefer PATH; else `node dist/cli.js` in this repo, or `npx @loredunk/ccoach@latest`).

### Pass 1 — PROJECT (always; cheap; NO content)

Find systemic root causes that recur across sessions and are fixable once.

1. `ccoach --platform claude-code --since <date> --scope project --json` and `--scope episode --json` → project + episode/spiral signals.
2. Read the repo itself (read-only): the **platform's own project guide** — `CLAUDE.md` for Claude Code, **`AGENTS.md` for Codex (Codex does NOT read CLAUDE.md)** — plus the build/test manifest (`package.json` / `pyproject.toml`), whether an auto-verify gate exists (`.claude/settings.json` for Claude Code), and the hot files git churn points at. Use Grep/Glob/Read.
3. **File-churn concentration:** `projects[].file_churn` (basename-only, cross-session) names the most re-edited files and how concentrated edits are (`top3_share`). Cross-check against git hot files: overlap = a true structural hotspot (code_structure candidate — oversized file, a signal threading layers); transcript-only churn = pre-commit rewrite loops git never sees. Open the named files (read-only) for the semantic reason. Never carry file names into anything shareable.
4. **Effort calibration curve:** `episode_summary.effort_calibration` compares, within the SAME task_type, outcomes per dial — Codex per-turn `effort` (high/medium/…), model gradient (both platforms), Claude thinking-directive on/off. Look for elasticity: does high effort actually reduce spiral/churn for this task type, or just multiply reasoning tokens? A finding like "your debug tasks show no spiral difference high vs medium but ~2x reasoning tokens — default medium, escalate only after an edit-ring triggers" is the shape to aim for. **Only compare rows with `low_confidence: false`; otherwise present as a low-confidence observation, never a policy.**
5. **Context-rot curve:** `episode_summary.context_rot` buckets episodes by their in-session turn index; `inflection_index` estimates the user's personal **context shelf life in turns**. If present (and not `low_confidence`), it is a star, sticky finding: "your sessions degrade after ~N turns — /clear or start a fresh session at task boundaries; push exploration into subagents to keep the main context clean." Episode `compacted` flags (Codex) corroborate heavy-context turns.
6. **Feature adoption (Claude Code only):** `report.feature_adoption` is official-backed evidence for "feature you haven't used" findings. `unadopted` comes from Claude Code's own usage counters (e.g. `memory_usage_count: 0`); a tip in `tips[]` with `still_showing: true` means Claude Code ITSELF still judges that feature unadopted (it only shows these tips while the user hasn't adopted it) — the strongest grounding an unknown-feature finding can have (e.g. `/memory`). Honor the `caveats`: the tip watermark is "last shown at startup #N", not a count; tip conditions drift across versions (corroboration only); and each evidence source has its own definition — e.g. the custom-agents tip checks configured agent FILES, so it can say "unadopted" while the transcripts show heavy subagent use. When sources conflict, present the conflict and name each source's definition; never pick one silently.
7. Emit **ship-once** root causes + fixes, e.g.: a missing `.claude/settings.json` PostToolUse hook running the repo's typecheck/test; a CLAUDE.md Commands block + one-line-per-file module map. Ground each in the code you read; demote metrics to a single supporting line.

This pass alone is the highest-leverage, lowest-risk output. Stop here unless the user wants per-session depth or a session is spiral-flagged.

### Pass 2 — SESSION (on spiral-flagged sessions or user drill-down)

Drill the deepest individual pits for per-turn behavioral root causes.

1. List candidates (numeric, zero content): `ccoach sessions --platform claude-code --repo <repo> --since <date> --top 20`. Pick spiral/high-churn sessions.
2. **Grounding gate (never violate):** read that session's own redacted prompts (`ccoach sessions --platform claude-code --id <FULL-session-id> --include-user-prompts`) and its `[first,last]` window. For any claim about what the turn was doing / whether work shipped, get in-window commits ONLY:
   `node ${CLAUDE_SKILL_DIR}/scripts/grounding.mjs "<first-ISO>" "<last-ISO>" <repo-path>`
   **Never** time-correlate the session to commits outside that window.
3. **Content verification gate:** before emitting any session-intent finding at confidence≥high, spend a TIGHT digest:
   `ccoach digest --platform claude-code --id <FULL-session-id> --budget tight` (≈7.5K tok; redacted; no thinking). Use it to FALSIFY a tentative root cause before asserting it — this is what prevents confidently-wrong diagnoses. Use `--budget rich` only on explicit single-session drill-down.
4. Read the specific code the session worked on (read-only) for the semantic reason it churned.

### Codex notes (symmetric)

Codex works the same way; swap `--platform codex`:
- **Signals:** `ccoach --platform codex --since <date> --scope project|episode --json` + `ccoach sessions --platform codex --repo <repo> --top 20`. Episode edit/error/spiral signals are populated from Codex rollouts (`patch_apply_end` diffs + `exec_command_end` exit codes).
- **Content gate:** `ccoach digest --platform codex --id <session-id> --budget tight` (assistant text + tool args + tool results; **NO reasoning**).
- **Grounding:** Codex sessions carry their `cwd`; the same `grounding.mjs "<first>" "<last>" <cwd>` works (platform-agnostic). Read the repo code at that cwd. For the **project guide read `AGENTS.md`** — Codex does NOT read CLAUDE.md, so if a repo has only CLAUDE.md, faithfully report that Codex ran with **no** project guide and recommend adding an `AGENTS.md` (do not point the user at CLAUDE.md in a Codex report).
- **Codex-only treasures:** per-turn `effort` is on each episode (plus session-level approval/sandbox/collab distributions, and per-episode `compacted`). This makes Codex the best platform for the effort-calibration curve — `reasoning_output` tokens are fully populated there. The Claude-side symmetric evidence is the model gradient + `thinking_directive`.
- **Limitation:** Codex user prompts are still thin (env-context injected; not yet parsed) — lean on the digest narrative + grounding + episode signals rather than prompt text. Red lines unchanged: never read reasoning / developer / system content.

### Dedup

When both passes reach the same conclusion (e.g. plan mode, @file refs), state it ONCE at project scope as a durable habit; the session pass cites instances. Reserve the session pass for findings the project pass cannot produce.

## Output

Markdown by default. For each root cause: a plain-language semantic statement, the concrete fix (official feature named), confidence, and at most one supporting metric line.

**Plain words, always (both languages).** The reader is not an ML engineer, and many English readers are not
native speakers — use simple, everyday words and short sentences. Internal field names stay in the `signal`
margin only; in prose, translate the jargon:
- `spiral` → "went in circles / got stuck" · zh **原地打转**（不要写「卡壳/螺旋」）
- `churn` / re-edit counts → "edited the same file again and again / repeated edits" · zh **反复改动 / 文件被反复改**
- taxonomy → "categories / the category list" · zh **分类**
- `episode` → "episode (one instruction → the agent's work for it)" · zh **回合**
- `context rot` → "sessions get worse after ~N turns" · zh **上下文保质期（约 N 回合后开始变差）**
- `effort` → "thinking effort level (how hard the model thinks)" · zh **思考强度档位** **False-positive honesty:** explicitly say "this is healthy work, no change needed" when a flagged spiral is actually a disciplined, test-verified change. **Dogfooding honesty:** flag when a signal is the tool's own instrument limitation (e.g. task_mix mostly "unknown" = uncalibrated classifier), not user behavior. Desensitize all paths/identifiers to `<…>` before writing/sharing.

### HTML report (optional)

For a shareable dossier, write the findings to a report JSON (schema: `references/deepinsight-insights-schema.md`) and render:

`node ${CLAUDE_SKILL_DIR}/scripts/render_deepinsight.mjs --data <report.json> --output ccoach-deepinsight.html`

The renderer is a standalone "diagnostic dossier" (dark editorial; root-cause categories color-coded; metrics demoted to a faint "signal" margin; grounding commits shown as a ledger). It HTML-escapes every field. Same privacy discipline: desensitize identifiers to `<…>` in the JSON before rendering anything you'll share, and keep `root_cause`/`headline` as paraphrase — never paste redacted prompt/digest text verbatim.

## Honesty rules

Never assert what ccoach doesn't measure (no "you never ran tests", "didn't review", "should've used plan mode" unless a real signal supports it). Verify any feature/config recommendation against current official docs/changelog (WebFetch/WebSearch) before suggesting — this is the primary rule, not a fallback; only suggest, never auto-change config.

**Policy-recommendation gate:** any policy advice (effort defaults, model choice, /clear timing, "always do X") must
(1) compare within the SAME task_type, and (2) clear the minimum-sample bar — the CLI marks under-sampled rows/curves
`low_confidence: true`; honor it. With insufficient samples, state the observation explicitly labeled low-confidence
and stop — never harden it into a conclusion. Confident-sounding numbers on thin samples are exactly how metric-led
analysis fabricates root causes; this gate is what separates this skill from that failure mode.
