# TODO — ccoach

> 约定：`[ ]` 待办 · `[~]` 进行中 · `[x]` 完成。优先级 P0 > P1 > P2。
> 最近更新：2026-06-11

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

### T4.3 skills 分发 — ✅ 改走 `npx skills add`（ADR 0028，取代自建 `ccoach skills install`）
- [x] **主推 `npx skills add loredunk/ccoach`**（Vercel Labs `skills` CLI，交互选 agent/scope；非交互可加 `-a claude-code -a codex -g -y`）：
      仓库无需清单、自动发现 `skills/*/SKILL.md`；已本地实测发现 + 双端安装（Claude symlink、Codex universal `~/.agents/skills`）。
- [x] README（中英）写明一行安装命令。
- [x]（外部端到端，ADR 0028 4b）**已验证**：提交推送到公开 `loredunk/ccoach` 后，临时 HOME 跑
      `npx skills add loredunk/ccoach -a claude-code -a codex -s ccoach-insight -g -y` 成功装出 `ccoach-insight`
      （Claude symlink `~/.claude/skills` + Codex universal `~/.agents/skills` 均落位）。
- [ ]（可选，pending）如 `skills` 生态有 registry/索引登记以提升 `npx skills find` 可发现性，按其文档按需登记（不阻塞安装）。
- [ ]（作废）原 `@ccoach/skills` npm 包 + 自建 `ccoach skills install`（ADR 0003 D3）——被 npx skills 取代。

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
- [x] **宿主平台默认（ADR 0042）**：`ccoach-insight` 默认出当前宿主平台单报告（`CLAUDECODE` 探测 + 无法判定时提问），
      双平台对比转 opt-in；`merge`/`render`/`scorecard` 泛化为「N 面板」，标题品牌化为 `ccoach Insight Report` / `ccoach 洞察报告`。
      回归 `test/merge-single-platform.test.ts` / `test/render-single-platform.test.ts` + scorecard host 用例。

## T16 · 输入/输出 Token 分布修正（展示口径）（P1）— ✅ 已完成

> 决策：[`adr/0024-report-input-token-display-parity.md`](adr/0024-report-input-token-display-parity.md)。
> 现象：Claude「输入 192K ≪ 输出 3.5M」反常、Codex（34.5M ≫ 153K）正常。**确属 BUG，TODO 怀疑方向正确**。
> 根因：两平台 `tokens.input` 口径刻意不对称（Claude=非缓存 fresh、cache_read/cache_creation 独立桶；Codex=含缓存），展示层却把 `input` 直接头对头比较 + Codex 构成面板双算。`total` 含全部 → ccusage 对账（只校 total）保持绿，故问题在**展示分桶、非解析层**（与下条判断一致）。

- [x] 复现并定位：是**漏算 cache 输入**（cache_read/cache_creation 没并进展示的 input），非映射颠倒；经独立 agent 对抗式核验确认。
- [x] 与对账交叉：CI 对账仍绿（`verify-ccusage.ts` 只校 `tokens.total`），故走**展示层**修复——`render_dual_platform.mjs` 纯展示层改，不动解析/`models[].tokens`/计价（ccusage 两平台仍 OK）。
- [x] 修复 + 回归（`test/token-display.test.ts`）：头对头「输入 Token」改「输入侧总量（含缓存读）」两平台统一、两个「Token 构成」面板改互斥桶（求和=total、Codex reasoning 转脚注）、Codex 模型表「输入」列改 fresh、`model.ts` glossary 更正。真实数据验证：Claude 输入侧总量 924M ≫ output 3.35M。

---

## T17 · Episode 切分层（E1）（P0）— ⏳ 待办（本分支 feat/episodes）

> 决策：[`adr/0032-episode-abstraction-layer.md`](adr/0032-episode-abstraction-layer.md) …

- [ ] 新增 `src/episodes.ts`（`EpisodeBuilder` + `EpisodeAccumulator`）。
- [ ] `model.ts` 加 `EpisodeDetail` / `SpiralSignals` / `EpisodeSummary` 类型 + glossary，`Scope` 加 `episode`。
- [ ] `aggregate.ts` 接 episode 转发 + `beginEpisode` + assemble 出 `episode_summary` / `episodes_detail`。
- [ ] parser 钩子（claude-code user-text 边界 + corrected 探测、codex `turn_context` 边界）。
- [ ] `cli.ts` `--scope episode`。
- [ ] `emit/text.ts` 人读概览段（i18n）。
- [ ] 隐私 + 契约回归。

## T18 · 任务分型 + 类型内归一化（E2）（P0）— ⏳ 待办（本分支 feat/episodes）

> 决策：[`adr/0033-episode-task-typing-within-type-normalization.md`](adr/0033-episode-task-typing-within-type-normalization.md) …

- [ ] 新增 `src/task-type.ts`（`classifyTask` 纯函数，7 类 + unknown）+ 单测。
- [ ] `EpisodeAccumulator` 做类型内百分位 + 最小样本回退（`MIN_SAMPLES=5`）。
- [ ] `episode_summary.task_mix`。

## T19 · 绕圈检测 + 最深的坑（E3）（P1）— ⏳ 待办（本分支 feat/episodes）

> 决策：[`adr/0034-spiral-detection-deepest-pit-story.md`](adr/0034-spiral-detection-deepest-pit-story.md) …

- [ ] `EpisodeBuilder` 派生 `SpiralSignals`（`edit_ring` / `error_dense` / `no_progress` / `time_outlier` / `low_confidence` / `severity`，n-gram 有序序列瞬时即弃）。
- [ ] `deepest_pit` 选取。
- [ ] `episode_summary` 自主度 / 干预风格 / spiral 计数。
- [ ] 阈值待真实数据校准。

## T20 · 增量缓存 + per-platform profile（E4）（P1）— ⏳ pending（蓝图，逐子项目单独 brainstorm）

> 决策：[`adr/0035-incremental-cache-per-platform-profile.md`](adr/0035-incremental-cache-per-platform-profile.md)（提议中） …

- [ ] 待 brainstorm + 实现。

## T21 · 量化反事实基线（E5）（P1）— ⏳ pending（蓝图，逐子项目单独 brainstorm）

> 决策：[`adr/0036-quantified-counterfactual-baselines.md`](adr/0036-quantified-counterfactual-baselines.md)（提议中） …

- [ ] 待 brainstorm + 实现。

## T22 · 默认单平台深度 + compare 报告（E6）（P1）— ⏳ pending（蓝图，逐子项目单独 brainstorm）

> 决策：[`adr/0037-single-platform-default-compare-report.md`](adr/0037-single-platform-default-compare-report.md)（提议中） …

- [ ] 待 brainstorm + 实现。

## T23 · 隐私分级 L0–L3 + 两段式 extract→analyze（E7）（P1）— ⏳ pending（蓝图，逐子项目单独 brainstorm）

> 决策：[`adr/0038-privacy-levels-two-stage-extract-analyze.md`](adr/0038-privacy-levels-two-stage-extract-analyze.md)（提议中） …

- [ ] 待 brainstorm + 实现。

## T24 · 打断归因 CLI 结构/skill 语义（E8）（P1）— ⏳ pending（蓝图，逐子项目单独 brainstorm）

> 决策：[`adr/0039-interruption-attribution-cli-structure-skill-semantics.md`](adr/0039-interruption-attribution-cli-structure-skill-semantics.md)（提议中） …

- [ ] 待 brainstorm + 实现。

## T25 · 风格空间 / 原型人格（E9）（P1）— ⏳ pending（蓝图，逐子项目单独 brainstorm）

> 决策：[`adr/0040-style-space-archetype-personas.md`](adr/0040-style-space-archetype-personas.md)（提议中） …

- [ ] 待 brainstorm + 实现。

## T26 · Codex prompt 语义对齐 + ~/.codex/sessions 深度优化（pending）（P1）— ⏳ pending（蓝图，逐子项目单独 brainstorm）

> 决策：[`adr/0041-codex-prompt-parity-sessions-deep-dive.md`](adr/0041-codex-prompt-parity-sessions-deep-dive.md)（提议中 pending） …

- [ ] 现状 `src/parsers/codex.ts` 完全不读用户 prompt，需对齐 Claude 口径。
- [ ] 待 brainstorm + 实现。

## T27 · 派生「魔法值」：洞察指标的公式化计算与拟合（P1）— ⏳ pending（蓝图，逐子项目单独 brainstorm）

> 决策：待立 ADR（编号顺延，尚未起草）。先 brainstorm 公式与口径，**确认后再落 ADR + 实现**。

**意图**（用户设定的大局，忠实记录、勿窄化）：在 **CLI 侧**（确定性、离线）从已洞察的指标推演公式、
做计算与拟合，产出少量高信噪的**「魔法值」**——一眼直接反映 harness 使用者的状况（复合指数 / 拟合评分）。
这是「把 harness 变成可调优仪表盘」愿景的直接表达：把一堆原始指标压成几个能一眼看懂自己的数。

开放问题（**未定公式前不要实现**，逐项 brainstorm）：

- [ ] **输入口径**：每个魔法值由哪些现有指标喂入（token 空转率 / 返工率 / 绕圈 / 纠错回合 / 特性利用率 …）。
- [ ] **公式与拟合**：闭式定义 vs 从数据拟合；拟合的「真值」从哪来（反事实基线 T21 / 跨样本常模？），防过拟合到单机数据。
- [ ] **可解释性（硬约束）**：魔法值必须能用人话讲清「它是什么、怎么往好里挪」——黑箱魔法数违背 legible 愿景。
- [ ] **校准与对账**：用 fixture + ccusage 交叉验证标定；区分「公式错」与「本机数据形状怪」（沿用 `dev:fixture` 内循环）。
- [ ] **契约 & 隐私**：`--json` 加性扩展、不破契约（ADR 0004 / 0010）；纯聚合派生、零 prompt 原文，红线不变（ADR 0015 / 0016 / 0017）。
- [ ] **CLI / skill 边界**：哪些魔法值 CLI 确定性可算、哪些需 skill 层（联网价 / 人格化）——用户明确要的是 CLI 侧可算的那批。
- [ ] 待 brainstorm + 立 ADR + 实现。

## T28 · 上游平台版本漂移监控：changelog + fixture/对账回归（运维护栏）（P1）— ⏳ pending（蓝图，逐子项目单独 brainstorm）

> 决策：待立 ADR / runbook（编号顺延，尚未起草）。

**意图**（用户设定的固定工作流，忠实记录）：解析层（`src/parsers/{claude-code,codex}.ts`）依赖 Codex /
Claude Code 各自 JSONL 的字段形状；**大版本发布可能悄悄改格式 → 解析漂移 → 数字失真**。尤其
`src/parsers/codex.ts` 的输出形状目前是**推断**（无真实 `~/.codex` 数据验证、不匹配时静默产出 0），漂移风险最高。

固定动作（开发收尾时 / 每次上游大版本发布后）：

- [ ] 看官方 changelog：**Codex 与 Claude Code 对称**（ADR 0011，两者都是一等数据源，勿只盯 Codex）。
- [ ] 跑 `npm test`（fixture 回归）+ `npm run verify:ccusage`（token/成本对账，已接 CI），提前发现格式漂移。
- [ ] 漂移时：补/改 fixture 复现新形状 → 改适配器 → 回归绿；必要时记一篇 ADR。

潜在自动化（后期，单独 brainstorm，**勿现在就建**）：

- [ ] 定时 changelog 探针（`/schedule` 例行 agent 或 CI 定时任务）diff 上游 release notes，命中关键字再触发回归。
- [ ] 待 brainstorm + 实现。

## T29 · deep-insight 语义根因深度教练（P1）— 🚧 进行中（分支 exp/deepinsight）

> 决策：[`adr/0048-deepinsight-two-pass-grounding-gate.md`](adr/0048-deepinsight-two-pass-grounding-gate.md) + [`adr/0049-ccoach-digest-optin-content.md`](adr/0049-ccoach-digest-optin-content.md)
> 设计/计划：`superpowers/specs/2026-06-07-deepinsight-design.md` + `plans/2026-06-07-deepinsight.md`。

- [x] 修 `sessions --id` 子串匹配 bug（文本收集曾用精确等于）。
- [x] 新增 `ccoach digest`（opt-in、token 受控、redacted；assistant 回复 + tool_result，不含 thinking）。
- [x] skill `ccoach-deepinsight`：两遍流（project→session）+ grounding.mjs（grounding gate）+ method/feature 引用。
- [x] HTML 报告渲染器 `scripts/render_deepinsight.mjs`（"diagnostic dossier" 暗色编辑风；类目色码；指标降级为 signal 边注；grounding 账本）+ `references/deepinsight-insights-schema.md` + `test/render-deepinsight.test.ts`。
- [x] **修 `ccoach digest --id` 窗口 papercut**：`buildDigest(dir, opts)` 去掉时间窗——`--id` 点名单会话即范围（CLI 去掉 `--date/--since/--days`）；回归测试覆盖（不带 `--days` 也能取旧会话）。
- [x] **Codex 对称（见 T30）**：补回合 edit/error 信号 + `ccoach digest --platform codex` + SKILL Codex 两遍流（ADR 0050）。
- [ ]（后续）spiral→Pass2 阈值校准、pass 率是否升为跨回合 CLI 信号。

## T30 · Codex deep-insight 对称（P1）— 🚧 进行中（分支 exp/codex-deepinsight）

> 决策：[`adr/0050-codex-deepinsight-parity.md`](adr/0050-codex-deepinsight-parity.md)
> 验证：`superpowers/specs/2026-06-07-codex-deepinsight-feasibility.md`（真实 ~/.codex：宝藏地图 + 缺口实证 + digest/grounding 原型）。

- [x] **修 Codex 回合信号缺口**：`codex.ts` 从 `patch_apply_end`(unified_diff) 派生 `applyEdit` + 文件 fileKey、从 `exec_command_end.exit_code` 判错 → `edit_ring/no_progress/rework` 不再瞎（也修复 Codex 基础 spiral 检测）。
- [x] **`ccoach digest --platform codex`**：rollout 提取 assistant 文本 + 工具 args + 结果，**不含 reasoning/developer/system**。
- [x] **SKILL.md Codex 两遍流**：grounding 复用 cwd+git（平台无关）。
- [ ]（后续 / T26）Codex 用户 prompt 语义对齐（滤 `<environment_context>`/developer）。
- [x] effort/compaction 作为回合级维度 → T32 完成（ADR 0053）；sandbox/collab 仍为 session 级分布。

## T31 · 分享卡边界化 + 去百分位 + 术语 on-page glossary（P1）— ✅ 已完成（分支 feat/share-card-glossary-redesign）

> 决策：[`adr/0051-share-card-glossary-no-percentile.md`](adr/0051-share-card-glossary-no-percentile.md)

- [x] **去百分位**：`scorecard.mjs` 删 rank 计算与字段、`scorecard-copy.json` 删 `beats_pct`/`estimate_note`、render 删 `.sc-rank`；回归断言「超过了 X%/beats」不再出现。
- [x] **成绩卡 = 单屏 share unit**：数字带（`$cost · tokens · days · cache%`）入卡、深色金 hero 卡 + 截图边界脚注；单平台移除独立 metrics 区（`--scorecard` 缺省回退）。
- [x] **short/long roast 拆分**：每轴加 `roast_short`（卡面钩子）+ `roast`（正文「成绩卡详解」长句）；render-guard 双标记；SKILL writeback 写双 roast。
- [x] **术语 on-page glossary + 本地化**：episode→回合 / severity→严重程度 / spiral→卡壳，两份报告各加术语条；`i18n.ts` + `report-copy.json` 统一；en 报告保持纯英文（ADR 0025 闸门）。
- [x] **DeepInsight TL;DR 重设计**：display serif 窄列 → 可读导语（serif/62ch/松行高）。

## T32 · v0.1.6：effort 校准 + 上下文衰减曲线 + 文件 churn + skill 层去天花板（P1）— ✅ 已完成（分支 claude-ccoach-optimization）

> 决策：[`adr/0053-episode-effort-calibration-context-rot.md`](adr/0053-episode-effort-calibration-context-rot.md) /
> [`adr/0054-project-file-churn-concentration.md`](adr/0054-project-file-churn-concentration.md) /
> [`adr/0055-open-taxonomy-runtime-verification-policy-gate.md`](adr/0055-open-taxonomy-runtime-verification-policy-gate.md)

- [x] **回合级 effort 证据**（消 T30 遗留）：Codex `turn_context.effort` 挂到 episode（`effort`）+ `compacted`；
  Claude 对称证据：回合主导 `model` + `thinking_directive`（prompt 思考指令布尔）。
- [x] **`episode_summary.effort_calibration`**：(dial, value, task_type) 全量聚合行 + `low_confidence` 门槛
  （政策结论必须同 task_type、足样本）。
- [x] **`episode_summary.context_rot`**：回合序号分桶 × spiral/corrected/error 率、`inflection_index` =
  「上下文保质期 ≈ N 回合」；insight 报告 episode 面板展示（仅足样本时）。
- [x] **`projects[].file_churn`**：跨会话文件级 churn 集中度（仅 basename、top-8、`top3_share`；本地分析限定）。
- [x] **skill 层去天花板**：开放 taxonomy（`novel_category`，每报告至少尝试一条 taxonomy 外发现）；
  运行时查官方 docs/changelog 升为主体、feature 映射表/示例话术降级 illustrative；honesty 加政策建议门槛。
- [ ]（后续）context_rot/effort 阈值用真实数据校准后，再评估「上下文保质期」是否进可分享成绩卡数字带。
- [x] **用户可见措辞去黑话**（追加）：spiral→原地打转 / "went in circles"、churn→反复改动、taxonomy→分类；
  两份报告术语条 + CLI 文本 + 面板标签全量替换；SKILL.md 写入「平实措辞规则」（英文也用简单词）。

## T33 · 特性采用信号：~/.claude.json 金矿落地（P0）— ✅ 已完成（分支 claude-ccoach-optimization）

> 决策：[`adr/0056-feature-adoption-signals-claude-json.md`](adr/0056-feature-adoption-signals-claude-json.md)
> 盘点：`docs/research/claude-data-goldmine.md`（§2a 已含 tipsHistory 语义 v2 修正：水位≠展示次数）

- [x] **`report.feature_adoption`（仅 Claude）**：白名单直接计数器（promptQueueUseCount/memoryUsageCount/
  btwUseCount/hasUsedBackgroundTask/numStartups）→ `unadopted` 一级判定；采用条件型 tip 白名单水位
  （prompt-queue/memory-command/git-worktrees/custom-agents/plan-mode-for-complex-tasks）→ `still_showing` 旁证；
  宣传型 tip 排除；`caveats` 固定告诫随数据携带。
- [x] 隐私回归：projects 路径/邮箱/工具行绝不泄露；fixture 运行不摸真实 home。
- [x] skill 指引：deepinsight Pass 1 + insight 推荐区——官方背书的 unknown_feature 推荐位；引用须标注证据口径，
  冲突如实呈现（custom-agents：配置文件检查 ≠ 子代理实际使用）。
- [x] **修 `sessions --id` 窗口 papercut**（dogfooding 实战发现）：`--id`/`--rollout` 点名会话即范围，
  未显式给时间窗时放开为全时段（对齐 digest 语义）；显式窗口仍尊重。CLI 回归测试覆盖。
- [x] **deepinsight 渲染器 chrome 本地化**：写死的英文固定文案（依据账本标题/工具局限说明/kicker/seal/
  隐私页脚/novel 角标/digest 标签）按 lang 出 zh/en，中文报告零英文黑话 chrome。
- [x] **Codex 特性采用信号 + deepinsight Magic Time**（ADR 0057，2026-06-11）：`report.codex_feature_adoption`
  （config.toml 意图 / rules 已接受规则数 / skills 装机 / state_5.sqlite 线程·子代理边·记忆产出计数 /
  automations·inbox / App 自报 fast-mode 节省 / version / ambient / 全局 AGENTS.md 状态——全白名单计数）+
  deepinsight `magic_time` 高光条（仅平台自报数/精确计数、basis 必填、禁自造换算）。
  金矿盘点：`docs/superpowers/codex-data-goldmines.md`；后续 P0/P1（threads 快路径、history.jsonl 接
  prompt-signals、spawn_edges 校准启发式）见该文档 §4。
- [ ]（后续 P0）`context_hygiene` 段：compact_boundary（trigger/preTokens/durationMs）+ cache_creation 5m/1h 分桶，
  context_rot 从推断升级为证据。
- [ ]（后续 P1）`turns` 段（turn_duration 分布）+ `reliability` 段（api_error 码谱/retry 损耗）；
  file-history 版本链深度补强返工证据（只数 @vN，不读内容）。
- [ ]（后续 P3，需新 ADR）跨 session 连续性 skill（plans/tasks/ai-title 触碰红线边缘，先立受控例外）。

## T34 · v0.1.7：deepinsight 去黑话 + 发现清单导航 + 项目体检 Beta + 徽章 i18n（P0）— ✅ 已完成（分支 0.1.7）

> 决策：[`adr/0058`](adr/0058-deepinsight-plain-language-discipline.md) /
> [`adr/0059`](adr/0059-deepinsight-findings-toc-fix-prominence.md) /
> [`adr/0060`](adr/0060-deepinsight-project-health-check-beta.md)
> 起因：用户实测反馈——报告黑话多（「闸门/双料冠军/人肉转发/tight 内容摘要」）、开头长段割裂没法跳转、
> 「UNKNOWN FEATURE」徽章被当成 bug 兜底、vibe coder 看不清项目缺什么。

- [x] **去黑话（声明式，用户拍板不做硬限制）**：SKILL.md「Plain words, always」追加 Say it plainly
  语体声明 + 4 个真实 bad case 对照（不设白名单/配额）；schema `digest_stats` 示例去内部词（示例污染
  根因）；en chrome `digest` 标签 → content summary。
- [x] **徽章 i18n + 语义澄清**：CAT 表双语化，`unknown_feature` → "Native feature available" /
  「有现成官方特性」；novel 分类新增可选 `category_label`（报告语言）；报告内分类 legend（只列出现过的、
  unknown_feature 明说「机会不是故障」）；fix/signal/conf chrome 补本地化。
- [x] **发现清单导航**：渲染器从 findings 自动生成可点击 TOC（模型不输出目录）；卡片 `f-<pass>-<i>`
  锚点；tldr 收缩为 1-2 句；FIX 升级为卡内最高视觉权重高亮块。
- [x] **项目体检 Beta**：`project_health` 四维（安全与数据/稳定性与资源/验证门与测试/架构分层）0-4 进度条
  + 重构阈值行；score 缺省=未评估；量纲进 method.md；fixture `test/fixtures/deepinsight/report-health.json`
  + vitest 回归；本地报告限定、不进可分享产物。
- [x] **体检重定义为盲区教练**（用户拍板，[`adr/0061`](adr/0061-deepinsight-blind-spot-coach-redefinition.md)）：
  教练不是审计员——去掉 0-4 评分，改为 stage 门控（prototype 只报安全红线）+ attention 行为覆盖
  （never/touched/practiced，缺席断言措辞红线）+ homework 导回 harness 官方特性；schema/渲染/SKILL/
  method/fixture 全量改写。
- [x] **code review 加固**（同分支 xhigh review 产出）：原型链安全查表（Object.hasOwn）、TOC 与盲区区块
  单一谓词（零 findings 也有目录行）、null 维度容错、conf tooltip 本地化、prefers-reduced-motion、
  fixBlock/CAT.def 去重、kind/title 报告语言规则、分享路径明确剥离 project_health、frontmatter 补 Write。
- [x] **删除误生成的 ccoach-autoresearch skill**（含其回归测试；docs/ 内部设计记录按只增不改保留）。
- [ ]（后续）盲区教练的阶段阈值与 attention 分桶用真实项目校准后再去 Beta；黑话若再现，优先补 bad case
  示例而非硬规则。

---

## 已完成（历史）
- [x] 建立 `docs/`：PRD / ADR / TODO 体系（2026-06-02）。
- [x] 规划 npm 分发与 skills 化分析（ADR 0003 / 0004，2026-06-02）。
- [x] 规划三层分析与特性优先建议（ADR 0005 / 0006，2026-06-02）。
- [x] **剥离保活、更名 ccoach、`report` 改为默认命令**（ADR 0007，2026-06-02）。
- [x] 规划游戏化可分享成绩卡 + i18n（ADR 0008 / 0009，2026-06-02）。
- [x] **实现** T1/T5/T6/T7/T2/T3（glossary、三层 scope + prompt 信号、feature-mapping、成绩卡 + zh/en、CI 检查，2026-06-02）。
- [x] **TS 重构 Phase 1 落地**（T8/T9）：`@loredunk/ccoach`（cac/tsdown/vitest、ESM、Node≥18）——统一解析层（`claude-code` + `codex` 适配器）、平台无关聚合器、双平台计价、prompt 数值信号、习惯派生、JSON/文本 emitter、CLI（`--platform`/`--json`）、ccusage 交叉验证 + 隐私回归 + TS CI；token 与 ccusage 严格相等、成本 1% 内（2026-06-02）。
