# ccoach

<p align="center"><a href="README_CN.md">中文 README</a></p>

> A local AI usage coach (macOS / Linux). Read-only analysis of how you use **Claude Code / Codex** —
> where your tokens go, what's wasted, and how to use the tools better — turned into a **shareable scorecard**.
> Both platforms are first-class and symmetric (not a Codex-only tool); more agent CLIs (OpenClaw, Harness, …) are planned. Design & decisions live in [`docs/`](docs/).

## What it does

- **Usage report**: read-only parse of your local **Claude Code / Codex** records — tokens, estimated cost,
  tool calls, and breakdowns by repo / hour / source / language / git habits / config scan. Read-only; changes nothing.
- **Advice** (skill): teaches Claude Code / Codex to interpret this data and give **feature-first** advice —
  whenever a finding can be solved with a native feature (CLAUDE.md/AGENTS.md, subagents, hooks, plan mode,
  permission settings, model/effort tiers…), it names the feature. Supports **session / project / global** scopes.
- **Shareable scorecard**: grade your usage / habits / prompts across four axes (Prompt Skill, Spending
  Style, Engineering Sense, Diligence) into a screenshot-friendly card at the top of the HTML report
  (bilingual zh/en, rendered by the skill).

> **Privacy**: all analysis runs locally — your prompts never leave your machine.

## ccoach skills

For richer AI-written HTML reports, use the reusable skill
[skills/ccoach-insight](skills/ccoach-insight/SKILL.md): it reads local **Claude Code + Codex**
data from `ccoach report --json` (tokens, per-model breakdown and behavior for *both* platforms),
computes authoritative cost from each model's **official online price**, and renders
a dual-platform HTML report with a scorecard. It can drill from high-token projects down to candidate
sessions (`ccoach sessions`), reads a selected session's user prompts only after explicit approval, and
never reads hidden system prompts.

### Install the skill (Claude Code + Codex)

Install the skill via the [`skills`](https://github.com/vercel-labs/skills) CLI (you already have Node — nothing else to install):

```bash
npx skills add loredunk/ccoach
```

It prompts you to pick the agents (Claude Code / Codex) and scope (global / project) — choose what you want. Update with `npx skills update ccoach-insight`, remove with `npx skills remove ccoach-insight`.

### Use it

You don't run a command — you just talk to your agent. Once the skill is installed, ask in plain language and the agent picks it up:

- *"Review my Claude Code and Codex usage for the last 7 days."*
- *"How much did I spend on Codex this week, and which projects burned the most tokens?"*
- *"Build me an HTML dashboard of how I used AI today."*

Prefer to call it by name? In **Claude Code** type `/ccoach-insight`, in **Codex** type `$ccoach-insight` — on its own it covers **today**; add a number of days (`7`) or a date (`2026-06-01`) to widen the window.

The report is **English by default** — just ask in Chinese (or for a Chinese report) and the agent renders it in Chinese (see the skill's [SKILL.md](skills/ccoach-insight/SKILL.md)).

## Install CLI

The `ccoach-insight` skill runs the **`ccoach` CLI** under the hood — you can also use it directly to see the raw usage report the skill builds on. Here's how to install and use it.

ccoach is a TypeScript / Node package (ESM, Node ≥ 18); the CLI binary is `ccoach`. Distribution is "everything is npx".

```bash
npx @loredunk/ccoach          # run without installing (once published)
npm i -g @loredunk/ccoach     # or install globally
```

### From source (today)

```bash
npm install
npm run build                 # -> dist/cli.js (bin: ccoach)
node dist/cli.js --json --days 7
# or `npm link`, then `ccoach` is on your PATH
```

## Usage

A bare invocation prints today's usage report, both platforms merged:

```bash
ccoach                          # today, all platforms
ccoach --date 2026-05-13        # a specific day
ccoach --since 2026-05-01       # from a day through today
ccoach --days 7                 # the last 7 days
ccoach --platform claude-code   # claude-code | codex | all (default: all)
ccoach --by-repo                # per-repository breakdown (with branches)
ccoach --scope project          # global | project | session (adds projects[] / sessions_detail[])
ccoach --lang zh                # output language: en | zh (default: en)
ccoach --json                   # JSON output, script / agent friendly
```

## Notes & boundaries

- **Local machine only**: rollouts are per-machine; this tool reads only local files and never aggregates across machines.
- **No quota percentages**: `rate_limits` is always null under the CLI, and quota is account-level / cross-machine.
- **Cost is an estimate**, not your actual bill. The CLI ships a best-effort **offline fallback** price table; **authoritative** cost is computed by the report skill, which looks up each observed model's **official online price** per token class. Tokens (and the offline cost) are cross-checked against `ccusage` — token-exact, cost within 1% — via `npm run verify:ccusage` (ccusage is a dev/CI check only, never a runtime dependency).
- Time windows use absolute local-timezone day boundaries; the report header states the timezone.

## Credits

Thanks to [ccusage](https://github.com/ryoppippi/ccusage) by [@ryoppippi](https://github.com/ryoppippi) — ccoach's local-usage parsing took inspiration from its approach, and I lean on ccusage to cross-check and calibrate ccoach's token / cost numbers while developing. 🙏
