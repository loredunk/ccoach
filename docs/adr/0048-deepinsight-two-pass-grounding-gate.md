# ADR 0048 — deep-insight：两遍流（project→session）+ grounding gate + 内容验证闸

> 状态：已接受 · 日期：2026-06-07
> · 沿用 [`adr/0005-tiered-analysis-and-signals.md`](0005-tiered-analysis-and-signals.md) / [`adr/0006-feature-first-recommendations.md`](0006-feature-first-recommendations.md)
> · 复用 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md) / [`adr/0034-spiral-detection-deepest-pit-story.md`](0034-spiral-detection-deepest-pit-story.md)
> · 配套 [`adr/0049-ccoach-digest-optin-content.md`](0049-ccoach-digest-optin-content.md)

## 背景

`ccoach-insight` 是偏娱乐的统计成绩卡。用户需要一个**严肃的生产力/行为洞察工具** `ccoach-deepinsight`：
给出**语义根因 + 可执行解法**，让用户更有意识地驾驭 harness。真实实验（2026-06-07，三臂对照 +
三对抗审核）证明：**纯指标会自信地编造错误根因**——只看轨迹的臂对某会话断言"跑偏、活儿没做成"，
经 git+prompt 核验纯属幻觉（它把会话外 7–11 小时的提交错误关联了进来）。

## 决策

### D1 两遍流

- **Pass 1 · PROJECT（默认、便宜、不读正文）**：跨会话聚合定位系统性、改一次受益全局的根因，
  产出 ship-once 修复（如 `.claude/settings.json` PostToolUse hook、CLAUDE.md Commands block + 模块地图）。
- **Pass 2 · SESSION（spiral 命中 / 用户钻取）**：钻单个最深的坑，出单回合行为根因。

### D2 grounding gate（不可违反）

会话级"这回合在干嘛 / 活儿成没成 / 是否跑偏"的判断，**只锚定该会话自己的 prompt + 落在其
`[first,last]` 窗口内的提交**；**绝不跨窗口时间关联附近提交**。

### D3 内容验证闸

当会话根因取决于"意图"且要出 `confidence>=high` 时，**先花一笔 tight 正文摘要验证**（见 ADR 0049）。

### D4 指标降级 + 假阳性诚实

绕圈率/pass 率等指标只作**配角佐证**，绝不进根因正文当主语；敢明确说"这是健康工作、无需改"；
当某信号其实是工具自身仪表局限（如 task_mix 大量 unknown 是分型器未校准）须标注。

### D5 去重

两遍得出同一结论时只在 project 尺度说一次，session 尺度作实例引用，不逐会话重复唠叨。

## 后果

- skill 为主、CLI 仅加性（ADR 0049 + sessions bug 修复）；分工不破（CLI 出数据 / skill 出解读）。
- 隐私红线整体不放宽，唯一 opt-in 放宽见 ADR 0049。
- v1 仅 Claude Code、产出 markdown；HTML/Codex 对称留后。

## 开放问题

- OQ1 spiral 触发 Pass 2 的阈值与 top-N 选取，待真实数据校准。
- OQ2 pass 率是否值得未来做成跨回合按文件 churn 的 CLI 一等信号（v1 不做）。
