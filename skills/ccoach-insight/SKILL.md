---
name: ccoach-insight
description: Generate an enriched dual-platform (Claude Code + Codex) HTML report of local AI coding usage. Tokens & models come from `ccoach report --json` (offline local parse, ccusage cross-checks Claude); cost is computed from official online prices the agent looks up per model. Use when the user wants a deeper AI-written review of how they use Claude Code and/or Codex — cost, token, cache, model and active-hours breakdown, habits analysis, project-by-project recommendations, high-token project/session drilldown, or a richer HTML dashboard than the raw text/JSON reports.
when_to_use: 'Trigger when the user wants to review, analyze, or visualize their local AI coding usage across Claude Code and Codex — for example "how much did I spend on Claude Code / Codex", "how much did I use AI today", "generate an AI usage report", "build an HTML dashboard of my Claude Code and Codex usage", "which projects burned the most tokens", "compare my Claude Code vs Codex usage", "review my most expensive or unclear Codex sessions", "analyze my AI coding habits", or an explicit /ccoach-insight invocation.'
argument-hint: "[YYYY-MM-DD | N (days back)]"
arguments: period
allowed-tools: Read Write WebSearch WebFetch Bash(ccoach *) Bash(npx *) Bash(node *) Bash(ccusage *)
---

# ccoach Insight — AI usage report (Claude Code + Codex)

## Purpose

Build a dual-platform local AI usage report. Use authoritative on-disk facts as the data source, then write AI interpretation into an insights file and render a polished standalone HTML report covering both Claude Code and Codex.

Keep responsibilities separate:

- Data tools (ccusage, `ccoach report`) collect local facts.
- This skill interprets those facts and produces an enhanced HTML document.

### Data-layer rules (mandatory)

Separate **tokens/models** (authoritative local facts, offline) from **cost** (computed in this skill from official online prices):

- **Tokens & model list = authoritative, offline, from ccoach.** `ccoach report --json` parses the local JSONL into the unified Report — tokens + per-model token breakdown (`model_tokens[]`) + behavior. ccoach never leaves the machine.
- **Claude Code per-model token attribution is cross-checked with `ccusage`.** ccusage reads each `~/.claude/projects/*.jsonl` line for the real per-message model; ccoach's parser dedups differently, so for Claude Code use ccusage's per-model token breakdown (daily `--breakdown`) as the displayed tokens. (ccusage is a cross-check, not a runtime dependency — it's invoked on demand via `npx`, never bundled.)
- **Cost is NOT taken from ccusage's bundled LiteLLM snapshot.** Instead this skill looks up the **official API price of each actually-observed model name online** (including third-party cc-switch models like kimi/deepseek), then `apply_pricing.mjs` computes cost deterministically from each model's token buckets. See "Online official pricing" below.
- **NEVER use `~/.claude/stats-cache.json`.** It is polluted by cc-switch swapping in third-party providers (kimi, etc.), so its model/cost attribution is wrong, and it stopped updating after 2026-04-09 — stale and inaccurate. Do not read or fall back to it under any circumstances.
- **Codex data** comes from `ccoach report --platform codex --json` (token + `model_tokens[]` + behavior). `ccusage codex daily` is an **optional** historical sparkline only (often unavailable); Codex tokens/models come from ccoach, never from ccusage's empty per-model cost.
- ccoach emits only aggregates: Bash → first token / git subcommand only, repo → cwd basename, file → extension only. Never prompt text, file contents, full commands, or absolute paths.

### Default window = today

If the user gives no time argument, analyze **today** (ccoach's default). Only widen the window when the user asks:

- `$period` a date `2026-06-01` → `--date 2026-06-01`; a bare integer `7` → `--days 7`; empty → **no window flag (today)**.
- Use the **same** window flag for every ccoach/ccusage call so both platforms cover one window (the report header shows it). If a platform has no activity in the window (e.g. Codex when it wasn't used), its panel renders a localized "no activity in this window" note — that's expected, not an error.
- Note: behavior/habit/timeline dimensions over a 1-day window are thin; if the user wants habit analysis, pass `--days N` or `--since`.

## Workflow

### Daily dual-platform report

   Let `<W>` be the window flag derived from `$period` (default: **no flag = today**; `--date <d>` / `--days <n>` / `--since <d>` otherwise). Use the **same `<W>`** for every command below.

   Let `<L>` be the language flag `--lang en|zh` (**default English**; pass `--lang zh` etc. to match the user's language). **Use the same `<L>` on every `ccoach report` call AND on `merge_dual_platform.mjs` / `scorecard.mjs` / `render_*.mjs`** — the CLI localizes its habit/behavior signals and window description by `--lang` (ADR 0026), so a Chinese report needs `--lang zh` everywhere, or some signals stay English. Omit `<L>` for the English default.

1. Locate `ccoach` (a Node CLI, `@loredunk/ccoach`; the Go build is retired):
   - Prefer `ccoach` from `PATH`; otherwise `npx @loredunk/ccoach@latest`.
   - If this is the ccoach source repo, run `npm ci && npm run build`, then invoke `node dist/cli.js` (or `npm run dev --` to run `tsx src/cli.ts`).
   - Generate the Codex report (token + `model_tokens[]` + behavior dimensions):
     - `ccoach report --platform codex <W> <L> --json > /tmp/codex-usage-report.json`
2. Pull Claude Code tokens with `ccusage` (offline cross-check for per-model token attribution; no upload). Match `<W>` (ccusage uses `--since YYYYMMDD`):
   - `npx ccusage@latest claude daily --json --offline --breakdown > /tmp/cc-daily.json`
   - `npx ccusage@latest claude session --json --offline > /tmp/cc-session.json`
   - `npx ccusage@latest codex daily --json --offline > /tmp/cc-codex.json` (optional — Codex sparkline history; skip if it fails)
   - Use `ccusage ...` directly if on `PATH`; otherwise `npx ccusage@latest ...`.
3. Collect the Claude Code **behavior** profile from ccoach (offline, local parse), same `<W>`:
   - `ccoach report --platform claude-code <W> <L> --json > /tmp/claude-behavior.json`
   - This report also carries `model_tokens[]` (per-model token buckets for pricing) and `prompt_signals` — numeric prompt-quality aggregates (length, structured/constraint/file-ref ratios, correction rate); **never prompt text, never assistant replies** — which power the scorecard's Prompt Skill axis. Per-project / per-session breakdowns: see "Analysis scopes" below.
4. Merge into one dual-platform JSON (both platforms get a unified `behavior` block + a `window` header):
   - `node ${CLAUDE_SKILL_DIR}/scripts/merge_dual_platform.mjs --cc-daily /tmp/cc-daily.json --cc-session /tmp/cc-session.json --cc-behavior /tmp/claude-behavior.json --codex-report /tmp/codex-usage-report.json --codex-ccusage /tmp/cc-codex.json <L> --output /tmp/ai-usage.json`
   - `--codex-ccusage` and `--cc-behavior` are optional (Codex sparkline / Claude behavior degrade gracefully). Cost in this output is an offline fallback — step 4.5 overwrites it with official prices.
4.5. **Price from official online prices** (cost layer; see "Online official pricing" below):
   - Read `/tmp/ai-usage.json`, collect every model name from each `platforms.<plat>.models[]` (skip `<synthetic>` / zero-token entries).
   - For each model, **web-search its official API price** (Anthropic / OpenAI / the third-party provider that serves it). Record per-million-token USD: `{input, cached_input, output, cache_creation?}` (include `cache_creation` only for Claude-family models). Normalize units (per-1K → ×1000).
   - Write `/tmp/pricing.json`: `{"queried_at":"<today>","models":{"<name>":{...,"source":"<url>"}}}`.
   - `node ${CLAUDE_SKILL_DIR}/scripts/apply_pricing.mjs --data /tmp/ai-usage.json --pricing /tmp/pricing.json` — rewrites authoritative cost; models with no online price keep the offline fallback and are flagged `unpriced_models`.
5. Read `/tmp/ai-usage.json`, then write `/tmp/ai-usage-insights.json` following `references/dual-insights-schema.md`.
   - Write the rich AI-interpretation layer the dual renderer expects:
     - `executive_summary` — a prominent paragraph (or short list) covering both platforms.
     - `recommendations` — a list; each item is a string or `{title, text, evidence}` (include `evidence` grounded in the merged numbers).
     - `insights` — a list; each item is a string or `{title, detail}`.
   - All fields are optional and backward-compatible: a flat `{"insights": ["string", ...]}` still renders. **Write insights in the user's language; default to English** when their language is unclear — match the `--lang` you pass to the renderer/scorecard (default English, ADR 0025).
   - Behavior data is in `platforms.<plat>.behavior` (tools / top_commands / git_habits / languages / repos / hours / sources / extras) for both platforms — ground at least one insight per platform in these behavior numbers.
   - **Billing / endpoint / exec-profile** (ADR 0022/0023) also surface in the merged JSON & rendered HTML: `platforms.codex.billing` (token split by subscription plan tier plus/pro + `unclassified`), `platforms.<plat>.endpoint` (`endpoint` official/custom + `billing_mode` subscription/api_or_relay/unknown + `relay_suspected` + `subscription_type`), `platforms.codex.codex_specific` (effort/approval/sandbox/collaboration_mode/originators/compactions/aborted_turns/context_window), `platforms.claude_code.claude_specific` (server web search/fetch counts). All are derived whitelist labels — never key/token/full URL. `plan_type` is spoofable by relays (`confidence: spoofable-by-relay`); if `endpoint=custom`/`relay_suspected`, treat plan tiers and subscription claims as untrusted. Don't print quota percentages.
   - For richer interpretation patterns (evidence → meaning → impact → drilldown → intervention), read `references/insight-patterns.md`; distill those ladders into the `recommendations`/`insights` fields described in `references/dual-insights-schema.md`.
   - **By default, also run the Claude Code session prompt review** ("Session prompt review (Claude Code)" below) on the top-token session and fold its content-layer diagnoses (token drivers, prompt failure modes, better first/follow-up prompts — paraphrased) into `recommendations`/`insights`. This is default-on under standing local authorization (ADR 0015); skip it only if the user opts out.
6. (Optional) Build the shareable **scorecard** (see "Shareable scorecard" below):
   - `node ${CLAUDE_SKILL_DIR}/scripts/scorecard.mjs --data /tmp/ai-usage.json --lang en --output /tmp/scorecard.json`
   - **Default language is English** (ADR 0025); pass `--lang zh` (or another supported locale) to match the user.
   - The **tier scores and tier names** come from `scorecard.mjs` + the copy table — **do not change the names**
     (stable, recognizable, shareable identity; unsupported locales fall back to English).
   - **Roast lines are yours to write (ADR 0029).** `scorecard.json` ships a safe fixture roast per axis as the
     default/fallback; you SHOULD **rewrite each `axes[].roast` in `/tmp/scorecard.json`** (before step 7) into the
     **user's language, idiomatic/native**, using the fixture roast as the **tone & voice exemplar**. Rules:
     tease **changeable habits, never the person/ability** (ADR 0008); **aggregate-only — never quote or imply prompt
     text** (the shareable card stays zero-raw-text); one short punchy line per axis; ground it in the real aggregate
     numbers when it lands harder (e.g. cost/tokens/late-night share). If you don't rewrite, the fixture roast renders.
   - Also write the personality-summary sentence yourself (in that language) into the insights `executive_summary`.
7. Render HTML (run step 4.5 `apply_pricing.mjs` first so cost is the official-online figure, not the offline fallback):
   - `node ${CLAUDE_SKILL_DIR}/scripts/render_dual_platform.mjs --data /tmp/ai-usage.json --insights /tmp/ai-usage-insights.json --scorecard /tmp/scorecard.json --lang en --output ai-usage-report.html`
   - The whole report skeleton is localized from `references/report-copy.json` (default English; ADR 0025). Pass `--lang zh` to render the skeleton in Chinese, etc. `--scorecard` is optional; include it for the screenshot-friendly cover card. **Match `--lang` across scorecard.mjs and render_dual_platform.mjs** (and to the language you wrote the insights in).
   - Use the user-specified output path if given; otherwise `ai-usage-report.html`.

### Fallback when ccusage is unavailable

If `node`/`npx` is missing or `ccusage` fails to run, degrade to a **Codex-only** report from ccoach data:

- Run `ccoach report --json > /tmp/codex-usage-report.json`, write `/tmp/codex-usage-insights.json` per `references/insights-schema.md`, and render with `node ${CLAUDE_SKILL_DIR}/scripts/render_enriched_codex_report.mjs --report /tmp/codex-usage-report.json --insights /tmp/codex-usage-insights.json --lang en --output codex-report.enriched.html` (skeleton localized from `references/report-copy.json`, default English; pass `--lang zh` for Chinese).
- Tell the user the Claude Code half was skipped and that installing Node/ccusage (`npx ccusage@latest`) enables the dual-platform report.
- **Never** substitute `~/.claude/stats-cache.json` for the missing Claude Code data — it is wrong and stale (see data-layer rules).

### Project and session drilldown (Codex)

Use this when the user wants to find expensive or unclear Codex sessions.

1. Generate/read `/tmp/codex-usage-report.json`.
2. Identify candidate projects from `repos`, sorted by token count, estimated cost, and session count.
3. Show the user a short candidate list and ask which project to inspect. Do not read prompt contents yet.
4. Generate session candidates for the selected project (numeric only, zero prompt text):
   - `ccoach sessions --platform codex --days N --repo REPO --top 20 > /tmp/codex-session-candidates.json`
   - Or for one day: `ccoach sessions --platform codex --date YYYY-MM-DD --repo REPO --top 20 > /tmp/codex-session-candidates.json`
5. Summarize the candidate sessions by token count, tools, time span, model, source, branch, and rollout path.
6. Ask the user to choose a session before doing any prompt-content review.
7. Only after explicit user approval, rerun for the selected session with user prompts included (Codex requires an explicit `--id` or `--rollout`):
   - `ccoach sessions --platform codex --rollout /path/to/rollout.jsonl --include-user-prompts > /tmp/codex-session-review-source.json`
   - Or `ccoach sessions --platform codex --id SESSION_ID --include-user-prompts > /tmp/codex-session-review-source.json`
8. Read `references/session-prompt-review.md`, then summarize the session review findings. Fold the key diagnoses into the `insights` strings of `/tmp/ai-usage-insights.json` (or, in the Codex-only fallback, into `session_reviews` of `/tmp/codex-usage-insights.json` per the schema).
9. Render the HTML again.

### Session prompt review (Claude Code) — default-on (ADR 0015)

The symmetric counterpart for Claude Code. The data owner has granted **standing local authorization** to read their own prompts by default (ADR 0015), so the daily report runs this step automatically — no per-run approval gate. It is still **single-session** (the top-token session, or one the user names), redacted, local-only, and you must still **paraphrase rather than quote**.

1. By default, surface the highest-token session's redacted prompts + per-prompt signals in one call (no `--id` needed — it auto-selects the top-token session):
   - `ccoach sessions --platform claude-code <W> --include-user-prompts > /tmp/cc-session-review-source.json` (same `<W>` as the report; default today)
   - To target a specific session instead, list candidates first (`ccoach sessions --platform claude-code --top 20`, no `--include-user-prompts` → numeric only, zero prompt text), then pass `--id SESSION_ID --include-user-prompts`.
   - Output is a single session under `selected_session.prompts[]` (each `{idx, timestamp, signals, preview}`); secrets/home/emails/IPs are redacted and truncated. Never an all-sessions dump.
2. Read `references/session-prompt-review.md`, then write the content-layer review into the `recommendations`/`insights` of `/tmp/ai-usage-insights.json` (rate context/direction/scope/verification; give a better first prompt + follow-up). Paraphrase — never paste `preview` verbatim, and keep the shareable scorecard aggregate-only.
3. Render the HTML again.

**Inviolable even under standing authorization**: never read assistant replies, thinking, tool_result content, system/developer prompts, or file contents; never exfiltrate (local-only output).

## Analysis scopes (session / project / global)

Pick the scope from what the user asks (ADR 0005):

- **Global** (default): cross-project overview. `ccoach report --json` (per platform via `--platform`).
- **Project**: one project across its sessions. `ccoach report --scope project --json` emits `projects[]` (keyed by cwd basename), either platform.
- **Session**: the current/just-finished session. `ccoach report --scope session --json` emits `sessions_detail[]`; if invoked mid-session, analyze the live session directly.

For deeper per-session drilldown (model/source/branch/rollout path + opt-in redacted prompt review), see the drilldown sections below (`ccoach sessions --platform codex|claude-code`).

Signal model for every scope: analyze **user prompts + permissions + tool calls only — never assistant replies**. User-prompt analysis is numeric (`prompt_signals`); if you ever quote a prompt (Codex opt-in drilldown only), paraphrase + redact (see `references/session-prompt-review.md`). Global scope stays purely aggregate (no prompt text).

## Online official pricing

Cost is computed in this skill from **official online prices**, never from a bundled/hardcoded
price table (models change; a stale snapshot drifts). The CLI stays offline and emits only tokens
+ model list; this skill does the lookup and `apply_pricing.mjs` does the deterministic math.

- **Look up each actually-observed model name** (from `platforms.<plat>.models[]`). This covers
  third-party models a user routed in via cc-switch (kimi, deepseek, …) — search that model's
  own provider pricing page, not just Anthropic/OpenAI. Skip `<synthetic>` and zero-token models.
- Web-search the **official API pricing page** and record per-million-token USD in `/tmp/pricing.json`:
  `{input, cached_input, output, cache_creation?, source}`. Include `cache_creation` ONLY for
  Claude-family models (it switches `apply_pricing` to Claude's disjoint-bucket口径; its absence
  means Codex/gpt-style `cached_input ⊆ input`). Normalize units to per-million (per-1K → ×1000);
  if a page lists only blended or per-1K prices, convert and note low confidence.
- Run `apply_pricing.mjs` (step 4.5). It rewrites `platforms.<plat>.{models[].cost,cost_usd}`,
  `combined.total_cost_usd`, stamps `cost_basis:'official-online'` + `priced_at`, and sets
  `cost_is_real` (`true` if all priced, `'partial'` if any model fell back). Unpriced models keep
  the offline fallback estimate and are listed in `unpriced_models`.
- The src `pricing.ts` table is only the CLI's offline fallback — do not treat it as authoritative.

## Shareable scorecard

`scripts/scorecard.mjs` deterministically grades four axes — Prompt Skill, Spending Style, Engineering Sense, Diligence — into tier indices + tier names + a fixture roast from `references/scorecard-copy.json` (ADR 0008/0009). The report skeleton is localized from `references/report-copy.json` (ADR 0025). The renderer shows the scorecard as a screenshot-friendly cover card.

- **Deterministic, fixed**: the tier *score* and the tier *name* (UI labels too) come from `scorecard.mjs` + the copy tables — **don't change names yourself**; **default English**, pass `--lang zh` (or another locale) to match the user. To add a tier-name locale, add its keys to the copy tables (missing keys fall back to the default language).
- **Model-authored (ADR 0029)**: the **axis roast lines** AND the personality-summary sentence are **yours to write in the user's language**. The fixture roast in `scorecard.json` is a safe default/fallback + your tone exemplar — rewrite `axes[].roast` (idiomatic, fresh, one line) before rendering; leave it for the fixture default. This is where the LLM's per-language idiom shines, so you don't have to hand-localize roasts into every language.
- Tone: tease changeable **habits**, never ability or the person (ADR 0008). **Aggregate-only**: roasts may use aggregate numbers (cost/tokens/hours/tier) but **never prompt text** — the shareable card stays zero-raw-text. The relative rank ("beats X%") is a local **estimate** — keep it labelled.
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
- Treating estimated cost as a bill. (Cost is computed from official online prices the agent looked up per model; models with no online price fall back to an offline estimate and are flagged in `unpriced_models`. Still an estimate, not a bill.)
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
