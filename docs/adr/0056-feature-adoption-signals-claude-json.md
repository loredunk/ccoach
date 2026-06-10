# ADR 0056 — 特性采用信号：~/.claude.json 白名单计数器 + 条件型 tip 水位旁证

> 状态：已接受 · 日期：2026-06-10 · 分支：`claude-ccoach-optimization`
> · 落地 `docs/research/claude-data-goldmine.md` §2a/§6 的 P0「features 段」（含 v2 修正：水位≠展示次数）
> · 隐私口径沿用 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md)（白名单键/计数/布尔）
> · 服务 [`adr/0006-feature-first-recommendations.md`](0006-feature-first-recommendations.md)：给 unknown_feature 建议提供**官方背书的证据**

## 背景

`~/.claude.json` 里有一批**零解释成本**的特性采用证据，CLI 此前完全没碰：

1. **直接采用计数器**：`promptQueueUseCount` / `memoryUsageCount` / `btwUseCount` / `hasUsedBackgroundTask` /
   `numStartups`——官方自己记的「这个特性你用过几次」。
2. **tipsHistory**：三重验证（本机水位对照 max=numStartups、社区字段参考、CLI bundle 逆向）确认其语义是
   「**该 tip 最后一次展示发生在第 N 次启动**」的水位标记，**不是展示次数**。tips 分两类：
   - **无条件轮播型（纯宣传位）**：`todo-list` 等 `isRelevant` 恒真，只受 cooldown 控制——对画像零价值；
   - **采用条件型**：`prompt-queue`（`promptQueueUseCount<=3` 才展示）、`memory-command`
     （`memoryUsageCount<=0`）、`git-worktrees`、`custom-agents`、`plan-mode-for-complex-tasks`——
     **这类 tip 近期仍在轮播，本身就是 Claude Code 官方对「该特性未被采用」的判定**，比从 JSONL 推断更权威。

坑（必须写进契约防误用）：水位≠次数；条件型/宣传型的分类来自特定版本 bundle、**跨版本会漂移**；不同证据源
**口径不同**（实证：JSONL 里有 332 条子代理记录、但 `custom-agents` tip 仍判「未采用」——它检查的是有没有
配置自定义 agent 文件，不是有没有用 Task 派子代理）。

## 决策

### D1 `report.feature_adoption`（仅 Claude，账户级当前快照）

`src/feature-adoption.ts` 只读 `~/.claude.json` 的**白名单键**：

```json
"feature_adoption": {
  "num_startups": 386,
  "counters": { "prompt_queue_use_count": 4300, "memory_usage_count": 0, "btw_use_count": 12, "has_used_background_task": false },
  "unadopted": ["memory", "background-tasks"],
  "tips": [ { "tip": "memory-command", "last_shown_at_startup": 384, "still_showing": true } ],
  "caveats": ["tip-watermark-is-last-shown-startup-not-display-count", "tip-conditions-drift-by-cli-version-corroboration-only", "evidence-sources-use-different-definitions"]
}
```

### D2 证据层级（写死在结构里，不靠 skill 自觉）

- **`unadopted` 仅由直接计数器判定**（阈值取无歧义的 0/false，不照抄 tip 的版本相关阈值）；
- **`tips` 仅旁证**：白名单只含采用条件型；`still_showing = num_startups − 水位 ≤ 一个冷却周期(20)`；
  宣传型与未知 tip 一律不出；
- `caveats` 固定标签把三个坑随数据携带，`--json` 消费者（agent）一眼可见。

### D3 隐私与工程

- 只读白名单键（计数/布尔/白名单 tip id 的数值），**绝不读 projects/history/oauth 等任何其它键**；
  回归测试断言路径/邮箱/工具行不泄露。
- 缺文件/解析失败静默 null（纯 Codex 机器正常）。fixture 测试时不摸真实 home：buildReport 仅在
  「未覆盖 claudeDir」或显式给 `claudeJsonPath` 时读取。
- 加性可选字段，契约不破坏；glossary 写明水位语义与口径告诫。

### D4 skill 用法

deepinsight / insight：`unadopted` + `still_showing` 的条件型 tip = **官方背书的 unknown_feature 推荐位**
（如 `/memory`）。引用任何证据源时**必须标注它的判定口径**（config 文件检查 ≠ 实际使用记录），两源冲突时
如实呈现冲突而不是择一硬说。

## 后果

- unknown_feature 类建议从「我们推断你没用」升级为「Claude Code 自己判定你没用」——证据等级质变。
- 金矿盘点的其余 P0/P1（compact_boundary 上下文卫生、turn_duration、file-history 版本链）留待后续
  （见 TODO），其中触碰红线边缘的（ai-title/plans 正文）需各自立 ADR。
