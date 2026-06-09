# ADR 0052 — ccoach-autoresearch：自演化的最小探针深度洞察循环

> 状态：已接受 · 日期：2026-06-09
> · 复用 [`adr/0048-deepinsight-two-pass-grounding-gate.md`](0048-deepinsight-two-pass-grounding-gate.md)（两遍流 / grounding gate / 指标降级）+ [`adr/0049-ccoach-digest-optin-content.md`](0049-ccoach-digest-optin-content.md)（opt-in 正文摘要）
> · 沿用 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md) / [`adr/0034-spiral-detection-deepest-pit-story.md`](0034-spiral-detection-deepest-pit-story.md) / [`adr/0036-quantified-counterfactual-baselines.md`](0036-quantified-counterfactual-baselines.md)（魔法维度）
> · 隐私沿用 [`adr/0016`](0016-error-signals-derived-tool-result-reading.md)/[`adr/0017`](0017-derived-non-content-signals.md)/[`adr/0038-privacy-levels-two-stage-extract-analyze.md`](0038-privacy-levels-two-stage-extract-analyze.md)

## 背景

`ccoach-deepinsight` 是 LLM 驱动的语义根因前向过程，但「挖一个项目耗时很久」——主要成本在 agent 自身的 in-context token（满量 `episodes_detail[]` 是最大 token 黑洞，无缓存的全语料重扫紧随其后，外加无预算的仓库阅读与逐 finding 的 WebSearch）。同时没有**可验证的质量信号**，也没有**跨次迭代沉淀经验**的机制——每次都从零开始凭感觉。

我们要一个微型「训练循环」给 deep-insight 流程本身：探针→洞察→评估→优化，闭环、可验证、可优化，**不训练模型**（语言梯度 / Reflexion / DSPy 风格），且**复用** deepinsight 方法、不重造根因分析。

## 决策

### D1 新 skill + 三个 .mjs + 一个 JSON 账本，CLI 零改动

新增 `skills/ccoach-autoresearch/`，编排 `ccoach-deepinsight` 作为其生成步。脚本：`probe-runner.mjs`（探针+蒸馏+维度异常排名+bandit 选维）/ `eval-judge.mjs`（6 条评分）/ `strategy-update.mjs`（语言梯度回写+bandit 后验+迭代行）。持久账本 `~/.ccoach/autoresearch/strategy.json`。**探针完全建在现有 `ccoach --json` 便宜层契约上，CLI 不加任何东西**（CLI 出数据 / skill 出解读不破）。

### D2 最小探针（便宜层，无正文）

一次 `ccoach … --scope project --json --no-glossary` + 一次 `--scope episode --json`（probe-runner 立即蒸馏成 `deepest_pit` + `spiral.severity>0` 子集，丢弃其余——正面打掉满量 episode dump 这个最大 token 黑洞）+ 只读仓库（平台 guide：claude-code 读 CLAUDE.md / codex 读 AGENTS.md，绝不交叉；manifest；verify-gate；git 热点）+ 一个零成本本地横切信号（`~/.claude/stats-cache.json` 的 firstSessionDate/speculation-saved + `~/.claude/tasks/*.json` 状态枚举直方图——纯标签/计数/预聚合，落在 ADR 0016/0017 受控例外内）。digest 默认 OFF。

### D3 魔法维度发现 + 多臂老虎机预算分配

探针对每个既有魔法维度（episode/spiral/rework/prompt/verify-gate/feature-gap）按**用户自己窗内基线**（ADR 0036，零跨用户）算异常分；Thompson 采样把紧预算分给最异常的 1–3 维，**inaction 臂**剪掉无信号的维（健康项目廉价产出「无需改」）。维度顺序/框架来自账本，故可优化。

### D4 可验证 eval rubric（6 条 0–1，可复现）

C1 grounded-in-window（grounding.mjs 实证、绝不取窗外）/ C2 semantic-not-metric（确定性 deny-list）/ C3 actionable（judge）/ C4 official-feature-only（白名单硬闸，命中第三方习惯 skill 直接 0；含时间感知模型护栏）/ C5 survives-falsification（仅高置信意图断言时触发 opt-in tight digest 证伪）/ C6 novel-vs-prior（对账本去重）。确定性子项（C2/C4/C6）先跑作诚实下限；主观子项（C1/C3/C5）走 LLM-judge，**顺序交换平均 + 对 golden set 校准≥80% 一致**后才信任自改。聚合 quality 0–1 + 记录 cost。

### D5 优化 = 语言梯度回写可变策略 + Pareto 闸 + old-vs-new A/B

eval 失败子项 → 追加 verbal critique 进 `lessons[]`（Reflexion），更新 bandit 后验，可改 `dimension_order`/`digest_threshold`/`framing`，写新 `iterations[]` 行。`--ab` 在**同项目同窗口**跑冻结 incumbent vs candidate，**仅当 quality 不降且不破成本阈值、或在 cost×quality 上严格 Pareto 改善才采纳 candidate**。跨迭代头号指标 = quality/1k-token，循环自报分数。

### D6 账本纯聚合、零原文

账本只存维度名/分数/计数/脱敏后的 finding 标题，**零 prompt 原文、零 assistant/digest 正文**；per-(platform,project) 一文件，本机、不同步、gitignore。写入前一律脱敏+截断。

## 后果

- 循环是可重放的扁平 trace（一个 SKILL.md + 三个可读 .mjs + 一个 JSON），人能端到端读、可 fork；不是框架。
- 复用 deepinsight 的 `grounding.mjs` / `render_deepinsight.mjs`，零重复。
- 隐私红线整体不放宽；唯一 opt-in 放宽（C5 的 tight digest）沿用 ADR 0049。
- 判断留给模型 + verifier，确定性兜底子项防 judge 漂移；先做最笨闭环（Phase 0），由 eval 回归解锁复杂度（bandit/A-B）。

## 开放问题（已定默认，可在 review 时推翻）

- OQ1 golden set 由谁标注：默认**我在 ccoach 仓库上先种 8–12 条手标 good/bad**作种子，校准 judge≥80% 一致后才信任自改。
- OQ2 账本是否纳入版本控制：默认**否**（运行期产物、本机、gitignore）。
- OQ3 A/B「同窗口可复现」：默认**冻结一份探针快照到磁盘**，让 incumbent 与 candidate 对同一输入打分。
- OQ4 是否给 CLI 加 `--spiral-only` / `report --repo`：本期**不做**，probe 客户端蒸馏；列为未来非阻塞 affordance。
- OQ5 新 `~/.claude` 元数据信号范围：用户已明确授权捞 `~/.claude`，纳入；**严格仅标签/计数/预聚合**，落在 ADR 0016/0017 受控例外内，绝不读正文。
