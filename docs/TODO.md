# TODO — ccoach

> 约定：`[ ]` 待办 · `[~]` 进行中 · `[x]` 完成。优先级 P0 > P1 > P2。
> 最近更新：2026-06-04

---

## T1 · AI 用量分析（skills 化）（P0）— ✅ 已完成

> 决策：[`adr/0004-skills-based-analysis.md`](adr/0004-skills-based-analysis.md)（已接受）
> · skill 在已上线的 `skills/ccoach-insight/` 上演进。

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

- [x] 四轴段位与阈值（Prompt 功力 / 烧钱姿势 / 工程素养 / 勤奋度）：`scripts/scorecard.mjs`（原 `scorecard.py`）。
- [x] `references/scorecard-copy.json`：zh/en 段位名 + 吐槽语 + UI 标签（人工本地化，非直译）。
- [x] 渲染层封面成绩卡（竖版、可截图、置顶）：`render_dual_platform.mjs --scorecard --lang zh|en`（原 `.py`）。
- [x] 相对排名「超过 X% 用户」：本地估算并标注 estimate；分寸=只损习惯不伤人（文案表）。
- [ ]（后续）相对排名用真实大盘校准；称号整段由模型按语言现写（已在 SKILL.md 指明，运行时完成）。

## T2 · 边界澄清（P1）— ✅ 已完成
- [x] README / README_EN / PRD §2 统一「仅本机、不跨机器汇总、成本为估算、不含配额」措辞。

## T3 · 工程基建（P2）— ✅ 已完成
- [x] `tools/check_adrs.mjs`（原 `check_adrs.py`）：ADR 编号唯一 / 状态字段 / docs 相对链接校验。
- [x] scorecard 回归迁入 vitest（`test/scorecard.test.ts`，原 `tools/test_scorecard.py`）：四轴有段位、zh/en 本地化、估算标注、**不泄配额% / prompt 原文 / 密钥**。
- [x] CI（`.github/workflows/ci.ts.yml`）：typecheck / vitest / build / `check_adrs.mjs` / ccusage 对账；**去 Go** 后删除 `ci.yml`（`go build/vet/test`）。

---

## T10 · Codex token/成本计算对齐 ccusage（P0）— ✅ 已完成

> 决策：[`adr/0012-codex-cost-tokens-ccusage-method.md`](adr/0012-codex-cost-tokens-ccusage-method.md)（已接受，已实现）。

- [x] token 增量优先用 `last_token_usage`；缺失时回退对 `total_token_usage` 求增量（基线从 0、逐字段 saturating），修正首轮/单轮被吞。
- [x] `cached_input` 钳制为 ≤ `input`；`info==null` 与重复样本不产生增量。
- [x] 成本公式固化为「非缓存输入×输入价 + 缓存输入×缓存读取价 + 输出×输出价」，对齐 ccusage。
- [x] 定价表镜像 LiteLLM，修正 `codex-mini` 系列映射（`gpt-5.1-codex-mini` 用 mini 价、`codex-mini-latest` 入表）。
- [x] glossary（`tokens` / `estimated_cost_usd`）更新；`parse_test.go` 按新口径更新 + 新增 last_token_usage / 单轮会话测试。

## T11 · 分析的时间感知护栏（P1）— ✅ 已完成（skill 侧）

> 背景：成绩卡/建议曾把「新模型发布前用旧模型」当成浪费（如「94% 花在 opus-4-7、建议固定到 opus-4-8」），
> 但当时 opus-4-8 还没出。分析缺时间概念。决策口径见 PRD §3.10「时间感知护栏」。

- [x] SKILL.md「Analysis Guidance」+「Avoid」：模型版本类结论必须时间感知，按 per-day per-model 时间线判断模型可用时间，不回溯指责、不算「X% 浪费在旧模型」。
- [x] `references/insight-patterns.md` 新增「Model Version Distribution（time-aware）」模式与措辞模板。
- [x] `references/feature-mapping.md` 新增「多花在旧版模型上」行（带时间感知警告）。
- [x] 数据层产出结构化时间线：`ccoach report --json` 新增 `models_timeline`（每模型 `first_day`/`last_day` + 每日 token/成本），文本模式也显示模型时间线；SKILL/insight-patterns 指向该字段，护栏不再只靠 agent 推断。
- [x]（Claude Code 侧）统一解析层（T9）已为两平台在数据层原生产出 `models_timeline`（per-day per-model），不再依赖 ccusage daily。

## T8 · CLI 迁移到 Node/TypeScript（P0）— ✅ Phase 1 已完成

> 决策：[`adr/0010-cli-rewrite-node-ccusage.md`](adr/0010-cli-rewrite-node-ccusage.md)（已实现 Phase 1）。
> 实现：`docs/superpowers/specs/2026-06-02-ts-rewrite-design.md` + `plans/2026-06-02-ts-rewrite-phase1.md`。
> 保持 `--json` 契约；原 Go 版已交叉验证后退役删除（见 T12「去 Go」）。

- [x] TS 项目骨架：`cac` + `tsdown` + `vitest`，ESM、Node ≥ 18（包 `@loredunk/ccoach`，bin `ccoach`）。
- [x] 跑通核心数据流：读 `~/.codex` rollout（glob）+ `~/.claude/projects` → 统一结构 → `--json` / 人读文本。
- [x] **对齐 ccusage**：`scripts/verify-ccusage.ts` 实测 token 严格相等、成本 1% 容差内（接入 CI）。
- [x] 习惯分析 TS 等价（`src/habits.ts`：git_habits / project_management）+ 测试。
- [ ]（后续）配置扫描 `configscan.go`、语言识别 `language.go` 的完整 TS 等价（Phase 1 为最小实现）。
- [ ]（后续）Codex sqlite 元数据读取器（Phase 1 走 glob 路径，用量已正确）。
- [x] Node 版稳定后退役 Go 版（删 `cmd/ccoach`、`internal/codexreport`）——见 T12「去 Go」（已完成）。

## T9 · 自建统一解析层 + 双平台一等数据源（P0）— ✅ Phase 1 已完成

> 决策：[`adr/0013`](adr/0013-self-built-unified-parser.md)（自建解析，取代 0010 D2）/ [`adr/0011`](adr/0011-multi-platform-usage-sources.md)（多平台）。
> 不依赖 ccusage 运行，只学方法 + 交叉验证。

- [x] 自建解析层 `src/parsers/`：一个 pass 出 **用量 + prompt 信号 + 习惯**（统一 `Report`）。
- [x] 学 ccusage 的 JSONL 解析方法（按 `message.id:requestId` 去重、cache creation/read 计价、成本估算）；**不复制其代码**（仅参考思路）。
- [x] 分平台适配器 `claude-code` / `codex` → **统一数据结构**；聚合器/emitter 只认统一结构（加平台 = 加一个适配器）。
- [x] **Claude Code 在 CLI 内升为一等数据源**（与 Codex 对称、且优先实现）。
- [x] 抓 prompt 严守隐私边界：只由 user prompt 派生数值 `prompt_signals`，绝不读 assistant / 工具输出 / sidechain 文本，输出脱敏（隐私回归 `test/privacy.test.ts`）。
  - [x] 内容层 prompt 评级数据面（skill 侧 `claude_session_prompts.py`）；`file_ref_ratio` 口径已移植进 `src/prompt-signals.ts`。
- [x] 用 ccusage **交叉验证** token/成本（`scripts/verify-ccusage.ts`，接入 CI），两平台 fixture 防格式漂移。
- [ ]（未来）调研并接入 OpenClaw / Harness / opencode / amp 等其它 Agent CLI（只需再写一个适配器）（ADR 0011 D3）。

## T12 · 去 Go + skill 去 Python（Phase 2 进行中）（P0）

> 决策：[`superpowers/specs/2026-06-02-ts-rewrite-design.md`](superpowers/specs/2026-06-02-ts-rewrite-design.md) §2（Phase 2）。
> Phase 1 已用 TS + ccusage 对账取代 Go 行为基准，故 Go 可退役；skill 的确定性脚本改写为 `.mjs`（零依赖、可直接 `node` 跑）。

- [x] **去 Go**：删除 `cmd/ccoach`、`internal/`（codexreport + cli）、`go.mod`，及 `ci.yml`（`go build/vet/test`）。
- [x] **渲染/计算层去 Python**：`merge_dual_platform` / `scorecard` / `render_dual_platform` /
      `render_enriched_codex_report` 由 `.py` 改写为 skill 内 `.mjs`；SKILL.md 改调 `node *.mjs`，行为/输出口径不变。
- [x] **tools 去 Python**：`check_adrs.py → check_adrs.mjs`；`test_scorecard.py` 回归迁入 vitest（`test/scorecard.test.ts`），并入 `ci.ts.yml`。
- [x]（完成）**采集类并入 ccoach**（决策见 [`adr/0018`](adr/0018-cli-absorbs-collection-prompt-preview.md)，取代「照搬 .mjs」）——**全仓库零 Python**：
  - [x] **块 A · 行为字段**：`Report` 增补可选 `tools.by_name` / `tools.categories` / `hours.count` / `file_languages`（契约兼容）；
        Claude 适配器全量计数 + 分类工具（修旧版漏计）、按 `entrypoint` 填 `sources`（来源面板）；`merge_dual_platform.mjs` 与 SKILL 的 Claude 行为改吃 `ccoach report --platform claude-code --json`。
  - [x] **块 B · scope**：`ccoach report --scope {global,project,session}` → `projects[]` / `sessions_detail[]`（每桶 tokens/tool_calls/cache_hit_rate/categories/git_top/prompt_signals），两平台；取代 `collect_claude_behavior --scope`。SKILL「Analysis scopes」改指 ccoach。
  - [x] **块 C · 会话钻取/预览**：新增 `ccoach sessions`（候选清单数值-零原文 + opt-in 单会话 redacted 预览，脱敏逐条移植）取代 `session_drilldown` / `claude_session_prompts`；删 3 个采集 `.py`、SKILL 去掉 `Bash(python3 *)`、ADR 0005 链接改指 0018。**至此仓库无 `.py`、无 `.go`。**

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

## T13 · 编码自主度成绩卡第 5 轴（P1）— ⏳ pending

> 决策：[`adr/0020-coding-autonomy-scorecard-axis.md`](adr/0020-coding-autonomy-scorecard-axis.md)（提议中）
> · 把「用户多大程度自己改代码 / 不采用 AI 产出」做成称号；复用既有 `rework_signals`，无新采集。

- [ ] 复用 `rework_signals`（`edits` / `user_modified_rate`）派生「编码自主度」称号轴：**两信号组合**——
      先看「让不让 AI 写」（`editsPerSession`），再看「写完改不改」（`user_modified_rate`），分 4 档：
      古法编程 / 人机结对 / AI 全托管 / 甩手提问家。
- [ ] `scripts/scorecard.mjs` 加 `scoreAutonomy` + 进 `axesSpec`；`references/scorecard-copy.json` 加 `axes.autonomy`
      + `ui.zh/en` 的 `axis_autonomy` 标签；`test/scorecard.test.ts` 的 `AXES` 补 `autonomy`。
- [ ] 开放问题：中性轴是否计入 `rank_pct`（建议不计入，仅展示称号）；阈值用真实样本校准；
      Codex 侧 `userModified` 等价字段待核（无则该轴仅 Claude Code，渲染降级）。

## T14 · 失败类别细化 + 外因/内因分组（P1）— ⏳ pending

> 决策：[`adr/0021-error-taxonomy-refinement.md`](adr/0021-error-taxonomy-refinement.md)（提议中）
> · CLI「按类别」里 `other` 过笼统；细化环境/外因类别，回答「失败是 AI 的问题还是环境的问题」。

- [ ] 扩 `src/errors.ts` 的 `classifyError` 白名单（外因优先排序）：`command-not-found` / `disk` / `oom` /
      `signal` / `syntax`（可选 `type`）。
- [ ] 加**外因/内因**分组计数（`error_signals.external_count` / `internal_count`，纯计数）；
      `src/emit/text.ts` 的「错误 / 卡顿」段补一行「外因 X% · 内因 Y%」习惯洞察。
- [ ] 隐私：仍只产出**固定白名单标签 + 纯计数**，匹配用的错误文本**瞬时派生即弃**，
      绝不存储/外发 stderr/stdout/命令全行（ADR 0016/0017 红线不变）。

## T15 · 报告多语言选项（默认英文）（P1）— ✅ 已完成

> 决策：[`adr/0025-report-skeleton-i18n-default-english.md`](adr/0025-report-skeleton-i18n-default-english.md)（沿用 ADR 0009「人工本地化、非直译」口径，扩到报告骨架）。
> 背景：用户反馈「下载下来的 HTML 报告都是中文」。根因——成绩卡有 zh/en，但**报告骨架 UI 文案在两个渲染器里硬编码中文**、`--lang` 从不被读、`htmllang` 写死 `zh-CN`。

- [x] **报告骨架 i18n 化**：新增 `references/report-copy.json`（`dual`/`enriched` 两段、任意 locale、缺失键逐键回退默认语言）；`render_dual_platform.mjs` 与 `render_enriched_codex_report.mjs` 接 `--lang` + `tr()`，`<html lang>`、`languages_unit`（merge 改吐中性键 `files`/`sessions`）、每面板 `source` 标签全本地化。CJK 闸门回归 `test/i18n-report.test.ts`：`--lang en` 骨架零中文。
- [x] **扩语言**：文案表结构支持任意 locale + 缺失回退默认语言；本期填 zh/en，文档说明如何加（人工本地化、不机翻）。
- [x] **默认语言 = 英文**：`render×2` + `scorecard.mjs` 缺省 `--lang` 即 `en`；SKILL.md 示例默认值改 `--lang en`、「Use Chinese unless asked」改为「按用户语言写、不明默认英文」。
- [x] **语言来源**：agent（SKILL.md 指导）按用户对话语言传 `--lang`，脚本缺省英文；不引入环境探测（决策见 ADR 0025）。
- [ ]（follow-up，**不在 T15 范围**）**CLI 自身 i18n**：`src/habits.ts` 生成的中文信号短语（经 `--json`→merge `extras`→报告）、merge 的少量 `extras` 前缀、`src/emit/text.ts` 全中文人读输出——英文报告里仍会夹这些 CLI 层中文，需给 CLI 加语言层（信号结构化 / emitter 文案表）。详见 ADR 0025「已知遗留」。

## T16 · 输入/输出 Token 分布修正（展示口径）（P1）— ✅ 已完成

> 决策：[`adr/0024-report-input-token-display-parity.md`](adr/0024-report-input-token-display-parity.md)。
> 现象：Claude「输入 192K ≪ 输出 3.5M」反常、Codex（34.5M ≫ 153K）正常。**确属 BUG，TODO 怀疑方向正确**。
> 根因：两平台 `tokens.input` 口径刻意不对称（Claude=非缓存 fresh、cache_read/cache_creation 独立桶；Codex=含缓存），展示层却把 `input` 直接头对头比较 + Codex 构成面板双算。`total` 含全部 → ccusage 对账（只校 total）保持绿，故问题在**展示分桶、非解析层**（与下条判断一致）。

- [x] 复现并定位：是**漏算 cache 输入**（cache_read/cache_creation 没并进展示的 input），非映射颠倒；经独立 agent 对抗式核验确认。
- [x] 与对账交叉：CI 对账仍绿（`verify-ccusage.ts` 只校 `tokens.total`），故走**展示层**修复——`render_dual_platform.mjs` 纯展示层改，不动解析/`models[].tokens`/计价（ccusage 两平台仍 OK）。
- [x] 修复 + 回归（`test/token-display.test.ts`）：头对头「输入 Token」改「输入侧总量（含缓存读）」两平台统一、两个「Token 构成」面板改互斥桶（求和=total、Codex reasoning 转脚注）、Codex 模型表「输入」列改 fresh、`model.ts` glossary 更正。真实数据验证：Claude 输入侧总量 924M ≫ output 3.35M。

---

## 已完成（历史）
- [x] 建立 `docs/`：PRD / ADR / TODO 体系（2026-06-02）。
- [x] 规划 npm 分发与 skills 化分析（ADR 0003 / 0004，2026-06-02）。
- [x] 规划三层分析与特性优先建议（ADR 0005 / 0006，2026-06-02）。
- [x] **剥离保活、更名 ccoach、`report` 改为默认命令**（ADR 0007，2026-06-02）。
- [x] 规划游戏化可分享成绩卡 + i18n（ADR 0008 / 0009，2026-06-02）。
- [x] **实现** T1/T5/T6/T7/T2/T3（glossary、三层 scope + prompt 信号、feature-mapping、成绩卡 + zh/en、CI 检查，2026-06-02）。
- [x] **TS 重构 Phase 1 落地**（T8/T9）：`@loredunk/ccoach`（cac/tsdown/vitest、ESM、Node≥18）——统一解析层（`claude-code` + `codex` 适配器）、平台无关聚合器、双平台计价、prompt 数值信号、习惯派生、JSON/文本 emitter、CLI（`--platform`/`--json`）、ccusage 交叉验证 + 隐私回归 + TS CI；token 与 ccusage 严格相等、成本 1% 内（2026-06-02）。
