# Codex 数据金矿盘点 — `~/.codex` 与项目级数据源（探索分支产物）

> 分支 `codex-ccoach-optimization` 的探索结论：盘点 ccoach CLI / skills **尚未利用**的 Codex 本机数据源，
> 每项给出联网验证出处、隐私分级（对照 CLAUDE.md 隐私护栏与 ADR 0015/0016/0017）、能拟合的用户画像维度、
> 以及落地建议。末尾附在本机真实数据上按 ccoach-deepinsight 方法跑出的洞察样例。
>
> 环境：Codex CLI 0.125.0（macOS），数据截至 2026-04-29 前后；今日 2026-06-10。

## 0. 现状基线：已用 vs 未用

CLI 现有 Codex 解析（`src/parsers/codex.ts`）**只读 `sessions/**/rollout-*.jsonl`**，且对 rollout 内字段
覆盖已较好：`turn_context`（approval_policy / sandbox / collaboration_mode / personality / effort）、
`token_count`（含 plan_type 标签）、compaction、aborted turns、originator、`patch_apply_end` /
`exec_command_end` 派生信号。`config.toml` 仅被 `src/endpoint.ts` 读 base_url 判断 endpoint。

**JSONL 之外的一整层数据完全未动。** 同时 `feature_adoption` 字段在 Codex 报告里恒 `null`——
Claude 侧有 ADR 0056（`~/.claude.json` 计数器），Codex 侧没有对称物。这是最大的不对称缺口。

## 1. 数据源清单（按价值排序）

### 1.1 `state_5.sqlite` — 会话元数据库 ★★★

**验证**：官方真实。Codex 以 SQLite 作为会话发现/历史的主查询层，`threads` 表 + `session_index.jsonl`
+ rollout JSONL 三者同步（[openai/codex#23979](https://github.com/openai/codex/issues/23979)、
[#22452](https://github.com/openai/codex/issues/22452)、
[DeepWiki: Rollout Persistence](https://deepwiki.com/openai/codex/3.5.2-rollout-persistence-and-replay)）。

| 表 | 内容 | 隐私分级 | 价值 |
|---|---|---|---|
| `threads` | 每会话：`tokens_used`、`source`(cli/vscode/mcp)、`model`+`reasoning_effort`、`sandbox_policy`、`approval_mode`、`git_sha/branch/origin_url`、`archived`、`memory_mode`、`cli_version`、`cwd`、`title`、`first_user_message` | 元数据列=受控派生信号（计数/白名单标签）；`title`/`first_user_message` 属 prompt 类（ADR 0015：脱敏+截断） | **零解析成本的会话索引**：`ccoach sessions` 列表可不全量扫 JSONL；git 分支/origin 是现成 repo 身份；`archived` 率是会话整理习惯 |
| `thread_spawn_edges` | 精确的「父会话→子代理」边 + 状态 | 纯 ID 关系 + 计数 | 子代理图谱：现在 CLI 靠 rollout 内启发式判 subagent，这里是**精确事实**（本机：50 条边、2 个父会话、角色 explorer/worker/default） |
| `stage1_outputs` | 记忆管线产物 `raw_memory`/`rollout_summary` | **红线**：内容由 assistant 输出蒸馏而来，绝不读正文；仅可用 `count`/`usage_count`/`selected_for_phase2` 等计数判断记忆管线是否运转 | 记忆特性 adoption 信号 |
| `agent_jobs` | 批量 agent 任务（CSV 输入/输出） | 计数即可 | 特性 adoption（本机 0 = 未用） |
| `remote_control_enrollments` | 远程控制注册 | 计数即可 | 特性 adoption |

### 1.2 `config.toml` — 配置画像 ★★★

**验证**：官方真实，字段齐全（[Config Reference](https://developers.openai.com/codex/config-reference)、
[Config basics](https://developers.openai.com/codex/config-basic)）。`personality`（pragmatic/friendly/none）、
`model_reasoning_effort`、`plan_mode_reasoning_effort`、`[projects].trust_level`、`[plugins]`、`[features]`
均为文档化配置；官方还定义了**项目级 `.codex/config.toml` / hooks / rules 分层**（trusted 项目才生效）。

未用信息（全部白名单标签/计数，隐私安全）：
- `personality` / `model_reasoning_effort` / `plan_mode_reasoning_effort` —— 配置侧偏好（rollout 里是每回合实际值，config 是**意图**；二者差值本身是洞察）。
- **trusted 项目清单**（计数 + 是否含 home 目录这类宽信任）—— 信任面画像。本机 8 个 trusted，含 `/Users/mac`（整个 home trusted，可提示收窄）。
- `[plugins]` 启用清单、`[features]` 开关、`[notice.model_migrations]`（是否跟进模型迁移）。

### 1.3 `history.jsonl` — 跨会话 prompt 历史 ★★★

**验证**：官方真实（Codex 消息历史持久化，见 [Config Reference](https://developers.openai.com/codex/config-reference) 的 `[history]` 节）。
`{session_id, ts, text}` 一行一条，本机 124 条。

**这正补上 deepinsight 自承的短板**——SKILL.md Codex notes 写着 "Codex user prompts are still thin
(env-context injected; not yet parsed)"。`history.jsonl` 就是干净的**纯用户输入**存储：无 env 注入、无
assistant 内容、自带 session_id 可回连 rollout。隐私分级：prompt 类，ADR 0015 全套（默认读、脱敏+截断、
全局层零原文）。可直接喂 `prompt-signals.ts` 出 prompt 评级，省一遍 rollout 扫描。

### 1.4 `rules/default.rules` — 智能审批已接受规则 ★★

**验证**：官方真实。Smart approvals 在升权时提议 `prefix_rule()`，用户接受后写入
`~/.codex/rules/default.rules`（[Rules](https://developers.openai.com/codex/rules)）。

本机 72 条已接受 prefix 规则 = **重度 smart-approvals 采用者**。信号：规则计数（+ 可选：规则首 token 的
白名单命令类别），不存命令全行（同 ADR 0016 瞬时派生原则）。画像维度：审批摩擦自治程度。
对 Claude 侧的对称物是 `settings.json` allowlist——双平台可出同一个「permission 自治度」指标。

### 1.5 `sqlite/codex-dev.db` — Automations / Inbox ★★

**验证**：官方真实。Automations = Codex App 定时/触发式后台任务，结果进 inbox
（[Automations](https://developers.openai.com/codex/app/automations)、
[App Features](https://developers.openai.com/codex/app/features)）。表：`automations`（含 rrule、model、
reasoning_effort）、`automation_runs`、`inbox_items`。

本机全 0 = 特性未用。计数即可，是 feature-first 建议的高价值靶子（「你每周手动重复 X，automations 可以定时跑」）。

### 1.6 `.codex-global-state.json` — Codex App 状态 ★★

**验证**：Codex App（桌面端）为官方产品（[App Features](https://developers.openai.com/codex/app/features)）；
该文件是其 Electron 持久化状态（非文档化内部格式，**字段名随版本漂移，解析需防御式**）。

金矿字段：
- `fast-mode-personalized-estimate`：`estimatedSavedMs`（本机 ≈74 分钟）+ `rolloutCountWithCompletedTurns`（56）——
  Codex 自己算的「fast mode 帮你省了多少时间」，成绩卡天然素材（标注「Codex App 自报估算」）。
- `agent-mode-by-host-id`、`codexCloudAccess`、`composer-auto-context-enabled`、ambient-suggestions 同意状态——App 特性 adoption。
- `prompt-history`：App 侧 prompt（prompt 类，ADR 0015 规则）。
- workspace roots / `project-order`：App 与 CLI 工作面差异。

### 1.7 记忆系统痕迹：`memories/` + `threads.memory_mode` ★★

**验证**：官方真实。原生 Memories 两阶段管线（Phase 1 抽取 → `stage1_outputs`；Phase 2 固化 →
`memories/MEMORY.md` 等），文档见 [Memories](https://developers.openai.com/codex/memories)、
[DeepWiki: Memories System](https://deepwiki.com/openai/codex/3.9-memories-system)；完整管线在更新版本
（约 v0.128+）才落地。

本机：88/88 会话 `memory_mode=enabled`，但 `stage1_outputs` 0 行、`memories/` 空——**记忆从未产出**
（版本 0.125.0 早于管线完整版）。信号组合「enabled 但零产出」→ 升级建议；产出后「记忆条数/引用次数
（`usage_count`）」是 adoption 指标。rollout 里的 `memory_citation` 事件可数引用次数。

### 1.8 杂项（计数/布尔级）★

- **`AGENTS.md`（全局 + 项目）**：官方 guide 文件。**存在性 + 字节数**即可——本机全局 `~/.codex/AGENTS.md`
  是 **0 字节**（建了没写）；最重项目 pod_trans **只有 CLAUDE.md 没有 AGENTS.md**（见 §3）。
- **`skills/`（全局 `~/.codex/skills/` + 项目 `.codex/skills/`）**：官方 skills 特性
  （[Agent Skills](https://developers.openai.com/codex/skills)）。装机清单 = adoption（本机：全局 1 个自装 +
  5 个系统 skill；项目级 boss/.codex/skills 1 个）。
- **`version.json`**：`latest_version` vs 实装 + `last_checked_at` —— 版本陈旧度（特性建议的前置条件）。
- **`models_cache.json`**：官方模型清单 + `default_reasoning_level` + 弃用/升级标记——「可用但没用过的模型」、
  「还在被迁移旧模型」信号（配合 config 的 model_migrations）。
- **`session_index.jsonl`**：线程命名习惯（是否命名会话）。
- **`ambient-suggestions/*/ambient-suggestions.json`**：每项目建议条数（本机 0 条）——App 主动建议特性是否真在产出。
- **`logs_2.sqlite`（160MB）/ `log/codex-tui.log`（21MB）**：仅 `level` 计数（ERROR 率）可考虑；
  `feedback_log_body` 正文**不读**。性价比低，默认不做。

## 2. 能拟合的用户画像维度（全部由上述白名单信号组合）

1. **自治-信任轴**：approval（on-request/never 分布）× sandbox（read-only/workspace-write）× trusted 项目数
   × prefix 规则数 → 从「步步审批」到「全自动」的连续画像。
2. **特性采用面**：skills / plugins / automations / memories / ambient / cloud / fast-mode / 多 agent
   ——每项 adopted/未 adopted，直接驱动 feature-first 建议（对称 Claude 侧 ADR 0056）。
3. **强度调档习惯**：config 意图（medium + plan 高）vs 每回合实际（high 54 / medium 21）——「配置说省、
   实际常拉满」这类意图-行为差。
4. **多 agent 工作流**：spawn 边数、角色分布、爆发式 vs 常态化使用。
5. **工作面分布**：cwd × tokens_used 的集中度（本机 78% token 在单一项目）+ CLI/IDE/App 多端分布。
6. **维护卫生**：版本陈旧度、AGENTS.md 缺失/空文件、会话从不 archive（88/88 未归档）。

## 3. 本机 deep insight 样例（按 ccoach-deepinsight 方法；已脱敏）

1. **［unknown_feature · 高置信］最重的 Codex 项目在零项目向导下裸跑。**
   `<主项目>` 占本机 Codex 用量 ~78%（149M/191M token、66 线程），仓库里只有 CLAUDE.md——而 **Codex 不读
   CLAUDE.md**；全局 `~/.codex/AGENTS.md` 又是 0 字节空文件。等于每一次 Codex 会话都在没有项目规约的状态下
   重新摸索。跨会话文件 churn 佐证：`progress.yaml` 被 8 个会话反复改 19 次、一个测试文件 16 次。
   **修法**：把 CLAUDE.md 的核心规约抄成一份 `AGENTS.md`（官方 guide 文件），全局空文件要么写要么删。
2. **［unknown_feature · 中置信］记忆系统开着但从未产出。** 88/88 会话 memory_mode=enabled，但抽取表 0 行、
   `memories/` 空——版本 0.125.0 早于记忆管线完整版。升级 Codex 后，跨会话记忆正好治第 1 条里「每次重新
   解释上下文」的病根。
3. **［workflow · 健康，无需改动］审批自治做得很好。** 72 条已接受 prefix 规则 + on-request 为主 + 1 次
   `never`、10 个 read-only 会话——既消了审批疲劳又没放弃沙箱。这是健康用法，不是问题。
4. **［workflow · 观察］多 agent 是爆发式用法。** 50 次子代理派生全部集中在 2 个父会话（explorer/worker
   角色齐全）——会用、但没融入日常。哪类任务值得常态化拆 explorer/worker 可作后续观察。
5. **［低置信 · 仅观察，不成结论］思考强度档位与打转率看不出弹性。** effort 标定行全部 `low_confidence`
   （样本过薄），按 deepinsight 政策门槛不下结论；context-rot 各桶 rot 率 ~0.55 基本持平，同样不足以给
   /clear 时点建议。
6. **［仪器诚实］** 第 5 条的薄样本本身说明：补上 §1 的金矿（尤其 threads 表免解析索引 + history.jsonl
   prompt 流）能把 episode 标定的样本面拉宽，这是 ccoach 自己的工具改进项，不是用户行为问题。

## 4. 落地建议（优先级）

- **P0 `codex_feature_adoption`**（对称 ADR 0056）：config.toml（personality/plugins/features/trusted 数）+
  rules 计数 + skills 装机数 + automations/inbox 计数 + memories 产出计数 + ambient 条数 + 版本陈旧度 +
  AGENTS.md 存在性/字节数 → 填掉 Codex 报告里恒 null 的 `feature_adoption`。全计数/布尔，隐私零新增面。
- **P0 threads 表作 `ccoach sessions` 快路径**：免全量 JSONL 解析的会话索引（tokens_used/model/branch/
  source/archived），JSONL 仍是权威、SQLite 作索引并交叉校验（两库漂移有已知 issue，需容错）。
- **P1 `history.jsonl` 接入 prompt-signals**：补齐 Codex prompt 评级短板（ADR 0015 全套红线照旧）。
- **P1 `thread_spawn_edges` 替换/校准 subagent 启发式**；spawn 图谱进 codex_specific。
- **P2 Codex App 信号**（global-state 防御式解析）：fast-mode 节省时长进成绩卡（标注自报估算）、App 特性 adoption。
- **不做**：logs_2.sqlite 正文、stage1_outputs 正文（红线）、配额类字段（护栏：rate_limits 恒 null）。

每条动手前另起 ADR；本文档只是探索盘点，不是决策记录。
