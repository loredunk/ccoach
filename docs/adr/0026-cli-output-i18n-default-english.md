# ADR 0026 — CLI 输出 i18n：默认英文 + 保留 `--lang zh`

> 状态：已接受 · 日期：2026-06-04（已实现：`src/i18n.ts` + `emit/text.ts`/`habits.ts`/`window.ts`/`cli.ts`/`model.ts` 改造 + 回归 `test/i18n-cli.test.ts`）
> · 与 [`adr/0025-report-skeleton-i18n-default-english.md`](0025-report-skeleton-i18n-default-english.md) 同口径（默认英文、人工本地化、缺失回退）：0025 管 skill 渲染层，本篇管 CLI 输出层，闭环 0025 记的「英文报告夹 CLI 层中文」遗留
> · 不动 token/成本/对账（沿用 [`adr/0013`](0013-self-built-unified-parser.md) 的统一结构与 ccusage 交叉验证）

## 背景

产品转向**英文市场**。但 ccoach CLI 的输出全中文：`ccoach report` 人读文本（`emit/text.ts`）、`habits.ts` 的
git/项目管理**信号短语**、`window.ts` 的窗口描述、`model.ts` 的 `REPORT_GLOSSARY`。其中 habits 信号与窗口描述经
`ccoach report --json` 进 skill 报告——正是 ADR 0025「已知遗留」里英文报告仍夹中文的根源。CLI 此前无语言层。

## 决策

1. **新增 `src/i18n.ts`**：`en`/`zh` 两套文案表 + 模块级 `setLang(lang)` / `t(key)` / `tf(key, vars)`（`{name}` 插值）。
   **默认 `en`**、未知 locale 回退 `en`；`zh` 值逐字对齐改造前的中文，使 `--lang zh` 复现旧输出。
2. **`cli.ts` 加 `--lang <en|zh>`（默认 en）**，在 `resolveWindow`/`buildReport`/emit 之前 `setLang()`；
   cac 的 help/命令描述改**英文字面量**（help 在 parse 前注册，无法按 `--lang` 切，且面向开发者）。
3. **`emit/text.ts` / `habits.ts` / `window.ts` 全量改 `t()/tf()`**。`emit/text.ts` 的 label 映射
   （平台/计费模式/置信度）改为**调用期解析**的函数（模块加载早于 `setLang`）。`project_management.signals`
   的分隔符由全角 `；` 改 ASCII `; `，避免英文输出夹全角标点。
4. **`REPORT_GLOSSARY` 改英文单语**：它是 `--json` 里给 agent 的自描述、非终端用户可见，双语维护不值；
   英文也利于英文市场的 agent 消费。措辞避开隐私回归用到的扫描词（如不写 "balance"）。
5. **SKILL（ccoach-insight）透传 `--lang`**：定义 `<L>`，要求 `ccoach report` / `scorecard.mjs` / `render_*.mjs`
   同传同一 `--lang`；默认英文。这样 `--lang zh` 时 ccoach 也出中文信号，报告全中文；默认英文则全英文。

## 边界 / 影响

- **不改 token/成本**：`--json` 的数值字段与口径不变；`verify-ccusage.ts` 只校 `tokens.total`/成本，两平台仍 OK。
- **`--json` 信号/窗口默认英文**：这是契约里的人读文本字段（`git_habits.*_signals`、`project_management.signals`、
  `generated_for`），其语言随 `--lang`，默认英文。skill 消费的是这些字符串本身、不做语义解析，故安全。
- **用户数据仍按原文**：报告里出现的中文是用户真实仓库/项目名等**数据**（如 `简历`、`网易云音乐`），我们只本地化
  自己的文案、不改用户数据，符合预期。
- help 文案英文单语（开发者面）；`REPORT_GLOSSARY` 英文单语（agent 面）。
