# 研究：Claude Code 本机数据金矿盘点（claude-ccoach-optimization 分支）

> 日期：2026-06-10。目标：系统盘点 `~/.claude`、`~/.claude.json` 与项目级 `.claude/` 里
> **ccoach CLI / skills 尚未利用**的数据，评估它们能拟合出什么用户画像、支撑什么建议，
> 并给出 CLI / skills 的补充方向。隐私判定全部沿用 ADR 0015/0016/0017 框架。
> 配套实验：`docs/research/feature-adoption-probe.mjs`（已在真实数据上跑通）。

## 0. 现状基线（CLI 今天读什么）

CLI 只读 `~/.claude/projects/**/*.jsonl`，且**只解析 3 种记录类型**（`user` / `assistant` / `attachment`）。
而真实 JSONL 里有 **11+ 种记录类型**。配置面只读 settings.json 的 env 端点 + credentials 的
subscriptionType 标签。`~/.claude.json`、`history.jsonl`、`plans/`、`tasks/`、`file-history/` 完全未碰。
（`stats-cache.json` 为显式禁读——被第三方切换器污染、数据过时，维持禁令。）

## 1. 金矿一：同一批 JSONL 里未解析的记录类型（零新增读取面，ROI 最高）

实测一个大会话文件的记录类型分布：
`user 303 / assistant 525 / attachment 60 / mode 83 / permission-mode 65 / ai-title 83 / agent-name 59 / file-history-snapshot 34 / system 30 / last-prompt 79 / queue-operation 4`。

| 记录 / 字段 | 内容 | 画像维度 | 隐私判定 |
|---|---|---|---|
| `system/compact_boundary` + `compactMetadata` | trigger(manual/auto)、**preTokens**、durationMs、preservedSegment | **上下文卫生 ground truth**：现在 deepinsight 的 context_rot 是从 cache 读量「推断」的，这里是直接证据——什么时候压缩、压缩前上下文多大、手动还是被动 | ✅ 纯计数/枚举 |
| `system/turn_duration` | durationMs、messageCount（每回合） | 回合节律：p50/p95 回合时长、超长回合（实测 p95=963s、max=156min）→ spiral 的时间维度证据 | ✅ 纯数值 |
| `system/api_error` | error.code、retryAttempt、isNetworkDown | **环境可靠性画像**：实测本机 166×ECONNRESET + 64×证书错误 → 「你的代理配置在吃掉你的时间」这种半根因建议 | ✅ 错误码白名单 |
| `permission-mode` 记录 | 会话内模式切换（plan/auto/default） | plan-mode 使用率、先规划后执行 vs 直接冲的工作流形态 | ✅ 枚举标签 |
| `queue-operation` | enqueue/dequeue | prompt 排队习惯 = 流水线化程度（会不会「不等回合结束就续指令」） | ⚠️ content 字段含 prompt 原文——只计数、绝不读 content |
| `agent-name` / `isSidechain` 树 | 子代理名与层级 | 子代理委派习惯、fan-out 深度 | ✅ 名称标签 |
| `system/away_summary` | 离开期间的进展摘要 | **异步使用画像**：用户是否「下指令就走人」 | ⚠️ content 是 assistant 生成文本——只计数，不读正文 |
| `system/local_command` | slash 命令执行记录 | 原生命令使用谱 | ⚠️ 只取命令名首 token |
| `ai-title` | AI 生成的会话标题 | 会话语义索引（跨 session 检索/交接的钥匙） | ⚠️ assistant 生成 → 触碰「不读 assistant」红线；若要用需新 ADR 立受控例外（仅本地、仅会话级、绝不进可分享卡） |
| `mode` 记录 | normal/… 模式流 | 同 permission-mode 互补 | ✅ 枚举 |
| assistant `usage` 深层 | `cache_creation`(5m/1h 分桶)、`service_tier`、`speed`、`iterations`、`inference_geo`、`stop_reason` | **cache 经济学**（5m vs 1h TTL 写入比 → 「你的 cache 写入大多 5 分钟就过期」）、fast-mode 使用、截断率 | ✅ 纯数值/枚举 |
| content 块 `thinking` 计数 | thinking 块出现次数（不读内容） | 推理投入比：thinking 占比 vs 任务复杂度 | ✅ 仅计数 |
| `attributionPlugin` / `attributionMcpServer` / `attributionMcpTool` | 工具调用归因到插件/MCP | **生态 ROI**：每个插件/MCP 实际被用了多少 token | ✅ 名称标签 |
| `isCompactSummary` / `logicalParentUuid` | 压缩摘要标记 | 与 compact_boundary 配套 | ✅ 布尔 |

## 2. 金矿二：`~/.claude.json`（纯结构化，一次 JSON.parse）

### 2a. `tipsHistory` —— 已验证语义（v2 修正，2026-06-10）

**初版解读有误，已三重验证修正**：① 本机对照——`max(tipsHistory)=numStartups=386` 且数值聚集在水位附近；
② 社区字段参考（claude.json Complete Field Reference gist）原文：*"Tip ID → numStartups when the tip was
last shown"*；③ 直接逆向本机 CLI bundle（`~/.local/share/claude/versions/2.1.170`）拿到 tip 定义结构
`{id, content, cooldownSessions, isRelevant}`。结论：

- **tipsHistory 的值不是展示次数**，是「最后一次展示发生在第 N 次启动」的水位标记。无法得知累计展示次数。
- tips 分两类（bundle 实证）：
  - **无条件轮播型（纯宣传位）**：`todo-list` / `theme-command` 等，`isRelevant: async()=>!0`，
    只受 cooldownSessions 控制——**对画像零价值，必须排除**。
  - **采用条件型**：`prompt-queue`（`promptQueueUseCount<=3` 才展示）、`memory-command`
    （`memoryUsageCount<=0`）、`git-worktrees`（worktree≤1 且 numStartups>50）、`custom-agents`
    （未配置 agents）、`plan-mode-for-complex-tasks`（基于 lastPlanModeUse*）。
    **这类 tip 的展示本身就是 Claude Code 官方对「该特性未被采用」的判定。**

**修正后的派生信号（比初版更硬）**：对条件型 tip，
`numStartups - tipsHistory[id]` 小（近期仍在展示）→ 官方判定未采用；
水位长期冻结（如本机 `prompt-queue: 8` vs numStartups 386）→ 已采用、tip 永久退场。
本机实证：`memory-command: 384`、`git-worktrees: 375` 至今轮播 → `/memory` 与 worktree 是
两个有官方判定背书的推荐位。

**工程告诫**：条件型/无条件型的分类来自特定版本 bundle，跨版本会漂移——tipsHistory 只能做**旁证**。
主证据应当用 `~/.claude.json` 里的**直接采用计数器**（`promptQueueUseCount` / `memoryUsageCount` /
`btwUseCount` / `hasUsedBackgroundTask`，零解释成本）+ JSONL 真实使用记录。特性采用矩阵的设计不变，
证据层级重排为：直接计数器 > JSONL 证据 > 条件型 tip 水位（旁证）。

### 2b. 其它现成计数器/状态

- `promptQueueUseCount`、`btwUseCount`、`hasUsedBackgroundTask`、`numStartups`、`hasSeenTasksHint` — 直接的特性采用布尔/计数。
- `projects.*.lastSessionMetrics` / `lastAPIDuration(WithoutRetries)` / `lastCost` / `lastLinesAdded/Removed` / `lastModelUsage` — 每项目最近会话的官方口径指标（可用于与自算结果对账）。
- `projects.*.allowedTools`（权限条数）、`mcpServers`、`hasTrustDialogAccepted` — **权限治理画像**：哪些项目最宽、跨项目一致性。
- `githubRepoPaths` — 项目→repo 映射（敏感度低，但只取计数/布尔即可）。

## 3. 金矿三：`~/.claude` 下未触碰的目录

| 目录 | 形态（实测） | 画像/产品价值 | 隐私 |
|---|---|---|---|
| `history.jsonl` | 1478 行 `{display, timestamp, project, sessionId, pastedContents}` | 跨项目输入流：slash 命令频率、项目切换节律、粘贴行为比例。**这是唯一跨项目按时间排好的用户输入索引** | display=prompt 原文，沿用 prompt 红线（本人默认可读、转述+脱敏、全局层零原文） |
| `file-history/{session}/{hash}@vN` | 44 会话、版本链 @v1…@v8+（实测 @v2=644、@v3=171、@v8=5） | **返工 ground truth**：同一文件在一个会话里被改到第 8 版 = 打转铁证；比 JSONL Edit 计数更准（有版本链） | ✅ 只数版本号，绝不读快照内容 |
| `plans/*.md` | 10 个 plan-mode 产物 | 跨 session 资产：做过哪些规划、规划→执行的转化率（plan 后有没有对应会话） | ⚠️ 正文是 assistant 产物——只数文件/日期，正文留给用户自己 |
| `tasks/{session}/*.json` | id/subject/status/blocks/blockedBy | **任务图谱**：完成率、阻塞链长度、跨 session 任务遗弃率 → 「你有 N 个 pending 任务躺在已结束的会话里」——直接服务「跨 session 连续性」愿景 | ⚠️ subject 是用户语义文本，按 prompt 同级对待 |
| `session-env/`、`shell-snapshots/`、`paste-cache/` | 94 个会话环境、shell 快照 | 环境复杂度、粘贴习惯（与 history.pastedContents 互证） | 只计数 |
| `telemetry/1p_failed_events` | 失败事件 | 低优先（噪音大） | — |

## 4. 金矿四：项目级 `.claude/` 治理审计

工作区实测 15 个项目有 `.claude/`：`settings.local.json` 普遍存在、3 个有项目级 `skills/`、
3 个有 `worktrees/`、1 个有 `scheduled_tasks.lock`。可产出**项目 AI 工程化成熟度评分**：

- 权限治理：allowedTools 条数分布（1 条 → 33 条跨度）、有无危险宽放。
- 指南文件覆盖：CLAUDE.md / AGENTS.md 有无、新鲜度（mtime vs 最近会话）。
- 工程化装备：项目级 skills / commands / hooks / worktrees 使用。
- 这与 deepinsight 的 `--scope project` 天然契合，是「帮大家了解自己项目」愿景的直接落点。

## 5. 画像合成：六轴用户画像

上述数据可拟合出一个**六轴画像**，每轴都有官方原生特性可推（符合「只推官方/已验证方案」原则）：

1. **特性采用轴**（tipsHistory × JSONL 证据）→ 推荐被错过的原生特性。
2. **工作流形态轴**（plan 占比 / 队列 / 子代理 / 后台任务 / worktree）→ 「指挥官型 vs 结对型 vs 放养型」。
3. **上下文卫生轴**（compact 频率与 preTokens / 超长会话 / cache 5m·1h 写入比）→ 省 token 的直接抓手。
4. **返工轴**（file-history 版本链 / turn_duration 长尾 / queue 里连发纠正）→ spiral 的 ground truth。
5. **环境可靠性轴**（api_error 码谱 / retry 总耗时）→ 「你的网络/代理在偷你的时间」类半根因建议。
6. **治理轴**（项目级权限/指南/hooks 审计）→ 项目工程化成熟度与跨项目一致性。

## 6. CLI / skills 补充建议（按 ROI 排序）

- **P0 · CLI 新增 `features` 段**：特性采用矩阵，证据层级 = 直接计数器（promptQueueUseCount 等）> JSONL 使用记录 > 条件型 tip 水位（仅旁证，见 §2a 修正）。输出「未采用的原生特性」清单（特性名白名单）。skill 层把它变成头条建议。
- **P0 · CLI `context_hygiene` 段**：compact_boundary（trigger/preTokens/durationMs）+ cache_creation 5m/1h 分桶。deepinsight 的 context_rot 从「推断」升级为「证据」。
- **P1 · CLI `turns` 段**：turn_duration 分布（p50/p95/max、超长回合数）+ `reliability` 段（api_error 码谱、retry 损耗）。
- **P1 · 返工证据升级**：file-history 版本链深度（仅 @vN 分布、绝不读内容）替代/补强现有 Edit 计数 churn。
- **P2 · 生态归因**：attributionPlugin/McpServer 聚合 → 「每个插件/MCP 花了你多少 token」。
- **P2 · 治理审计进 deepinsight**：项目级 `.claude/` 成熟度评分（--scope project）。
- **P3 · 新 skill 候选 `ccoach-handoff`（跨 session 连续性）**：聚合 plans/ + tasks/ 的遗弃任务 + ai-title 索引，回答「我上次做到哪、哪些计划没落地」。直接服务「ai coding 跨 session」愿景。**注意**：ai-title / plans 正文 / tasks.subject 触碰红线边缘，需先立一篇 ADR 划受控例外（仅本地、仅会话/项目层、绝不进可分享卡）。

## 7. 隐私红线增量判定

新数据源全部可在现有框架内落地，**除三处需要新 ADR**：
① `ai-title`（assistant 生成的标题标签）；② `tasks/*.json` 的 subject（用户语义文本，建议按 prompt 同级：本人默认可读、转述+脱敏）；③ `plans/*.md` 只数不读。
其余（compactMetadata / turn_duration / api_error 码 / tipsHistory / 权限条数 / 版本链深度）均为
纯数值・布尔・白名单标签，符合 ADR 0016/0017 的派生信号标准。

## 8. 实验记录

`docs/research/feature-adoption-probe.mjs` 在本机 66 个会话上的真实输出（节选）：
plan-mode 切换 122 次、queue 4329 次、子代理 332 次、thinking 块 2610 个；
回合时长 n=879、p50=15s、p95=963s、max=156min；
API 错误：ECONNRESET×166、证书错误×64、500×12、529×8 —— 单这一项就足够支撑一条
「检查你的代理/证书配置」的高置信建议。
