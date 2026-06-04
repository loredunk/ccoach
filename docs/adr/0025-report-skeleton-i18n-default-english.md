# ADR 0025 — 报告骨架 i18n：抽到文案表、可扩展 locale、默认英文

> 状态：已接受 · 日期：2026-06-04（已实现：`references/report-copy.json` + `render_dual_platform.mjs` / `render_enriched_codex_report.mjs` 接 `--lang`、`scorecard.mjs` 默认翻英、SKILL.md 同步、回归 `test/i18n-report.test.ts`）
> · 扩展 [`adr/0009-i18n-scorecard-copy.md`](0009-i18n-scorecard-copy.md)（成绩卡文案「人工本地化、非直译」口径）到**整个报告骨架**
> · 与 [`adr/0024-report-input-token-display-parity.md`](0024-report-input-token-display-parity.md) 同批落地（同一渲染器）

## 背景

用户反馈「下载下来的 HTML 报告都是中文」，即使想要英文（TODO T15）。根因：

- 成绩卡文案（`scorecard-copy.json`）虽 zh/en 双份（ADR 0009），但**报告骨架本身的 UI 文案在两个渲染器
  （`render_dual_platform.mjs` / `render_enriched_codex_report.mjs`）里硬编码中文**（区块标题、表头、标签、
  fallback、注脚、`<html lang>`），且 `main()/render()` **从不读 `--lang`**（`render_dual` 注释里写了
  `[--lang zh|en]` 但忽略），`htmllang` 硬编码 `zh-CN`。
- SKILL.md 示例默认 `--lang zh`，且指导 agent「Use Chinese unless asked otherwise」。

## 决策

1. **报告骨架文案表 `references/report-copy.json`**（与 `scorecard-copy.json` 并列、各司其职）：
   `dual` / `enriched` 两段，每段含任意 locale 的键集；渲染器加载后按 `--lang` 取，**缺失键逐键回退到默认
   语言**（`default: "en"`），故新增的不完整 locale 可优雅降级。占位符 `{name}`、内嵌 `<b>`/`<code>` 在翻译时保留。
2. **两个渲染器接 `--lang`**：模块级 `setI18n(copy, lang)` + `tr(key, vars)`；`<html lang>` 也从文案表取。
   所有硬编码中文 UI 文案改 `tr(...)`。`languages_unit` 由 merge 改吐中性键 `files`/`sessions`，渲染器再本地化；
   每个面板的 `source` 标签也改用文案表（`src_claude`/`src_codex`），不再用 merge 的中文常量。
3. **默认语言 = 英文**（2026-06-04 拍板，与英文为主 README、npm 全球分发一致）：`render×2` 与 `scorecard.mjs`
   缺省 `--lang` 时一律 `en`；只在显式 `--lang zh`（或他语）时切换。SKILL.md 示例默认值由 `--lang zh` 改 `--lang en`，
   并把「Use Chinese unless asked」改为「写 insights 用用户语言、不明则默认英文，与 `--lang` 一致」。
4. **语言来源**：沿用现架构——**agent（SKILL.md 指导）按用户对话语言传 `--lang`**，脚本缺省即英文；
   不引入环境（`$LANG`）探测（这些脚本由 agent 调用，非用户直接跑）。
5. **本次范围 = zh/en + 可扩展结构 + 回退**：结构支持任意 locale、文档说明如何加（遵 ADR 0009 人工本地化、不机翻）；
   本期只填 zh/en，其余 locale 留待后续人工补、缺失回退英文。

## 边界 / 已知遗留（显式 follow-up，不在 T15 范围内）

T15 限定「渲染器骨架 UI 文案」。以下中文来自 **CLI 层**、未在本 ADR 覆盖，故英文报告里仍可能出现：

- `src/habits.ts` 生成的 git / 项目管理**信号短语**（如「经常检查工作区状态」「个活跃项目观察到测试命令」），
  经 `ccoach report --json` → merge `extras` → 渲染器原样显示。
- `merge_dual_platform.mjs` 拼进 `extras` 的少量前缀（「权限模式」「子代理消息」「推理 token 占比」）。
- CLI `src/window.ts` 生成的窗口描述 `generated_for`（如「最近 N 天」「X 至 Y」），经 `window.desc` 进报告页眉。
- CLI 文本 emitter `src/emit/text.ts` 全中文（`ccoach report` 人读输出）。

这些属于**「CLI 自身 i18n」**——比报告骨架更深一层，需要给 CLI 引入语言层（信号短语结构化 / emitter 文案表）。
列为后续任务（见 TODO）。agent 写的 insights 已随用户语言（SKILL.md 第 5 步），不在此列。
