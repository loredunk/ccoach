# ADR 0032 — Episode（回合）抽象层：以用户指令为边界切分会话

> 状态：已接受 · 日期：2026-06-05
> · 沿用 [`adr/0005-tiered-analysis-and-signals.md`](0005-tiered-analysis-and-signals.md)（分层分析与信号口径）
> · 复用 [`adr/0016-error-signals-derived-tool-result-reading.md`](0016-error-signals-derived-tool-result-reading.md) 与 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md)（瞬时读 → 只留布尔/计数/白名单标签的派生信号红线）
> · 加性扩展 [`adr/0018-cli-absorbs-collection-prompt-preview.md`](0018-cli-absorbs-collection-prompt-preview.md)（CLI 接管采集 + 加性契约）
> · 对称落到 [`adr/0011-multi-platform-usage-sources.md`](0011-multi-platform-usage-sources.md)（Codex / Claude Code 双源）
> · 作为底座支撑 [`adr/0033-episode-task-typing-within-type-normalization.md`](0033-episode-task-typing-within-type-normalization.md)（episode 任务分型）与 [`adr/0034-spiral-detection-deepest-pit-story.md`](0034-spiral-detection-deepest-pit-story.md)（绕圈检测）

## 背景

ccoach 现状解析层是「单趟流式聚合」：`src/aggregate.ts` 的 `Aggregator` 由 parser 逐条读 JSONL，**立刻**把信号灌进全局计数器（token 桶、工具计数、错误计数、编辑次数…）。这种设计对「全局/项目/会话总量」够用，但**时序结构当场被压扁丢弃**——每条记录在哪个用户指令之下、它前后发生了什么，读完即忘。

而教练级深度（绕圈、打断归因、反事实、风格画像）全部建立在一个**当前不存在的抽象**上：**Episode（回合）**——以每条用户指令为边界，把会话切成「一条用户指令 → 下一条用户指令之间的全部 agent 活动」。一个 episode 就是「用户说了一句话，agent 为此做的所有事」。

关键观察：**raw 数据其实完整保留了切分所需的全部信息**，只是被现有聚合丢弃了。可用边界/配对信号包括：

- per-record 时间戳（可定 episode 的起止与活跃时长）；
- user / assistant 记录边界（可识别「新指令」）；
- `tool_use.id` ↔ `tool_result.tool_use_id` 配对（可把工具调用与其结果归入同一 episode）；
- 打断标记：Claude 的 `toolUseResult.interrupted`、Codex 的 `metadata.interrupted`。

所以本 ADR 不新增任何采集面，只是**在丢弃前把时序留住**，给一切深度分析建一个共同底座。

## 决策

### D1 — 新增 `src/episodes.ts`，挂在 parse 与 aggregate 之间

新增平台无关模块 `src/episodes.ts`，内含两个角色：

- `EpisodeBuilder`：攒**当前 episode** 的有序事件（token 增量、工具调用序列、工具结果、编辑、打断标记），是个短命的累加缓冲。
- `EpisodeAccumulator`：持有已 finalize 的 episode 列表，并负责派生（见 D3）。

接线方式做到**零回归**：

- parser 在检测到边界（D2）时调 `agg.beginEpisode(session, repo, ts)`，先 finalize 上一个 episode、再开一个新的。
- 现有 `applyTokens` / `applyTool` / `applyToolResult` / `applyEdit` / `markInterrupted` **在各自已有逻辑的末尾顺带转发**进「当前 episode」。全局计数器行为完全不变，episode 只是搭车记录。
- 在**下一个边界**或**文件（rollout）末尾**时 finalize 当前 episode。

因为只是「在已有调用尾部多转一份」，现有全局聚合数值与 `--json` 契约不受影响。

### D2 — 边界检测留在 parser（边界本就平台特异）

episode 的边界定义两平台不同，故**边界识别放在各自 parser**，`episodes.ts` 只接收 `beginEpisode` 信号、不关心平台细节：

- **Claude Code**：边界 = **非 sidechain** 且 **`userText` 非空** 的 `type:user` 记录。注意纯 `tool_result` 投递所产生的 user 记录其 `userText` 为空——那不是新指令，**不算边界**。
- **Codex**：边界 = `turn_context` 记录。Codex rollout 无独立的用户消息记录、parser 当前也不读用户 prompt，而每个 `turn` 约等于一次用户指令，故以 `turn_context` 作为 turn（≈指令）起点。

### D3 — `EpisodeDetail` 字段

每个 episode 产出一条 `EpisodeDetail`（进 `src/model.ts` 统一结构）：

- `session_id` / `repo` / `index`（会话内序号）；
- `start_ts` / `end_ts` / `duration_seconds`；
- `tokens`（完整 token 桶，与全局同结构）；
- `estimated_cost_usd`（**离线 fallback** 估算，权威成本仍由 skill 层联网官方价计算，沿用 ADR 0019）；
- `tool_calls`（计数）；
- `files_touched`（计数）；
- `max_edits_per_file`（单文件最多被编辑次数，绕圈/返工的早期信号）；
- `error_count` / `error_rate`；
- `interrupted`（布尔）；
- `end_type`：`natural | interrupted | corrected`；
- `task_type` + `confidence`（分型见 ADR 0033）；
- `spiral`（绕圈信号见 ADR 0034）。

`end_type` 口径：

- `natural`：正常结束（被下一条指令或文件末尾收尾，且无打断/纠错）；
- `interrupted`：episode 内出现打断标记；
- `corrected`：**仅 Claude**——下一条用户 prompt 命中纠错词启发式（「不对 / 重来 / 错了 / no, …」类白名单词）。Codex 因 parser 当前不读用户 prompt，**不支持 `corrected`**，对应 episode 退化为 `natural`。

### D4 — 口径：仅主会话、保守不虚增

- **仅主会话**：sidechain（子代理）token 仍按既有逻辑计入**全局总量**，但**不归任何 episode**。因此恒有 `Σ episode.tokens.total ≤ report.tokens.total`，差值即 sidechain 的量。这条不等式是**有意为之**——episode 维度宁可少算也不虚增烧钱数。
- **时长口径**：`duration_seconds` = episode 内 **gap-capped 活跃时长**（沿用全局 `IDLE_CAP_MS = 5min`：相邻事件间隔超过上限按上限封顶），**不用 wall-span**（起止墙钟差），避免用户中途 AFK 把时长撑爆。与全局 `duration` 同一口径，可加和对账。
- **不跨文件/rollout 桥接**：文件末尾**强制 finalize** 当前 episode，绝不把跨 rollout 的活动并进同一 episode。

### D5 — 隐私（沿用 0016 / 0017，红线零放宽）

- episode 的**全部信号都从已读的结构化数据派生**：token 数、工具名、错误类别、`is_error`、`interrupted`、`structuredPatch` 行数等——**不新读任何内容**（不读 assistant / thinking / system·developer prompt / tool_result 正文 / 文件内容 / diff 文本）。
- 有序工具序列、以及用于 `edit_ring`（同一文件反复编辑的环路）判定的**文件 basename**，**只瞬时派生即弃**；basename 在 episode 内被映射成**局部 id**（`f0` / `f1` …），**绝不存储、绝不输出**真实文件名/路径。
- `episodes_detail[]` 落地与外发的内容里：**无 prompt 原文、无路径、无文件名、无 diff 文本**——只有数值、布尔、白名单标签。可分享成绩卡口径不变（纯聚合、零原文）。

### D6 — 契约（加性，沿用 0018 / 0024 风格）

- **新增 `--scope episode`**：与 `project` / `session` 平行。`ccoach report --scope episode --json` 产出 `report.episodes_detail[]`，**按 severity / token 排序**并 **top-N 封顶**（防止大账户 JSON 爆量）。
- **主报告恒附 `report.episode_summary`**：一个小块、加性的聚合（如 episode 数、平均/中位时长、打断率、纠错率），**默认输出即带**，不需开关。
- `Scope` 类型从 `global | project | session` 扩成 **`+ episode`**。
- **默认输出对现有 skill 完全不变**：未请求 `--scope episode` 时 `episodes_detail[]` 不出现，只多一个加性的 `episode_summary` 小块——延续「只增字段、不改既有字段语义」的加性契约。

## 后果

- **一切深度分析有了共同底座**：任务分型（ADR 0033）、绕圈检测（ADR 0034）、打断/纠错归因、反事实与风格画像都从 episode 列表派生，不再各写一套时序重建。
- 改动集中在 `src/model.ts`（`EpisodeDetail` / `episode_summary` / `Scope` 扩展）、`src/episodes.ts`（新模块）、`src/aggregate.ts`（转发接线 + 派生）、`src/parsers/{claude-code,codex}.ts`（边界检测 + 打断标记）、`src/cli.ts`（`--scope episode`）、`src/emit/*`（渲染）。
- 需补两类回归：**隐私回归**（`episodes_detail[]` 不含原文/路径/文件名/diff；basename 不外泄）与**契约回归**（默认输出无 `episodes_detail`、`episode_summary` 加性、`Σ episode.tokens.total ≤ report.tokens.total`）。
- 代价：聚合层从「纯流式无状态」变成「保留当前 episode 的有限缓冲」，内存随**单个会话**的事件数增长（episode finalize 后即可压成 detail、释放原始事件），可控。

## 开放问题

### OQ1 — Codex `turn_context` 是否每 turn 一条

D2 假设 Codex 每个 turn 恰好一条 `turn_context`。**须用真实 rollout fixture 核实**。若证伪（一个 turn 出现 0 或多条），则边界退化为：**「token 活动之后再出现的 `turn_context` 视为新 episode」**（即用「有活动后又见 turn_context」去重连续的 context 记录）。

### OQ2 — sidechain token 是否归因到父 episode

D4 当前把 sidechain token 排除在所有 episode 之外（仅入全局）。未来是否把子代理消耗**归因到触发它的父 episode**，使 episode 维度也能反映子代理烧钱？**v1 不做**，先保持 `Σ ≤ total` 的保守口径，待有需求再评估归因的可靠性与隐私面。

### OQ3 — `episodes_detail` 的 top-N 封顶口径与排序键

封顶阈值 N、以及排序键的精确定义（severity 如何打分、与 token 的优先级、打断/纠错是否加权）需用多份真实数据校准，避免「最值得看的回合」被截掉。实现时定，并在 `episode_summary` 里保留全量计数以免封顶造成总量错觉。
