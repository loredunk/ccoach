# ADR 0027 — skill 更名：`ai-usage-html-report` → `ccoach-insight`

> 状态：已接受 · 日期：2026-06-04（已实现：`git mv` + frontmatter/agents 更名 + 全仓库引用替换 + 链接修复）
> · 沿用 [`adr/0004-skills-based-analysis.md`](0004-skills-based-analysis.md)（skill 为独立分发单元）；为后续「分发（npx skills）」ADR 铺垫（稳定的 canonical 名）

## 背景

原 skill 名 `ai-usage-html-report` 偏描述性、不像品牌、不好记，且在 Claude Code 里以 `/ai-usage-html-report` 触发、
偏长。产品要主打英文市场并便于传播，需要一个**稳定、好记、与 CLI 同源**的名字，后续尽量少改。

## 决策

更名为 **`ccoach-insight`**（品牌「ccoach Insight」，产出 HTML 洞见报告，触发 `/ccoach-insight`）。仅改名，
**不**新增 `ccoach insight` CLI 子命令（AI 洞见仍由 skill/agent 产出，CLI 只出数据）。

落地（`ai-usage-html-report` 为唯一标识符，全仓库统一替换为 `ccoach-insight`，安全无歧义）：
- `git mv skills/ai-usage-html-report skills/ccoach-insight`；脚本走相对路径、`${CLAUDE_SKILL_DIR}` 运行时解析，无需改。
- `SKILL.md` frontmatter `name`、H1 标题、`agents/openai.yaml` `display_name` → ccoach Insight。
- **测试 import 路径**（`test/*.ts` 引 `../skills/ai-usage-html-report/scripts/*`）一并替换，否则断。
- 文档/链接全量替换：`CLAUDE.md`、`README.md`/`README_CN.md`、`docs/README.md`/`PRD.md`/`TODO.md`、
  `docs/superpowers/*`，以及 ADR 0005/0006（相对链接，`check_adrs` 会校）、0007/0008/0010/0019（prose 路径）。
  注：ADR 一向 append-only，此处仅**机械修复因目录改名而断的相对链接/路径提及**，非改决策。

## 影响

- Claude Code 触发由 `/ai-usage-html-report` 变为 `/ccoach-insight`；Codex 端 `agents/openai.yaml` 同步。
- 改名与分发正交：skill 未发布过，无外部破坏；canonical 名将用于 `npx skills add` 的 `--skill ccoach-insight`。
- `check_adrs` 校验改名后所有相对链接仍解析。
