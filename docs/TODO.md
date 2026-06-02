# TODO — ccoach

> 约定：`[ ]` 待办 · `[~]` 进行中 · `[x]` 完成。优先级 P0 > P1 > P2。
> 最近更新：2026-06-02

---

## T1 · AI 用量分析（skills 化）（P0）— ✅ 已完成

> 决策：[`adr/0004-skills-based-analysis.md`](adr/0004-skills-based-analysis.md)（已接受）
> · skill 在已上线的 `skills/ai-usage-html-report/` 上演进。

- [x] 复用 `codexreport.Build()` 产出 Codex 侧聚合。
- [x] Claude Code 数据源：`~/.claude/projects/**/*.jsonl`（`collect_claude_behavior.py`）。
- [x] `ccoach --json` 字段**自描述**：`report.go` 新增 `glossary`（各指标口径 + 仅本机 / 不含配额声明）。
- [x] 采集逻辑与模型解耦，`go test` 覆盖；skill 输出模板「结论/依据/行动项/风险」+ 空态护栏（见 SKILL.md）。
- [ ]（可选，未做）更偏「喂模型」的 `--digest`：当前 `--json` + `glossary` 已够 agent 消费。

## T5 · 三层分析（会话 / 项目 / 全局）（P0）— ✅ 已完成

> 决策：[`adr/0005-tiered-analysis-and-signals.md`](adr/0005-tiered-analysis-and-signals.md)（已接受）

- [x] `collect_claude_behavior.py --scope {global,project,session}`：global 聚合 / `projects[]` / `sessions_detail[]`。
- [x] 会话级当前会话直接分析；项目级定位 `~/.claude/projects/<编码目录>`；Codex 复用 `session_drilldown.py --repo`。
- [x] 信号只用 user prompt + permission + tool 调用，**不读 / 不导出 assistant 回复**。
- [x] prompt 边界：会话/项目层读 user prompt 仅产出聚合 `prompt_signals`（不落原文、脱敏）；全局层零 prompt 文本。

## T6 · 特性优先建议（P0）— ✅ 已完成

> 决策：[`adr/0006-feature-first-recommendations.md`](adr/0006-feature-first-recommendations.md)（已接受）

- [x] 新增 `references/feature-mapping.md`（finding → 产品特性表，覆盖 ADR 0006 D2）。
- [x] `insight-patterns.md` 与 SKILL.md「Analysis Guidance」接入：建议先点名特性、给配置建议前联网核对官方文档、只建议不自动改配置。

## T7 · 可分享成绩卡 + i18n（P1）— ✅ 已完成

> 决策：[`adr/0008-gamified-shareable-scorecard.md`](adr/0008-gamified-shareable-scorecard.md) / [`0009`](adr/0009-i18n-scorecard-copy.md)（均已接受）

- [x] 四轴段位与阈值（Prompt 功力 / 烧钱姿势 / 工程素养 / 勤奋度）：`scripts/scorecard.py`。
- [x] `references/scorecard-copy.json`：zh/en 段位名 + 吐槽语 + UI 标签（人工本地化，非直译）。
- [x] 渲染层封面成绩卡（竖版、可截图、置顶）：`render_dual_platform.py --scorecard --lang zh|en`。
- [x] 相对排名「超过 X% 用户」：本地估算并标注 estimate；分寸=只损习惯不伤人（文案表）。
- [ ]（后续）相对排名用真实大盘校准；称号整段由模型按语言现写（已在 SKILL.md 指明，运行时完成）。

## T2 · 边界澄清（P1）— ✅ 已完成
- [x] README / README_EN / PRD §2 统一「仅本机、不跨机器汇总、成本为估算、不含配额」措辞。

## T3 · 工程基建（P2）— ✅ 已完成
- [x] `tools/check_adrs.py`：ADR 编号唯一 / 状态字段 / docs 相对链接校验。
- [x] `tools/test_scorecard.py`：回归——四轴有段位、zh/en 本地化、估算标注、**不泄配额% / prompt 原文 / 密钥**。
- [x] `.github/workflows/ci.yml`：`go build/vet/test` + 上述两项检查。

---

## T10 · Codex token/成本计算对齐 ccusage（P0）— ✅ 已完成

> 决策：[`adr/0012-codex-cost-tokens-ccusage-method.md`](adr/0012-codex-cost-tokens-ccusage-method.md)（已接受，已实现）。

- [x] token 增量优先用 `last_token_usage`；缺失时回退对 `total_token_usage` 求增量（基线从 0、逐字段 saturating），修正首轮/单轮被吞。
- [x] `cached_input` 钳制为 ≤ `input`；`info==null` 与重复样本不产生增量。
- [x] 成本公式固化为「非缓存输入×输入价 + 缓存输入×缓存读取价 + 输出×输出价」，对齐 ccusage。
- [x] 定价表镜像 LiteLLM，修正 `codex-mini` 系列映射（`gpt-5.1-codex-mini` 用 mini 价、`codex-mini-latest` 入表）。
- [x] glossary（`tokens` / `estimated_cost_usd`）更新；`parse_test.go` 按新口径更新 + 新增 last_token_usage / 单轮会话测试。

## T8 · CLI 迁移到 Node/TypeScript（P0）— ☐ 规划中

> 决策：[`adr/0010-cli-rewrite-node-ccusage.md`](adr/0010-cli-rewrite-node-ccusage.md)（已接受，待实现）。
> 渐进迁移、保持 `--json` 契约不变、Go 版留作参考实现交叉验证。

- [ ] 搭 TS 项目骨架：`cac`/`citty`（轻量 CLI）+ `tsdown`/`unbuild`（小 bundle）。
- [ ] 跑通核心数据流：读 `~/.codex` rollout（或调 `@ccusage/codex`）→ 结构化用量 → `--json`。
- [ ] **对齐 Go 版 `--json`**：同一份数据交叉验证两版结果一致，确保解析不退化（ADR 0010 D5）。
- [ ] 习惯分析 / 配置扫描 / 语言识别（原 `habits.go`/`configscan.go`/`language.go`）的 TS 等价实现 + 测试（ADR 0010 OQ3）。
- [ ] Node 版稳定后退役 Go 版（删 `cmd/ccoach`、`internal/codexreport`）。

## T9 · 衔接 ccusage + 双平台一等数据源（P0）— ☐ 规划中

> 决策：[`adr/0010`](adr/0010-cli-rewrite-node-ccusage.md)（中等偏轻）/ [`adr/0011`](adr/0011-multi-platform-usage-sources.md)（多平台）。

- [ ] 引入 ccusage 依赖：`@ccusage/codex`（Codex）+ `ccusage`（Claude Code），调 API 拿结构化用量（中等）。
- [ ] 确认 `@ccusage/codex` 覆盖既有 Codex JSONL 边界 case，不足处由 ccoach 适配层补（ADR 0010 OQ2）。
- [ ] 定「平台数据源适配器 + 平台无关分析层」分层；定**统一用量模型**最小公共字段（ADR 0011 D2 / OQ1）。
- [ ] **Claude Code 在 CLI 内升为一等数据源**（与 Codex 对称，不再只在 skill 侧取数）。
- [ ]（未来）调研并接入 OpenClaw / Harness 等其它 Agent CLI（ADR 0011 D3 / OQ2）。

## T4 · npm 分发（P0）— ⏸ 暂缓（需 NPM_TOKEN + GitHub Actions 执行）

> 决策：[`adr/0003-npm-distribution.md`](adr/0003-npm-distribution.md)。
> **随 [ADR 0010](adr/0010-cli-rewrite-node-ccusage.md) 简化**：CLI 是普通 Node 包，原「Go 二进制
> 平台子包矩阵」（旧 T4.2）作废。沙箱无法真正 `npm publish` / `npx` 端到端验证；待 npm 凭证与包名归属后落地。

### T4.1 仓库结构
- [ ] 落地 monorepo：`packages/cli/`（`ccoach`）+ `packages/skills/`（`@ccoach/skills`），npm workspaces。
- [ ] 终定包名 / scope（ADR 0003 OQ1）。

### T4.2 CLI 发布（普通 Node 包）
- [ ] CLI 作为普通 npm 包发布，`npx ccoach` 跨平台即用（无二进制矩阵、无 postinstall 下载）。
- [ ] CI：build + test + 发布；版本与仓库同源。

### T4.3 skills 安装
- [ ] `@ccoach/skills` 可直接 `npm i` 安装。
- [ ] `ccoach skills install`：探测并复制到 Claude Code / Codex 的 skills 目录（ADR 0003 OQ3 / 0004 OQ1）。

---

## 已完成（历史）
- [x] 建立 `docs/`：PRD / ADR / TODO 体系（2026-06-02）。
- [x] 规划 npm 分发与 skills 化分析（ADR 0003 / 0004，2026-06-02）。
- [x] 规划三层分析与特性优先建议（ADR 0005 / 0006，2026-06-02）。
- [x] **剥离保活、更名 ccoach、`report` 改为默认命令**（ADR 0007，2026-06-02）。
- [x] 规划游戏化可分享成绩卡 + i18n（ADR 0008 / 0009，2026-06-02）。
- [x] **实现** T1/T5/T6/T7/T2/T3（glossary、三层 scope + prompt 信号、feature-mapping、成绩卡 + zh/en、CI 检查，2026-06-02）。
</content>
