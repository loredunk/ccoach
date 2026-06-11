# deepinsight report JSON — schema for `render_deepinsight.mjs`

The renderer consumes one report JSON and emits a standalone HTML "diagnostic dossier". Every field is HTML-escaped; all fields optional (missing → omitted). Keep the privacy discipline: desensitize identifiers to `<…>` before rendering anything you will share; assistant/tool_result content stays redacted (only ever paraphrased into `root_cause`/`headline`, never pasted).

```json
{
  "project": "ccoach",
  "platform": "claude-code",
  "lang": "zh",
  "window": "last 60 days (… → …)",
  "generated_at": "2026-06-07",
  "tldr": "one-paragraph verdict (solutions, not metrics)",
  "passes": [
    {
      "id": "01",
      "kind": "Pass · Project",
      "title": "Systemic, ship-once",
      "meta": "optional sub-line",
      "verdict": { "label": "False alarm — healthy delivery", "tone": "healthy|churn|mixed", "note": "optional" },
      "headline": "optional reframing sentence (session passes)",
      "grounding": [ { "hash": "37c4343", "ts": "2026-06-04 21:11 +08", "subject": "what shipped in-window" } ],
      "digest_stats": "compact summary ~7.5K tokens · 1 of 75 turns errored · redacted · no thinking content",
      "findings": [
        {
          "title": "plain-language root-cause statement",
          "category": "cognitive_gap | prompt_issue | code_structure | workflow | unknown_feature | other | <any snake_case category you create>",
          "novel_category": false,
          "confidence": "high | med | low",
          "root_cause": "the semantic why, in human terms",
          "fix": "the concrete action to take",
          "feature": "official Claude Code feature name (rendered as a pill); '' if none",
          "signal": "at most ONE supporting metric — rendered demoted, never the headline"
        }
      ]
    }
  ],
  "magic_time": [
    {
      "value": "74", "unit": "min",
      "label": "fast mode saved you about 74 minutes of waiting",
      "basis": "Codex App's own estimate, across 56 completed runs",
      "tone": "win"
    }
  ],
  "honesty": [ "instrument-limitation / dogfooding notes (not user behavior)" ],
  "privacy": "footer line"
}
```

Notes:
- `category` is an **open** enum: the known values drive the color code; any other snake_case value is rendered
  with its own literal label (neutral color). When you created the category from evidence (it fits none of the
  known five), set `novel_category: true` — the renderer adds a small "novel" marker so readers see it is a
  discovered, not predefined, class.
- `verdict.tone` colors the banner (healthy=green, churn=cyan, mixed=amber).
- `signal` is intentionally rendered small and faint — the root cause and fix are the product, metrics are corroboration only.
- `digest_stats` is reader-facing prose like every other field: write it in the report language with plain
  words (as the example above), never internal pipeline tokens (`tight`, `RESULT_ERR`, …) — those stay in
  the `signal` margin.
- `magic_time` (optional, currently Codex-flavored) is a highlight strip of big numbers rendered above the passes.
  **Hard rule: every number must be either platform-self-reported (e.g. the Codex App's own fast-mode time-saved
  estimate) or an exact count from local data (accepted approval rules, subagents spawned, threads indexed). Never
  invent conversions or multipliers** ("each rule saves ~10s" is fabrication — don't). `basis` is mandatory and must
  name the provenance ("Codex App's own estimate", "exact count from your approval rules"); self-reported estimates
  must say so. `tone`: win (green edge) / loss (amber edge) / neutral. 3-5 items max — it's a highlight, not a table.
- `lang` (`"zh"` / `"en"`, default `en`) sets `<html lang>` and the on-page **术语 / Terms** glossary the renderer prints after the TL;DR (回合 / 严重程度 / 原地打转 with plain-language defs). Write your findings using these reader-friendly terms (回合 / 严重程度 / 原地打转; en: episode / severity / "went in circles"), not raw `episode`/`severity`/`spiral` jargon, so the glossary explains what the prose uses.
- Render: `node ${CLAUDE_SKILL_DIR}/scripts/render_deepinsight.mjs --data <report.json> --output ccoach-deepinsight.html`.
