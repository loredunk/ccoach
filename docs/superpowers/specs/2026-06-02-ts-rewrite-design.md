# 设计 — ccoach 迁移到 TypeScript（CLI 重写 + 去 Python）

> 日期：2026-06-02 · 状态：待用户复核
> 相关 ADR：[0010](../../adr/0010-cli-rewrite-node-ccusage.md)（Node 迁移）、
> [0011](../../adr/0011-multi-platform-usage-sources.md)（双平台对称）、
> [0013](../../adr/0013-self-built-unified-parser.md)（自建统一解析层）、
> [0004](../../adr/0004-skills-based-analysis.md)（CLI 出数据 / skill 出解读）、
> [0005](../../adr/0005-tiered-analysis-and-signals.md) / [0014](../../adr/0014-claude-code-prompt-review-data-surface.md)（prompt 信号与隐私）、
> [0015](../../adr/0015-standing-local-authorization-prompt-reading.md)（本人 prompt 默认读）、
> [0012](../../adr/0012-codex-cost-tokens-ccusage-method.md)（对齐 ccusage 计价）

## 1. 目标

把 ccoach CLI 从 Go 迁到 TypeScript，发布为 npm 包 **`@loredunk/ccoach`**（bin `ccoach`），
分发统一成「一切皆 npx」。同时**全仓库去 Python**：skill 里的 Python 脚本全部改写成 TS。
ccusage 是用量/成本的「标准答案」，本次重构把**对账固化**为一等要求。

## 2. 范围与分期

用户决策：第一里程碑做全（核心解析 + 习惯分析），平台**优先 Claude Code**；
prompt 这层 CLI 只出**信号**，评级/段位/吐槽留在 skill；skill 的确定性 Python **在 skill 目录内改写成 TS 脚本**。

### Phase 1 — CLI 核心（第一里程碑）

- 统一解析层：一个 pass 读 JSONL → `usage` + `prompt_signals` + `habits`。
- 双平台适配器：`claude-code`（先做）+ `codex`，吐同一统一结构。
- `ccoach --json`：输出统一结构，供现有 skill 消费，**契约不破**。
- 习惯分析：git_habits / languages / tools / project_management（复刻 Go + python 口径）。
- prompt_signals：长度、结构化率、文件引用率、约束率、返工率（仅数值，脱敏）。
- ccusage 交叉验证：对账脚本 + CI。

### Phase 2 — skill 去 Python

- **采集类 Python 退场**：`collect_claude_behavior.py` / `session_drilldown.py` /
  `claude_session_prompts.py` 被 CLI 统一解析层取代；skill 改调 `ccoach --json` 拿数据。
- **确定性渲染/计算改写 TS**：`scorecard.py` / `render_dual_platform.py` /
  `render_enriched_codex_report.py` / `merge_dual_platform.py` → skill 目录内的 TS，
  编译成可直接 `node` 跑的 `.mjs`（离线、零运行时 pip/tsx 依赖）。
- 「人格吐槽/称号」仍由 runtime 模型按语言现写，不是脚本（沿用现状）。

### 明确不在本期（YAGNI）

- prompt 质量评级/段位、人格吐槽、HTML 成绩卡的逻辑**不下沉 CLI**（留 skill）。
- OpenClaw / Harness 等第三平台只留架构位（适配器层），不实现。
- 把渲染折进 `ccoach` 子命令的方案**不采用**（守 ADR 0004：CLI 小、出数据）。

## 3. 架构

```
~/.claude/projects/*.jsonl ─ claude-code adapter ─┐
~/.codex/**/*.jsonl ──────── codex adapter ───────┼─► 统一模型 ─► aggregate ─► --json / 人读文本
（未来平台）───────────────── 新适配器 ───────────┘              (平台无关)
```

- 每个适配器只管「该平台 JSONL → 统一结构」；聚合/输出层只认统一结构。加平台 = 加一个适配器。
- skill 消费 `ccoach --json`，不自己 parse。

## 4. 仓库布局

```
package.json          # @loredunk/ccoach, bin: ccoach, type: module, node >= 18
tsconfig.json
src/
  cli.ts              # cac 解析 --date/--since/--days/--by-repo/--json/--scope
  parsers/
    types.ts          # 统一数据结构（usage / prompt_signals / habits）
    claude-code.ts    # ~/.claude/projects/**/*.jsonl 适配器
    codex.ts          # ~/.codex rollout 适配器（复刻 parse.go / discover.go / sqlite.go）
    pricing.ts        # 计价表（复刻 pricing.go，对齐 ccusage / LiteLLM 口径）
  report/
    aggregate.ts      # 平台无关聚合 → 报告结构（复刻 report.go）
    habits.ts         # git / language / project_management（复刻 habits.go / language.go）
    glossary.ts       # 口径自描述
  index.ts            # 库导出（供 skill TS 复用类型/逻辑）
test/                 # vitest + 两平台 JSONL fixture
scripts/verify-ccusage.ts   # 对账脚本（dev / CI）
skills/ai-usage-html-report/scripts/   # Phase 2：.py → .ts（编译为 .mjs）
cmd/ internal/        # Go 原地保留作参考实现，TS 稳定后退役
```

## 5. 选型

- CLI 框架：**cac**（轻量、ccusage 风格；命令不多）。
- 构建：**tsdown**（esbuild，小 bundle，利于 npx 拉取）。
- 测试：**vitest**。
- 运行时：Node ≥ 18，`type: module`（ESM）。
- 跨平台：Node 天然跨 mac/linux/win，无预编译矩阵。

## 6. 统一数据结构

沿用现有 `--json` 字段口径（`report.go` 的 json tag 与 `collect_claude_behavior.py` 已对齐过），
统一结构 = 这些字段的平台无关超集，平台特有字段作可选并存：

- `tokens { input, cached_input, output, reasoning_output?, total }`
- `cache_hit_rate`、`reasoning_ratio?`、`estimated_cost_usd`、`models[]`、`unpriced_models[]?`
- `tools { shell_calls, web_searches, file_changes, total_calls, top_commands[] }`
- `repos[]`、`hours[]`、`languages[]`、`git_habits`、`project_management`
- `prompt_signals { prompts, avg_len, structured_ratio, file_ref_ratio, constraint_ratio, correction_rate }`
- `glossary`（口径自描述 + 仅本机 / 不含配额声明）
- 平台特有：Codex `reasoning_output` / `codex` 配置块；Claude 缓存细分等，作可选字段。

## 7. ccusage 交叉验证（一等要求）

- `scripts/verify-ccusage.ts`：对同一时间窗口，把 ccoach 算出的 token / 成本与
  `npx ccusage`（Claude Code）、`npx @ccusage/codex`（Codex）逐项 diff，超出容差则非零退出。
- ccusage **仅作验证、不作运行时依赖**：`package.json` 不挂 ccusage runtime dep（devDependency / npx 调用）。
- 纳入 CI，作为「ccusage 是标准答案」的固化护栏。
- 迁移期同时与 Go 版 `--json` diff，确保解析不退化。

## 8. 隐私护栏（不可违反，复刻 python 脚本规则）

- 全程只读；只读 user prompt 派生**数值信号**，绝不存/不外发原文。
- 绝不读 assistant / thinking / tool_result / system·developer prompt / 文件内容。
- Bash 只取首 token（或 git 子命令）；repo 只取 basename；文件只取扩展名；密钥正则脱敏。
- 全局层零 prompt 原文；会话/项目层转述 + 脱敏。
- 本人 prompt 默认读、长期授权（ADR 0015），红线不放宽。
- 不输出配额百分比（`rate_limits` 恒 null）；成本为估算值；只反映本机。

## 9. 测试

- vitest 单测：每个适配器（两平台 JSONL fixture）、pricing、aggregate、habits。
- 隐私回归：断言 `--json` 输出不含 prompt 原文 / 密钥 / 绝对路径（对齐 `tools/test_scorecard.py` 的检查项）。
- 解析不退化：fixture 跑出的 `--json` 与 Go 版 diff 对齐。
- 集成对账：`verify-ccusage.ts` 在 CI 跑一次。
- 格式漂移防护：保留两平台样例 fixture，JSONL 改版时测试先红。

## 10. 后果与迁移

- 好处：分发统一 npx；自包含无 ccusage 运行时依赖；一个 pass 出全量数据；全栈 TS、无 Python。
- 代价：JSONL 官方改版需自己跟进；Node 冷启动开销（低频工具可接受）。
- 迁移：Go 版与 skill Python 在各自阶段稳定后退役；同步更新 README / PRD §2·§5 / TODO / CLAUDE.md。

## 待办文档同步

- TODO 新增 Phase 1 / Phase 2 任务项。
- README / README_CN 安装段改为 `npx @loredunk/ccoach` / `npm i -g @loredunk/ccoach`。
- 如 Phase 2 落地改变 skill 调用方式，更新 SKILL.md。
