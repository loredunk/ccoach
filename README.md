# ccoach

<p align="center"><a href="README_CN.md">中文 README</a></p>

> A local AI usage coach (macOS / Linux / Windows). Read-only analysis of how you use **Claude Code / Codex** —
> where your tokens go, what's wasted, and how to use the tools better — turned into a **shareable scorecard**.
> Both platforms are first-class and symmetric (not a Codex-only tool); more agent CLIs (OpenClaw, Harness, …) are planned. Design & decisions live in [`docs/`](docs/).

## What it does

- **Usage report**: read-only parse of your local **Claude Code / Codex** records — tokens, estimated cost,
  tool calls, and breakdowns by repo / hour / source / language / git habits / config scan. Read-only; changes nothing.
- **Behavior signals (per turn)**: every instruction you give becomes one *episode*, with derived numbers only —
  where work went in circles, your personal **context shelf life** (after roughly how many turns sessions get
  worse), how outcomes compare across **effort levels / models** for the same kind of task, which files get
  edited again and again across sessions, and which **native features you haven't adopted yet** (backed by the
  tool's own usage counters, not guesswork).
- **Advice** (two skills): teach Claude Code / Codex to interpret this data — **ccoach-insight** gives
  **feature-first** advice + the report/scorecard (whenever a finding can be solved with a native feature —
  CLAUDE.md/AGENTS.md, subagents, hooks, plan mode, permission settings, model/effort tiers… — it names the
  feature; supports **session / project / global** scopes), and **ccoach-deepinsight** is a semantic
  **root-cause coach** that reads your real code to explain *why* work churned and the concrete fix.
- **Shareable scorecard**: grade your usage / habits / prompts across four axes (Prompt Skill, Spending
  Style, Engineering Sense, Diligence) into a screenshot-friendly card at the top of the HTML report
  (bilingual zh/en, rendered by the skill).

> **Privacy**: all analysis runs locally — your prompts never leave your machine.

## ccoach skills

Two reusable skills turn the raw CLI data into something human — install both with one command:

- **[ccoach-insight](skills/ccoach-insight/SKILL.md)** — the **usage report + shareable scorecard**. Reads local **Claude Code + Codex** data from `ccoach report --json` (tokens, per-model breakdown and behavior for *both* platforms), computes authoritative cost from each model's **official online price**, and renders an HTML report fronted by a screenshot-ready scorecard. It can drill from high-token projects down to candidate sessions (`ccoach sessions`). Glanceable, a little playful.
- **[ccoach-deepinsight](skills/ccoach-deepinsight/SKILL.md)** — a serious, semantic **root-cause coach** for a single project. Goes beyond aggregate metrics: it reads your own real code (read-only) to tell you, in plain language, **why** your work kept getting redone and the concrete fix — always anchored to an official native feature (plan mode, `@file` references, hooks, `/clear`, subagents, CLAUDE.md / AGENTS.md anchors), and always **verified against the current official docs before it recommends anything**. It also reads the new per-turn signals — context shelf life, effort comparisons, file-edit hotspots, feature-adoption hints — and is honest by design: it says "this is healthy work, no change needed" when that's the truth, and labels thin samples as low-confidence instead of forcing a conclusion. The deliverable is solutions, not metrics.

Both are privacy-first: read-only, local, and never exfiltrate. They analyze **user prompts + permissions + tool calls only** — never assistant replies; a selected session's prompts are read only after approval, hidden system prompts are never read, and everything written out is desensitized.

### Install the skills (Claude Code + Codex)

Install via the [`skills`](https://github.com/vercel-labs/skills) CLI (you already have Node — nothing else to install):

```bash
npx skills add loredunk/ccoach
```

One command installs **both** skills (the repo auto-discovers `skills/*/SKILL.md`). It prompts you to pick the agents (Claude Code / Codex) and scope (global / project) — choose what you want. Update or remove by name, e.g. `npx skills update ccoach-insight ccoach-deepinsight`.

> **Platforms**: the `ccoach` CLI runs natively on macOS / Linux / Windows (pure Node, no shell-out). The skills are Bash command sequences (they use `/tmp` and POSIX shell syntax), so on **Windows run your agent under Git Bash or WSL**; the `.mjs` render scripts themselves are cross-platform.

### Use them

You don't run a command — you just talk to your agent. Once a skill is installed, ask in plain language and the agent picks the right one:

- **Usage report / scorecard** → *"Review my Claude Code and Codex usage for the last 7 days."* · *"Which projects burned the most tokens this week?"* · *"Build me an HTML dashboard of how I used AI today."*
- **Deep root-cause coaching** → *"Why do I keep reworking this project?"* · *"Where am I wasting effort with Claude Code here, and what should I change?"* · *"Give me a deep insight into how I work in this repo."*

Prefer to call them by name? In **Claude Code** type `/ccoach-insight` or `/ccoach-deepinsight` (in **Codex**, `$ccoach-insight` / `$ccoach-deepinsight`). On its own each covers a sensible default (the report → **today**; the deep coach → the **current project**); add a number of days (`7`) or a date (`2026-06-01`) to widen the window.

Both are **English by default** — just ask in Chinese (or for a Chinese report) and the agent renders it in Chinese (see each skill's `SKILL.md`).

## Install CLI

Both skills run the **`ccoach` CLI** under the hood — you can also use it directly to see the raw usage report they build on. Here's how to install and use it.

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
ccoach --scope project          # global | project | session | episode (adds projects[] / sessions_detail[] / episodes_detail[])
ccoach --lang zh                # output language: en | zh (default: en)
ccoach --json                   # JSON output, script / agent friendly
ccoach sessions --top 20        # session candidates (numbers only); --id <id> drills ONE session — no date window needed
ccoach digest --id <id>         # opt-in: token-bounded, redacted content digest of one session (never thinking/system)
```

## Notes & boundaries

- **Local machine only**: rollouts are per-machine; this tool reads only local files and never aggregates across machines.
- **No quota percentages**: `rate_limits` is always null under the CLI, and quota is account-level / cross-machine.
- **Behavior signals are derived values only**: counts, rates, and whitelisted labels — never raw text. File-edit hotspots show file names (base name only, no paths) and only in local project analysis — never on the shareable card; feature-adoption signals read a fixed whitelist of local counters and nothing else.
- **Cost is an estimate**, not your actual bill. The CLI ships a best-effort **offline fallback** price table; **authoritative** cost is computed by the report skill, which looks up each observed model's **official online price** per token class. Tokens (and the offline cost) are cross-checked against `ccusage` — token-exact, cost within 1% — via `npm run verify:ccusage` (ccusage is a dev/CI check only, never a runtime dependency).
- Time windows use absolute local-timezone day boundaries; the report header states the timezone.

## Credits

Thanks to [ccusage](https://github.com/ryoppippi/ccusage) by [@ryoppippi](https://github.com/ryoppippi) — ccoach's local-usage parsing took inspiration from its approach, and I lean on ccusage to cross-check and calibrate ccoach's token / cost numbers while developing. 🙏
