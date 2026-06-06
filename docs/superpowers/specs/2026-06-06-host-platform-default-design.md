# 设计：ccoach-insight skill 默认出「当前宿主平台」报告，dual 转 opt-in

> 状态：草案（待实现） · 日期：2026-06-06 · 关联：拟新增 ADR 0042

## 背景与动机

当前 `skills/ccoach-insight` 的默认工作流**永远同时**生成 Claude Code + Codex 双平台报告
（`render_dual_platform.mjs`）。双平台对比曾被当作卖点，但实践中：

- Codex 与 Claude Code 的模型、harness 风格差异很大，强行并排对比意义有限；
- 一份报告塞两套平台数据，信息过载，照顾「双开用户」反而拖累「单平台用户」（多数情形）。

**目标**：让 skill 默认只出**用户当前所在平台**的报告——从 Claude Code 调起就出 CC 报告，从 Codex
调起就出 Codex 报告；双平台对比降级为**显式 opt-in**。

**非目标 / YAGNI**：

- 不改 CLI（`ccoach report --platform claude-code|codex|all` 已足够，零 CLI 改动）。
- 不做「探测到两个平台都用过就自动双开」的智能模式（已否决：违背「想分开」的初衷、且复杂）。
- 不在本期退役 `render_enriched_codex_report.mjs`（保留为既有 Codex-only fallback；要退役另起一篇 ADR）。

## 行为规则（核心）

skill 被调用时，按以下**优先级**决定出哪个平台的报告：

1. **用户显式点名平台**（最高优先，覆盖宿主探测）：
   - 「看我的 Codex 用量 / generate my Codex report」→ **Codex 单平台**；
   - 「看我的 Claude Code 用量」→ **CC 单平台**；
   - 「对比 CC 和 Codex / 双平台报告 / compare … vs … / both」→ **dual**（走现有 merge 两平台链路）。
2. **否则探测宿主平台**：`CLAUDECODE` 环境变量在 → `claude-code`；不在 → `codex`。出该平台单报告。
3. **宿主无法判定**（`CLAUDECODE` 不在、也认不出 Codex 标记——例如别的 harness 或管道里跑）→
   **不静默回退**，而是向用户给三选项提问：**① Claude Code ② Codex ③ 双平台对比**，用户选定后再跑。

## 宿主探测机制

SKILL.md 默认工作流新增「step 0：探测宿主平台」：

```sh
PLAT=$([ -n "$CLAUDECODE" ] && echo claude-code || echo codex)
```

- **确定性**：Claude Code 会注入 `CLAUDECODE=1`（外加 `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SESSION_ID`）；
  Codex 不设这些。已在真实 Claude Code 会话中验证这些变量存在。
- 不依赖模型「自己猜」；agent 本身亦知宿主，可作双保险，但 env 探针是确定性主路径。
- **隐私中性**：只读取一个布尔型环境变量，不读取任何内容。所有现有隐私红线（不读 assistant/thinking/
  system·developer prompt/文件内容、不外发、写入前脱敏截断）**完全不变**。

## 默认工作流（单平台路径）

把现有「Daily dual-platform report」工作流改写为宿主感知的单平台流程：

1. **step 0**：按上面的优先级解析出目标 `<P>`（`claude-code` / `codex`，或显式 dual / 无法判定时提问）。
2. 只跑 `ccoach report --platform <P> <W> <L> --json`（窗口 `<W>` / 语言 `<L>` 规则不变）。
3. （仅 `<P>=claude-code`）可选 `ccoach sessions --platform claude-code <W> --top 5`。
4. merge 单平台 → `apply_pricing` → 写 insights → scorecard → `render_dual_platform.mjs` 单面板。
5. **Claude Code 的默认 prompt review**（ADR 0015）只在 `<P>=claude-code` 时触发；Codex 默认无自动
   prompt review（它本就需要显式 `--id/--rollout`，opt-in 钻取路径不变）。

显式 dual 时走今天的两平台链路（`--platform claude-code` + `--platform codex` → merge 双 → 双面板），逻辑不变。

## 实现改动（渲染方案 A：泛化 merge + dual 渲染器为「N 面板」）

### 6.1 `scripts/merge_dual_platform.mjs`

- 现状：`--cc-report` 与 `--codex-report` **二者皆必填**，缺任一即 `exit 2`（line 321–326）；输出恒为
  `platforms:{claude_code, codex}` 双键，`combined` 恒两者相加。
- 改为：**至少给一个** report。
  - 只给一个时：`platforms{}` 只含该平台键；`combined` = 该平台的 cost/tokens/sessions；
    `window` 取该 report 的 `generated_for`。
  - 两个都给时：行为与今天**完全一致**（双键、combined 相加）。
- 文件名保留（它现在处理 1–2 个平台）。

### 6.2 `scripts/render_dual_platform.mjs`

- 从 `data.platforms` 读出**实际存在**的平台集合（`claude_code` / `codex` 之一或两者）。
- **对比区**（`compareMetric` 那段、`h_comparison` 标题、line 520–533 附近）只在**两平台都在**时渲染；
  单平台整段跳过。
- 平台面板（line 539–600 附近）、各自的 token 面板、对称 behavior 面板：**只画存在的平台**，跳过缺席平台。
- 平台无关区块（exec summary / AI recs / insights / scorecard 封面 / episode 卡片 / provenance）保留。
- **标题（H1）**：统一为品牌名 `ccoach Insight Report` / `ccoach 洞察报告`（单/双平台共用，替换原
  `Dual-Platform AI Usage Report`）；**平台范围**用副标题/标签呈现——单平台 → `Claude Code` 或 `Codex`，
  双平台 → `Claude Code + Codex`（面板头本就标注平台，副标题让分享截图自描述）。

### 6.3 `scripts/scorecard.mjs`（小改、向后兼容）

- 现状：`const cc = data.platforms.claude_code ?? {}`（line 152）——四轴评分**CC 中心**，Codex-only 输入时
  Prompt Skill / Engineering 轴会塌成空。
- 改为：`const host = data.platforms.claude_code ?? data.platforms.codex ?? {}`，四轴评「宿主平台」。
  - dual 时 `claude_code` 在 → `host = cc`，**今天行为完全不变**（向后兼容）；
  - Codex-only → `host = codex`，成绩卡四轴不再塌。
- `combined` 的用法不变（spending/diligence 读 `combined`，单平台时 combined 即该平台）。

### 6.4 `references/report-copy.json`（i18n）

- `report_title` 改为品牌名：英文 `ccoach Insight Report`、中文 `ccoach 洞察报告`（单/双平台共用 H1，
  替换原 `Dual-Platform AI Usage Report` / `双平台 AI 使用报告`）。
- 新增**平台范围副标题键**（如 `report_subtitle_scope`），值为对应平台名（`Claude Code` / `Codex` /
  `Claude Code + Codex`）；默认英文、逐键回退（ADR 0025）。
- `h_comparison` 仅 dual 渲染时使用，键保留。

### 6.5 `SKILL.md` frontmatter + `agents/openai.yaml`

- `description` / `when_to_use`：从「dual-platform (Claude Code + Codex)」改述为
  「默认生成你**当前所在平台**的报告；显式要求才出双平台对比」。保留单平台与 dual 两套触发语义。
- `agents/openai.yaml` 的 `default_prompt`：从「Generate an enriched dual-platform …」改为单平台/宿主感知
  （从 Codex 调起，默认就该是 Codex 单平台报告）。

## 文档改动

- **新增 ADR 0042**：「ccoach-insight 默认出宿主平台报告，dual 转 opt-in」——记录决策、探测机制、
  优先级规则（含无法判定时提问）、隐私中性（仅读 env 布尔、不碰内容）。`tools/check_adrs.mjs` 校验编号连续。
- 同步 `docs/PRD.md` / `docs/TODO.md`，反映默认行为从「双平台」改为「宿主单平台 + dual opt-in」。

## 测试

- **merge**：单 `--cc-report` → 仅 `platforms.claude_code`；单 `--codex-report` → 仅 `platforms.codex`；
  二者都给 → 双键（回归不变）。
- **renderer**：单平台数据渲染产物**不含对比区、不含缺席面板**；dual 数据仍渲染两栏 + 对比区。
- **scorecard**：Codex-only 输入下四轴均产出非空 tier（不塌）；CC dual 输入产出与今天一致（回归）。
- **隐私门**：既有 privacy 测试（ADR 0016/0017 派生信号、零原文）继续通过，无新增数据面。

## 验收标准

- 从 Claude Code 调用 skill 且用户未点名平台 → 只出 CC 单平台报告（无空 Codex 面板、无对比区）。
- 从 Codex 调用同理 → 只出 Codex 单平台报告，成绩卡四轴完整。
- 用户显式说「对比 CC 和 Codex」→ 仍出今天的双平台对比报告（行为不回退）。
- 宿主无法判定 → skill 给三选项提问后再出对应报告。
- 全部既有测试 + 新增单平台测试通过；`check_adrs.mjs` 通过。
