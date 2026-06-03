---
name: ai-usage-html-report
description: Generate an enriched dual-platform (Claude Code + Codex) HTML report of local AI coding usage, built from ccusage and `ccoach report --json` data. Use when the user wants a deeper AI-written review of how they use Claude Code and/or Codex — cost, token, cache, model and active-hours breakdown, habits analysis, project-by-project recommendations, high-token project/session drilldown, or a richer HTML dashboard than the raw text/JSON reports.
when_to_use: 'Trigger when the user wants to review, analyze, or visualize their local AI coding usage across Claude Code and Codex — for example "how much did I spend on Claude Code / Codex", "how much did I use AI today", "generate an AI usage report", "build an HTML dashboard of my Claude Code and Codex usage", "which projects burned the most tokens", "compare my Claude Code vs Codex usage", "review my most expensive or unclear Codex sessions", "analyze my AI coding habits", or an explicit /ai-usage-html-report invocation.'
argument-hint: "[YYYY-MM-DD | N (days back)]"
arguments: period
allowed-tools: Read Write WebSearch WebFetch Bash(ccoach *) Bash(npx *) Bash(node *) Bash(python3 *) Bash(ccusage *)
---

# AI Usage HTML Report (Claude Code + Codex)

## Purpose

Build a dual-platform local AI usage report. Use authoritative on-disk facts as the data source, then write AI interpretation into an insights file and render a polished standalone HTML report covering both Claude Code and Codex.

Keep responsibilities separate:

- Data tools (ccusage, `ccoach report`) collect local facts.
- This skill interprets those facts and produces an enhanced HTML document.

### Data-layer rules (mandatory)

- **Claude Code data MUST come from `ccusage`.** ccusage reads each `~/.claude/projects/*.jsonl` line for the real per-message model and prices it with offline LiteLLM data, so its model/cost attribution is correct.
- **NEVER use `~/.claude/stats-cache.json`.** It is polluted by cc-switch swapping in third-party providers (kimi, etc.), so its model/cost attribution is wrong, and it stopped updating after 2026-04-09 — stale and inaccurate. This was confirmed against real data when comparing approaches. Do not read or fall back to it under any circumstances.
- **Codex data** comes from `ccoach report --since <date> --json` (token *and* behavior: repos/hours/tools/git_habits/project_management/languages/sources over the window) plus `ccusage codex daily` (token/cost history).
- **Claude Code behavior** comes from `ccoach report --platform claude-code --json`, which parses `~/.claude/projects/**/*.jsonl` locally (offline) into the unified Report — tokens + `tools{by_name,categories}` + repos + `hours{count}` + git_habits + `file_languages` + `prompt_signals` + environment — so both platforms render symmetrically. It emits only aggregates: Bash → first token / git subcommand only, repo → cwd basename, file → extension only. Never prompt text, file contents, full commands, or absolute paths.

## Workflow

### Daily dual-platform report

1. Locate `ccoach` (a Node CLI, `@loredunk/ccoach`; the Go build is retired):
   - Prefer `ccoach` from `PATH`.
   - Otherwise run it via `npx @loredunk/ccoach@latest`.
   - If this is the ccoach source repo, run `npm ci && npm run build`, then invoke `node dist/cli.js` (or `npm run dev --` to run `tsx src/cli.ts`).
   - Generate the Codex report **over a window** (not just today), so ccoach emits its behavior dimensions (repos/hours/tools/git_habits/project_management/languages/sources):
     - `ccoach report --since <START> --json > /tmp/codex-usage-report.json`
     - Choose `<START>` as the earliest Claude Code activity date or a sensible floor (e.g. start of the current year). ccoach supports `--since YYYY-MM-DD`, `--days N`, and `--date YYYY-MM-DD` (mutually exclusive).
     - If invoked with an argument (`$period`): a date like `2026-06-01` maps to `--date $period`; a bare integer like `7` maps to `--days $period`; empty means a wide window via `--since`.
2. Pull data with `ccusage` (offline, no network, no upload):
   - `npx ccusage@latest claude daily --json --offline --breakdown > /tmp/cc-daily.json`
   - `npx ccusage@latest claude session --json --offline > /tmp/cc-session.json`
   - `npx ccusage@latest codex daily --json --offline > /tmp/cc-codex.json`
   - Use `ccusage ...` directly if it is already on `PATH`; otherwise `npx ccusage@latest ...`.
3. Collect the Claude Code **behavior** profile from ccoach (offline, local parse), over the same window:
   - `ccoach report --platform claude-code --since <START> --json > /tmp/claude-behavior.json`
   - Match `--since`/`--days`/`--date` to the Codex ccoach window so both platforms cover the same span.
   - This report also carries `prompt_signals` — numeric prompt-quality aggregates (length, structured/constraint/file-ref ratios, correction rate); **never prompt text, never assistant replies** — which power the scorecard's Prompt Skill axis. Per-project / per-session breakdowns: see "Analysis scopes" below.
4. Merge into one dual-platform JSON (both platforms get a unified `behavior` block):
   - `node ${CLAUDE_SKILL_DIR}/scripts/merge_dual_platform.mjs --cc-daily /tmp/cc-daily.json --cc-session /tmp/cc-session.json --cc-behavior /tmp/claude-behavior.json --codex-report /tmp/codex-usage-report.json --codex-ccusage /tmp/cc-codex.json --output /tmp/ai-usage.json`
   - `--cc-behavior` is optional: if omitted, the Claude Code behavior panel degrades gracefully and the Codex behavior panel (from ccoach) still renders.
5. Read `/tmp/ai-usage.json`, then write `/tmp/ai-usage-insights.json` following `references/dual-insights-schema.md`.
   - Write the rich AI-interpretation layer the dual renderer expects:
     - `executive_summary` — a prominent paragraph (or short list) covering both platforms.
     - `recommendations` — a list; each item is a string or `{title, text, evidence}` (include `evidence` grounded in the merged numbers).
     - `insights` — a list; each item is a string or `{title, detail}`.
   - All fields are optional and backward-compatible: a flat `{"insights": ["string", ...]}` still renders. Use Chinese unless the user asks otherwise.
   - Behavior data is in `platforms.<plat>.behavior` (tools / top_commands / git_habits / languages / repos / hours / sources / extras) for both platforms — ground at least one insight per platform in these behavior numbers.
   - For richer interpretation patterns (evidence → meaning → impact → drilldown → intervention), read `references/insight-patterns.md`; distill those ladders into the `recommendations`/`insights` fields described in `references/dual-insights-schema.md`.
   - **By default, also run the Claude Code session prompt review** ("Session prompt review (Claude Code)" below) on the top-token session and fold its content-layer diagnoses (token drivers, prompt failure modes, better first/follow-up prompts — paraphrased) into `recommendations`/`insights`. This is default-on under standing local authorization (ADR 0015); skip it only if the user opts out.
6. (Optional) Build the shareable **scorecard** (see "Shareable scorecard" below):
   - `node ${CLAUDE_SKILL_DIR}/scripts/scorecard.mjs --data /tmp/ai-usage.json --lang zh --output /tmp/scorecard.json`
   - Pick `--lang zh|en` per the user's language. Then write the personality-summary
     sentence yourself (in the user's language) into the insights `executive_summary` —
     the fixed tier names / roasts come from the localized copy table, not from you.
7. Render HTML:
   - `node ${CLAUDE_SKILL_DIR}/scripts/render_dual_platform.mjs --data /tmp/ai-usage.json --insights /tmp/ai-usage-insights.json --scorecard /tmp/scorecard.json --lang zh --output ai-usage-report.html`
   - `--scorecard` is optional; include it to put the screenshot-friendly cover card at the top. Match `--lang` to the scorecard's.
   - Use the user-specified output path if given; otherwise `ai-usage-report.html`.

### Fallback when ccusage is unavailable

If `node`/`npx` is missing or `ccusage` fails to run, degrade to a **Codex-only** report from ccoach data:

- Run `ccoach report --json > /tmp/codex-usage-report.json`, write `/tmp/codex-usage-insights.json` per `references/insights-schema.md`, and render with `node ${CLAUDE_SKILL_DIR}/scripts/render_enriched_codex_report.mjs --report /tmp/codex-usage-report.json --insights /tmp/codex-usage-insights.json --output codex-report.enriched.html`.
- Tell the user the Claude Code half was skipped and that installing Node/ccusage (`npx ccusage@latest`) enables the dual-platform report.
- **Never** substitute `~/.claude/stats-cache.json` for the missing Claude Code data — it is wrong and stale (see data-layer rules).

### Project and session drilldown (Codex)

Use this when the user wants to find expensive or unclear Codex sessions.

1. Generate/read `/tmp/codex-usage-report.json`.
2. Identify candidate projects from `repos`, sorted by token count, estimated cost, and session count.
3. Show the user a short candidate list and ask which project to inspect. Do not read prompt contents yet.
4. Generate session candidates for the selected project:
   - `python3 ${CLAUDE_SKILL_DIR}/scripts/session_drilldown.py --days N --repo REPO --top 20 > /tmp/codex-session-candidates.json`
   - Or for one day: `python3 ${CLAUDE_SKILL_DIR}/scripts/session_drilldown.py --date YYYY-MM-DD --repo REPO --top 20 > /tmp/codex-session-candidates.json`
5. Summarize the candidate sessions by token count, tools, time span, model, source, branch, and rollout path.
6. Ask the user to choose a session before doing any prompt-content review.
7. Only after explicit user approval, rerun the script for the selected session with user prompts included:
   - `python3 ${CLAUDE_SKILL_DIR}/scripts/session_drilldown.py --rollout /path/to/rollout.jsonl --include-user-prompts > /tmp/codex-session-review-source.json`
   - Or `python3 ${CLAUDE_SKILL_DIR}/scripts/session_drilldown.py --session-id SESSION_ID --include-user-prompts > /tmp/codex-session-review-source.json`
8. Read `references/session-prompt-review.md`, then summarize the session review findings. Fold the key diagnoses into the `insights` strings of `/tmp/ai-usage-insights.json` (or, in the Codex-only fallback, into `session_reviews` of `/tmp/codex-usage-insights.json` per the schema).
9. Render the HTML again.

### Session prompt review (Claude Code) — default-on (ADR 0015)

The symmetric counterpart for Claude Code. The data owner has granted **standing local authorization** to read their own prompts by default (ADR 0015), so the daily report runs this step automatically — no per-run approval gate. It is still **single-session** (the top-token session, or one the user names), redacted, local-only, and you must still **paraphrase rather than quote**.

1. By default, surface the highest-token session's redacted prompts + per-prompt signals in one call (no `--session-id` needed — it auto-selects the top session):
   - `python3 ${CLAUDE_SKILL_DIR}/scripts/claude_session_prompts.py --since <START> --include-user-prompts > /tmp/cc-session-review-source.json`
   - To target a specific session instead, list candidates first (`--top 20`, no `--include-user-prompts` → numeric only, zero prompt text), then pass `--session-id SESSION_ID --include-user-prompts`.
   - Output is a single session under `selected_session.prompts[]` (each `{idx, timestamp, signals, preview}`); secrets/home/emails/IPs are redacted and truncated. Never an all-sessions dump.
2. Read `references/session-prompt-review.md`, then write the content-layer review into the `recommendations`/`insights` of `/tmp/ai-usage-insights.json` (rate context/direction/scope/verification; give a better first prompt + follow-up). Paraphrase — never paste `preview` verbatim, and keep the shareable scorecard aggregate-only.
3. Render the HTML again.

**Inviolable even under standing authorization**: never read assistant replies, thinking, tool_result content, system/developer prompts, or file contents; never exfiltrate (local-only output).

## Analysis scopes (session / project / global)

Pick the scope from what the user asks (ADR 0005):

- **Global** (default): cross-project overview. `collect_claude_behavior.py` (no `--scope`) + `ccoach report --json`.
- **Project**: one project across its sessions. `collect_claude_behavior.py --scope project` (keyed by cwd basename under `~/.claude/projects/`); Codex side use `session_drilldown.py --repo <name>`.
- **Session**: the current/just-finished session. `collect_claude_behavior.py --scope session` emits `sessions_detail[]`; if the skill is invoked mid-session, analyze the live session directly.

Signal model for every scope: analyze **user prompts + permissions + tool calls only — never assistant replies**. User-prompt analysis is numeric (`prompt_signals`); if you ever quote a prompt (Codex opt-in drilldown only), paraphrase + redact (see `references/session-prompt-review.md`). Global scope stays purely aggregate (no prompt text).

## Shareable scorecard

`scripts/scorecard.mjs` grades four independent axes — Prompt Skill, Spending Style, Engineering Sense, Diligence — into tier labels + roast lines from `references/scorecard-copy.json` (hand-localized zh/en, ADR 0008/0009). The renderer shows it as a screenshot-friendly cover card.

- Tiers/roasts/UI labels are **fixed localized copy** (the table) — do not translate them yourself; pick `--lang zh|en`.
- The personality-summary sentence and any deeper roast IS yours to write, in the user's language.
- Tone: tease changeable **habits**, never ability or the person. The relative rank ("beats X%") is a local **estimate** — keep it labelled as such.
- Privacy is a selling point: state that all analysis is local and prompt content never leaves the machine.

## Analysis Guidance

Base all claims on the merged JSON / report data. If a claim is an inference, phrase it as an inference.

**Feature-first recommendations**: whenever a finding can be solved with a native Claude Code / Codex feature, recommend that feature by name before any generic habit advice. Use `references/feature-mapping.md` for the finding → feature table (ADR 0006).

Before recommending any platform configuration or feature (CLAUDE.md/AGENTS.md, skills, subagents, hooks, sandbox/model/effort settings, permission/settings), search the web for the latest official Claude Code and Codex documentation and verify the suggestion against it. These tools change quickly, so confirm every configuration recommendation against current docs rather than relying on prior knowledge. Only suggest — never auto-change the user's config.

**Model-version findings must be time-aware.** Usage is historical, so a model split across a window does NOT mean the user "chose" the older model — the newer one may not have existed yet. Before framing "most spend went to an older model" as waste or recommending "pin to the newest model":

- Look at the **per-day, per-model timeline**. Codex's `ccoach report --json` emits `models_timeline` (each model's `first_day` / `last_day` / per-day tokens); `ccusage codex daily` / ccusage daily give the same per-day per-model breakdown. Find when each model *first appears* — a late `first_day` means it was recently released.
- If a newer model only appears in the **last few days** of the window (or not at all), treat it as **recently released / newly available** — the older-model spend before that date is expected, not a mistake. Do **not** count it as waste, and do **not** compute a "X% wasted on the old model" figure over a span where the newer model didn't exist.
- Scope any "switch to the newer model" suggestion to **going forward**, and only when the newer model was actually available during (most of) the window. Web-verify model release dates before asserting availability.
- A user who *already started* adopting the newer model recently needs no correction here — acknowledge it as good, forward-looking behavior.

Prioritize:

- Cross-platform comparison: how Claude Code vs Codex split cost, tokens, cache reuse, and active days.
- Usage patterns across time, source, language, and project.
- Git habits: review cadence, status/diff checks, commit/push behavior, branch spread.
- Project management habits: build systems, tests, CI, docs/planning/config changes.
- Cost and token efficiency: high-token projects, cache hit rate, reasoning ratio.
- Actionable configuration suggestions: CLAUDE.md/AGENTS.md, sandbox/model/effort settings, test commands.
- Insight ladders: connect metrics to meaning, impact, next drilldown, and habit/config changes. Use `references/insight-patterns.md`.
- Prompt quality only for sessions the user explicitly selected and authorized for prompt review. Use the framework in `references/session-prompt-review.md`.

Avoid:

- Reading or quoting prompt contents, AGENTS contents, secrets, auth files, or private code unless the user explicitly asks.
- Reading hidden OpenAI/Codex system or developer prompts. This skill can only analyze local user-owned traces and files it is allowed to read.
- Dumping all prompts for a project. Prompt review must be session-scoped and opt-in.
- Treating estimated cost as a bill. (Claude Code cost is real offline LiteLLM pricing; Codex per-model cost is partial/best-effort.)
- Claiming OpenAI/Anthropic server-side account usage; this is local-machine evidence only.
- **Flagging older-model usage as waste without temporal context.** If the newer model wasn't available during that part of the window, older-model spend is expected — don't call it waste or recommend "pinning" retroactively (see the time-aware model-findings rule above).

## Output Expectations

The final HTML should be useful as a daily dual-platform review artifact:

- Start with an executive summary that covers both Claude Code and Codex.
- Include evidence-backed recommendations.
- Include at least 2-4 deeper insights when the data supports them, especially around long sessions, cache reuse, high-token projects, and repeated tool loops.
- Highlight risks and next actions.
- Keep raw metrics visible but secondary to interpretation.
- Preserve local privacy: do not embed secret values or instruction-file contents.
- For prompt reviews, prefer paraphrased diagnoses and rewritten prompt examples over verbatim prompt quotes.
