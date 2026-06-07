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

Every root cause is classified and stated as a human fix:
- **cognitive_gap** — didn't know something about the domain/code/tool.
- **prompt_issue** — communication; say it as "next time do X", never a scold.
- **code_structure** — the code made it hard.
- **workflow** — process.
- **unknown_feature** — an official Claude Code feature already solves it.

**Feature-first:** name the official native feature (plan mode, @file references, PostToolUse hooks, /clear, subagents, CLAUDE.md anchors). Official only — never recommend third-party habit skills.

## Privacy (red lines)

Read-only; local; never exfiltrate. Read the user's own current-project code (never modify it) and CLI-derived signals. Reading assistant/tool_result content is **opt-in and only via `ccoach digest`** (token-bounded, redacted, NO thinking). **Never** read thinking / system·developer prompts / file contents as content. All surfaced/written output is **desensitized** (paths/identifiers → `<…>`); no raw prompt text, no assistant/thinking content.

## Workflow — two passes

> **Windows:** these steps are Bash command sequences (`/tmp`, `${CLAUDE_SKILL_DIR}`, POSIX shell syntax), so run them under **Git Bash or WSL** on Windows. The `ccoach` CLI and the `.mjs` scripts are themselves cross-platform Node.

Two platforms, **symmetric**: **Claude Code** (default) and **Codex** — pass `--platform claude-code|codex`. The two passes below are written for Claude Code; the Codex equivalents are identical (just swap the flag) — see **Codex notes** at the end. Locate `ccoach` (prefer PATH; else `node dist/cli.js` in this repo, or `npx @loredunk/ccoach@latest`).

### Pass 1 — PROJECT (always; cheap; NO content)

Find systemic root causes that recur across sessions and are fixable once.

1. `ccoach --platform claude-code --since <date> --scope project --json` and `--scope episode --json` → project + episode/spiral signals.
2. Read the repo itself (read-only): the **platform's own project guide** — `CLAUDE.md` for Claude Code, **`AGENTS.md` for Codex (Codex does NOT read CLAUDE.md)** — plus the build/test manifest (`package.json` / `pyproject.toml`), whether an auto-verify gate exists (`.claude/settings.json` for Claude Code), and the hot files git churn points at. Use Grep/Glob/Read.
3. Emit **ship-once** root causes + fixes, e.g.: a missing `.claude/settings.json` PostToolUse hook running the repo's typecheck/test; a CLAUDE.md Commands block + one-line-per-file module map. Ground each in the code you read; demote metrics to a single supporting line.

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
- **Codex-only treasures (optional):** per-turn effort / approval / sandbox, collab/subagent events, compaction — available for richer dimensions later.
- **Limitation:** Codex user prompts are still thin (env-context injected; not yet parsed) — lean on the digest narrative + grounding + episode signals rather than prompt text. Red lines unchanged: never read reasoning / developer / system content.

### Dedup

When both passes reach the same conclusion (e.g. plan mode, @file refs), state it ONCE at project scope as a durable habit; the session pass cites instances. Reserve the session pass for findings the project pass cannot produce.

## Output

Markdown by default. For each root cause: a plain-language semantic statement, the concrete fix (official feature named), confidence, and at most one supporting metric line. **False-positive honesty:** explicitly say "this is healthy work, no change needed" when a flagged spiral is actually a disciplined, test-verified change. **Dogfooding honesty:** flag when a signal is the tool's own instrument limitation (e.g. task_mix mostly "unknown" = uncalibrated classifier), not user behavior. Desensitize all paths/identifiers to `<…>` before writing/sharing.

### HTML report (optional)

For a shareable dossier, write the findings to a report JSON (schema: `references/deepinsight-insights-schema.md`) and render:

`node ${CLAUDE_SKILL_DIR}/scripts/render_deepinsight.mjs --data <report.json> --output ccoach-deepinsight.html`

The renderer is a standalone "diagnostic dossier" (dark editorial; root-cause categories color-coded; metrics demoted to a faint "signal" margin; grounding commits shown as a ledger). It HTML-escapes every field. Same privacy discipline: desensitize identifiers to `<…>` in the JSON before rendering anything you'll share, and keep `root_cause`/`headline` as paraphrase — never paste redacted prompt/digest text verbatim.

## Honesty rules

Never assert what ccoach doesn't measure (no "you never ran tests", "didn't review", "should've used plan mode" unless a real signal supports it). Verify any feature/config recommendation against current official Claude Code docs (WebSearch) before suggesting; only suggest, never auto-change config.
