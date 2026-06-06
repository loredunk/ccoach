# ADR 0044 — Scorecard persona title / roast render-order guard

> 状态：已接受 · 日期：2026-06-06
> · 实现 [`adr/0008`](0008-gamified-shareable-scorecard.md) D3「人格称号由模型撰写」与 [`adr/0029`](0029-model-authored-scorecard-roasts.md) 的兜底定位
> · 关联 skill 工作流 `skills/ccoach-insight/SKILL.md` step 6/7

## 背景

成绩卡的人格称号（`title`）与每轴 `roast` 约定由 skill 的 agent 在报告期按用户语言撰写
（ADR 0008 D3 / 0029）。`scorecard.mjs` 只产出**确定性兜底**：`title` 是 `A × B × C × D`
的轴名拼接、`roast` 直接取自 `references/scorecard-copy.json` 的 fixture。

实践中出现**渲染顺序 bug**：agent 先渲染 HTML、后才把人格称号写回 `/tmp/scorecard.json`，
或漏改就渲染——`render_dual_platform.mjs` 直接 `esc(sc.title)` 无任何检测，于是部署出去的
`ai-usage-report.html` 显示的是 fallback「卡瓶颈 × 富哥随意 × 架构师 × 劳模」，而非
「深夜烧 Opus 的劳模架构师」。SKILL.md 当时只用 advisory 散文要求写回，无强制次序、无自检。

## 决策

三处协同，**保证最终渲染的是模型撰写的称号/roast，同时不破坏离线/测试兜底**：

1. **标记（`scorecard.mjs`）**：兜底 `title` 旁输出 `title_is_fallback: true`；每条 fixture
   `roast` 所在轴输出 `roast_is_fixture: true`。agent 写回时一并置 `false`。
2. **检测 + 兜底（`render_dual_platform.mjs` 的 `scorecardHtml`）**：判定 fallback =
   `title_is_fallback===true || /\s×\s/.test(title)`（双保险：即便只改 title 没清 flag，形态
   也能兜住）。命中则 **stderr 醒目警告** + HTML 留 `<!-- ccoach:scorecard_title_is_fallback -->`
   可见标记，但**仍出图**（保 ADR 0029 的离线/纯测试/opt-out 兜底路径，不硬失败）。
3. **强流程（`SKILL.md`）**：把「写回 title/roast」从 advisory 提为 step 7 渲染前的**强制有序
   子步骤**，并在 step 7 后加**自检**（看到 `⚠ scorecard:` 警告即修正后重渲）。次序固定：写回 → 渲染。

## 影响

- 漏改/先渲染后改不再静默发出 fallback：stderr 警告 + HTML 标记使其可被发现。
- 不改 `--json` 契约；`scorecard.json` 仅新增两个布尔字段（向后兼容，ADR 0004/0010）。
- 不采用「render 默认硬失败」：会逼迫离线/测试每次显式放行，与 ADR 0029 兜底定位冲突。
