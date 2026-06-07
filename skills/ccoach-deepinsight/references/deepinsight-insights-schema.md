# deepinsight report JSON — schema for `render_deepinsight.mjs`

The renderer consumes one report JSON and emits a standalone HTML "diagnostic dossier". Every field is HTML-escaped; all fields optional (missing → omitted). Keep the privacy discipline: desensitize identifiers to `<…>` before rendering anything you will share; assistant/tool_result content stays redacted (only ever paraphrased into `root_cause`/`headline`, never pasted).

```json
{
  "project": "ccoach",
  "platform": "claude-code",
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
      "digest_stats": "tight ~7.5K tok · RESULT_ERR 1/75 · redacted · no thinking",
      "findings": [
        {
          "title": "plain-language root-cause statement",
          "category": "cognitive_gap | prompt_issue | code_structure | workflow | unknown_feature | other",
          "confidence": "high | med | low",
          "root_cause": "the semantic why, in human terms",
          "fix": "the concrete action to take",
          "feature": "official Claude Code feature name (rendered as a pill); '' if none",
          "signal": "at most ONE supporting metric — rendered demoted, never the headline"
        }
      ]
    }
  ],
  "honesty": [ "instrument-limitation / dogfooding notes (not user behavior)" ],
  "privacy": "footer line"
}
```

Notes:
- `category` drives the color code; unknown values fall back to `other`.
- `verdict.tone` colors the banner (healthy=green, churn=cyan, mixed=amber).
- `signal` is intentionally rendered small and faint — the root cause and fix are the product, metrics are corroboration only.
- Render: `node ${CLAUDE_SKILL_DIR}/scripts/render_deepinsight.mjs --data <report.json> --output ccoach-deepinsight.html`.
