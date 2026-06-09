---
name: ccoach-autoresearch
description: A self-evolving deep-insight loop — extract the smallest high-signal probe of how you work in a project, generate a semantic root-cause insight (reusing the ccoach-deepinsight method), score it on a verifiable rubric, and write what it learned back into a persistent strategy so the NEXT run is cheaper and sharper. Closed, verifiable, optimizable. Read-only, local, desensitized. Claude Code + Codex.
when_to_use: 'Trigger when the user wants the deep-insight process itself to get faster/better over repeated runs on a project — "auto-research my usage", "self-improving insight", "keep tuning the deep dive", "/ccoach-autoresearch", or when a full deep-dive is too slow and you want the highest-quality root cause for the fewest tokens. For a single one-off deep dive use ccoach-deepinsight; for the fun scorecard use ccoach-insight.'
argument-hint: "[YYYY-MM-DD | N (days back)] [--platform claude-code|codex]"
arguments: period
allowed-tools: Read Grep Glob WebSearch WebFetch Bash(ccoach *) Bash(npx *) Bash(node *) Bash(git *)
---

# ccoach-autoresearch — a self-evolving deep-insight loop (Claude Code + Codex)

## Purpose

Turn the deep-insight *process itself* into a small training loop: each run uses the **smallest high-signal probe** to produce a semantic root-cause insight, **scores** that insight on an explicit rubric, and **writes back** what it learned so the next run gets the highest quality for the fewest tokens. The point is the same as the rest of ccoach — see clearly, waste less — applied recursively to the analysis.

Three properties hold by construction:
- **Closed** — extract → insight → eval → optimize → (next) extract.
- **Verifiable** — every insight gets a reproducible 0–1 quality score plus its token cost; the loop reports its own number.
- **Optimizable** — the strategy is a mutable, diffable artifact on disk, and `quality per 1k tokens` should climb across runs (and can be A/B'd old-vs-new on one project).

The insight step is **not reinvented** — it calls the existing **ccoach-deepinsight** method (semantic root cause, official-feature-first, grounded, honest). This skill is the outer loop around it.

## Privacy (red lines — unchanged)

Read-only; local; never exfiltrate; this machine only. The probe reads only the existing `ccoach --json` output (aggregate, no bodies), read-only git, and a few label/count signals from `~/.claude` (no message text). The strategy ledger is **pure aggregate** — dimension names, scores, counts, and desensitized finding titles — with **zero** prompt or assistant/digest content; every write is guarded. The only content ever read is the opt-in, token-bounded, redacted falsification digest — and only on a high-confidence session-intent claim that needs to be tested before it is asserted. Never read thinking / system·developer prompts / file contents as content. Desensitize all paths/identifiers to `<…>`.

## Setup

Locate the CLI: prefer `ccoach` on PATH; else `node dist/cli.js` in this repo; else `npx @loredunk/ccoach@latest`. The loop scripts live in `${CLAUDE_SKILL_DIR}/scripts/`. If the CLI is not on PATH, pass it through, e.g. `CCOACH_CMD="node /path/to/dist/cli.js" node ${CLAUDE_SKILL_DIR}/scripts/probe-runner.mjs …`.

Pick the platform (`claude-code` default, or `codex`) and a window (`--since YYYY-MM-DD` or `--days N`, default 30). Use the project repo path as the project key.

## The loop

### 1 · EXTRACT — the minimal probe

```
node ${CLAUDE_SKILL_DIR}/scripts/probe-runner.mjs --platform <P> --days <N> --repo <repo-path>
```

This runs two cheap, body-free CLI passes (`--scope project` and `--scope episode`), **immediately distills** the large episode dump down to the deepest pit + the spiral-flagged subset (the single biggest token saving), reads read-only git hot files + the verify-gate signal, and adds the `~/.claude` label/count signals. It emits a compact probe JSON with a **deterministic per-dimension anomaly rank**.

Read the `anomalies.ranked` list and take the **top 1–3 dimensions** (skip any near zero — a quiet dimension means "no change needed there", which is a healthy and cheap outcome). Honor the strategy's `dimension_order` if a ledger already exists for this project.

### 2 · INSIGHT — reuse ccoach-deepinsight, scoped to the chosen dimensions

Run the **ccoach-deepinsight** method, but only on the 1–3 chosen dimensions and the code the probe pointed at, **conditioned on the strategy**:
- inject the strategy's `framing` and any prior `lessons[]` (the verbal gradient) into how you write the findings;
- read the platform's own guide — **CLAUDE.md for claude-code, AGENTS.md for codex** (never crossed) — and the specific hot files;
- run noisy multi-session scanning inside a subagent so it returns only the distilled finding, keeping the main context clean;
- **self-refine once** against the rubric (below) before emitting.

Emit findings in the deepinsight finding shape: `title`, `category` (`cognitive_gap | prompt_issue | code_structure | workflow | unknown_feature`), `confidence`, `root_cause`, `fix`, `feature` (official only), `signal` (≤1 demoted metric).

### 3 · EVAL — score each finding on the verifiable rubric

```
echo '<finding-json>' | node ${CLAUDE_SKILL_DIR}/scripts/eval-judge.mjs --accepted <ledger.json>
```

`eval-judge.mjs` scores the 6-criterion rubric (`references/autoresearch-rubric.md`). The deterministic floor — **C2 semantic-not-metric**, **C4 official-feature-only (hard gate)**, **C6 novel-vs-prior** — runs as pure code with no model and no content. The judged criteria — **C1 grounded-in-window**, **C3 actionable**, **C5 survives-falsification** — use a bias-defended, calibrated judge (and, for C5 only, an opt-in tight digest); until the judge is calibrated to ≥80% agreement on the golden set they report N/A and you make those calls yourself. A finding that hard-fails C4 (names a third-party habit skill) is rejected outright.

The result carries `quality` (0–1, mean of applicable criteria) and `cost`.

### 4 · OPTIMIZE — write back to the strategy

```
node ${CLAUDE_SKILL_DIR}/scripts/strategy-update.mjs --platform <P> --project <repo> \
  --quality <q> --cost '<cost-json>' --accepted-add '<finding-json>'
```

This appends one `iterations[]` row (`quality`, `cost`, `quality_per_1k_tokens`) to the per-project ledger, records the accepted findings (for novelty), and — once the judged criteria are live — appends a short verbal `critique` to `lessons[]` for every low-scoring criterion and nudges the dimension bandit. The ledger is the loop's memory; it is re-read from disk at the start of the next run.

### 5 · LOOP

Compact between cycles, re-read the ledger from disk, and run again. The headline you report each time is **`quality_per_1k_tokens`** — it should climb. To prove an improvement is real, run the same project and window twice — once with the frozen current strategy, once with a candidate — and keep the candidate only if it raises quality without a cost regression (or strictly improves cost at equal quality).

## Output

Report, in plain language: the 1–3 dimensions the probe flagged for this project, the semantic root cause and concrete official-feature fix for each (the deepinsight deliverable), the eval `quality` and token `cost`, and whether this run improved on the last. Be honest: if a flagged dimension turns out to be healthy work or an instrument limitation, say so — that is a correct, cheap result, not a failure.

## Codex notes

Symmetric: pass `--platform codex`. The probe reads Codex rollouts via the same CLI contract; the `~/.claude` label signals are claude-code-only and are skipped (labeled) for Codex. For the project guide read **AGENTS.md** (Codex does not read CLAUDE.md) — if a repo has only CLAUDE.md, report that Codex ran with no project guide and recommend adding an AGENTS.md. Red lines unchanged: never read reasoning / developer / system content.
