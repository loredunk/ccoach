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
    "stage": {
      "level": "prototype | shipping | serving",
      "label": "原型期",
      "basis": "近 30 天提交 ~3 次/周 · repo 无 CI 配置 · 会话与提交从未提及部署或真实用户",
      "note": "原型期只看安全红线级别的盲区，其余维度先不打扰"
    },
    "summary": "一句话：当前协作里最值得补的一个盲区",
    "dimensions": [
      {
        "id": "security_data",
        "attention": "never",
        "statement": "过去 30 天的会话和提交里，鉴权/密钥相关的工作从未出现过，而 repo 里已有登录模块",
        "basis": "检索了本窗口的会话提示词与提交信息：0 次命中鉴权/密钥/迁移相关词；<auth 模块> 存在于 repo",
        "homework": "下个会话让 Claude 跑一遍 security review，重点看 <…> 这三个文件",
        "feature": "/security-review"
      },
      {
        "id": "verification_testing",
        "attention": "touched",
        "statement": "测试只在 2 个会话里出现过，编辑后没有任何自动验证动作跟随",
        "basis": "会话提示词与命令记录里测试相关词命中 2 次；repo 无 CI 配置文件",
        "homework": "让 agent 配一个编辑后自动跑 typecheck/test 的钩子，结果直接喂回",
        "feature": "PostToolUse hook"
      },
      { "id": "stability_resources", "locked": true, "statement": "原型期先不打扰——出现真实用户信号后解锁" },
      { "id": "architecture_layering", "statement": "未核查：本次没有读取文件长度与引用关系" }
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
- `project_health` (optional, **Beta**) is the **project blind-spot coach** rendered after the passes
  (with a clickable row in the findings list whenever the section renders). ccoach is a coach, not an
  auditor: it names blind spots and assigns homework — the audit itself is the agent's job in a
  follow-up session. Rules:
  - **Stage gate first.** `stage.level` is judged from verifiable signals only (commit frequency, CI
    config presence, deployment/real-user mentions in sessions/commits) and `stage.basis` states those
    signals. At `prototype`, report only security-redline blind spots and mark the other dimensions
    `locked: true` (rendered as a quiet "not unlocked at this stage" row, no homework) — telling a
    weekend prototype it lacks observability is noise, not coaching.
  - **Statements are verifiable behavior/presence facts, never audit verdicts.** Good: "auth/secret
    work never appeared in your sessions or commits in this window", "no CI config file exists",
    "a ~1,400-line file imported by 5 modules" — all checkable with a grep. Never: "your project's
    auth is weak / lacks X" — one false positive there (tests living in an unusual directory ≠ no
    tests) costs all trust. `basis` says how you checked.
  - `attention` is the dimension's presence in THIS window's sessions/commits: `never | touched |
    practiced`. **Omitting `attention` means "not checked"** (rendered as a dashed empty track) — use
    it whenever you did not actually check; never guess.
  - `homework` is one assignment the user can hand to the agent next session, anchored to an official
    feature (`feature` renders as a pill; the verification-first rule applies): a security review run,
    a test-gate hook, a refactor assessment — ccoach never performs the audit itself.
  - `id` is a fixed enum — `security_data | stability_resources | verification_testing |
    architecture_layering` — the renderer carries bilingual labels. A non-standard `id` must bring its
    own `label` in the report language.
  - Desensitize as everywhere (identifiers → `<…>`, file names at most a basename); if you find a
    hardcoded secret (a presence fact — reportable), **never write the secret's value into any field**.
  - This block is for the local report only — never carry it into anything shareable.
- `lang` (`"zh"` / `"en"`, default `en`) sets `<html lang>` and the on-page **术语 / Terms** glossary the renderer prints after the TL;DR (回合 / 原地打转 / 严重程度 with plain-language defs — spiral before severity, since severity is defined as the degree of spiraling). Write your findings using these reader-friendly terms (回合 / 原地打转 / 严重程度; en: episode / "went in circles" / severity), not raw `episode`/`spiral`/`severity` jargon, so the glossary explains what the prose uses.
- Render: `node ${CLAUDE_SKILL_DIR}/scripts/render_deepinsight.mjs --data <report.json> --output ccoach-deepinsight.html`.
