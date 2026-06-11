# deepinsight report JSON — schema for `render_deepinsight.mjs`

The renderer consumes one report JSON and emits a standalone HTML "diagnostic dossier". Every field is HTML-escaped; all fields optional (missing → omitted). Keep the privacy discipline: desensitize identifiers to `<…>` before rendering anything you will share; assistant/tool_result content stays redacted (only ever paraphrased into `root_cause`/`headline`, never pasted).

```json
{
  "project": "ccoach",
  "platform": "claude-code",
  "lang": "zh",
  "window": "last 60 days (… → …)",
  "generated_at": "2026-06-07",
  "tldr": "1-2 sentence verdict (solutions, not metrics) — keep it short; the renderer auto-generates a clickable findings list right below it, so do NOT enumerate findings here",
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
          "category_label": "optional — badge text in the report language; REQUIRED when category is outside the known list (otherwise the badge falls back to the title-cased English key)",
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
  "project_health": {
    "summary": "one sentence: the single piece of common-sense project hygiene this repo most lacks",
    "dimensions": [
      {
        "id": "security_data",
        "score": 2,
        "status": "登录鉴权完整，但配置文件里有一处硬编码的数据库口令；未见迁移目录",
        "evidence": "读了 <config file> 与 db 连接模块；发现一处明文凭据（值已隐去）",
        "advice": "把口令移入环境变量并确认已 gitignore；引入迁移工具管理表结构变更"
      },
      { "id": "stability_resources", "score": 3, "status": "…", "evidence": "…", "advice": "…" },
      { "id": "verification_testing", "status": "未评估：本次没有读到 CI 配置与测试目录" },
      {
        "id": "architecture_layering",
        "score": 1,
        "status": "路由、业务逻辑和 SQL 都挤在同一层文件里",
        "evidence": "3 个文件超过 900 行，且各被 5 个以上模块引用",
        "advice": "先把数据访问抽成独立模块，再拆业务层",
        "threshold": "单文件超过 ~800 行、同时被 3 个以上模块引用时，就到了该拆的程度"
      }
    ]
  },
  "honesty": [ "instrument-limitation / dogfooding notes (not user behavior)" ],
  "privacy": "footer line"
}
```

Notes:
- `category` is an **open** enum: the known values drive the color code and render as localized,
  self-explanatory badges (e.g. unknown_feature → "Native feature available" / 「有现成官方特性」 — an
  opportunity, not a defect); a legend near the top of the report explains each known category that appears.
  Any other snake_case value is rendered with its own label (neutral color) — supply `category_label` in the
  report language so non-English reports don't show a title-cased English key. When you created the category
  from evidence (it fits none of the known five), set `novel_category: true` — the renderer adds a small
  "novel" marker so readers see it is a discovered, not predefined, class.
- `verdict.tone` colors the banner (healthy=green, churn=cyan, mixed=amber).
- `kind` and `title` are reader-facing headers (section heading + findings-list group label) — write them
  in the report language like everything else (zh report → e.g. `"kind": "项目层"`,
  `"title": "一次修好的系统性问题"`); the English example values above are placeholders, not a template.
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
- `project_health` (optional, **Beta**) is the project health check rendered after the passes, with a
  clickable row in the findings list. Rules:
  - `id` is a fixed enum — `security_data | stability_resources | verification_testing |
    architecture_layering` — the renderer carries bilingual labels for these. A non-standard `id` must
    bring its own `label` (report language) and renders in a neutral color.
  - `score` is an integer 0-4; the renderer derives the level word (0 missing/缺失 · 1 weak/薄弱 ·
    2 gaps/有缺口 · 3 good/良好 · 4 solid/扎实) — do not invent your own level field. **Omitting `score`
    means "not assessed"** (rendered as an empty dashed bar): use it whenever you did not actually read
    enough to judge, and say in `status` what was not assessed and why. Never guess a score.
  - a score may only come from files you actually opened; `evidence` says what you read (identifiers
    desensitized to `<…>`, file names at most a basename). If you find a hardcoded secret, report the
    finding — **never write the secret's value into any field**.
  - `threshold` (optional, mainly for `architecture_layering`) states when refactoring starts to pay off,
    anchored to this repo's real numbers — not generic dogma.
  - this block is for the local report only — never carry it into anything shareable.
- `lang` (`"zh"` / `"en"`, default `en`) sets `<html lang>` and the on-page **术语 / Terms** glossary the renderer prints after the TL;DR (回合 / 原地打转 / 严重程度 with plain-language defs — spiral before severity, since severity is defined as the degree of spiraling). Write your findings using these reader-friendly terms (回合 / 原地打转 / 严重程度; en: episode / "went in circles" / severity), not raw `episode`/`spiral`/`severity` jargon, so the glossary explains what the prose uses.
- Render: `node ${CLAUDE_SKILL_DIR}/scripts/render_deepinsight.mjs --data <report.json> --output ccoach-deepinsight.html`.
