# ADR 0011 — 多平台用量分析：Codex + Claude Code，未来扩展其它 Agent CLI

> 状态：已接受（规划） · 日期：2026-06-02
> · 相关：[`PRD.md`](../PRD.md) §1 / §2、[`adr/0010-cli-rewrite-node-ccusage.md`](0010-cli-rewrite-node-ccusage.md)、[`adr/0004-skills-based-analysis.md`](0004-skills-based-analysis.md)

## 背景

ccoach 的定位是「本机 AI 用量教练」，**不是只给 Codex 用的**——它要分析用户在
**Codex 和 Claude Code** 两个平台上的用量与习惯。但当前实现是 Codex 偏心的：

- Go CLI 只解析 `~/.codex` rollout；
- Claude Code 侧的数据只在 skill 里通过 ccusage / `collect_claude_behavior.py` 拿。

文档与 README 的措辞也偶有「只读 `~/.codex`」这类 Codex 中心表述，需要纠偏：
**两平台是对称的一等公民**，且未来还要扩展到更多 Agent CLI / 编码工具。

## 决策

### D1 — Codex 与 Claude Code 是对称的一等数据源

ccoach 同时分析 **Codex** 与 **Claude Code**，二者在 CLI、报告、成绩卡里**对称呈现**，
不偏向任何一方。文档 / README / 输出措辞统一为「Claude Code / Codex 双平台」，
避免「只读 `~/.codex`」这种把产品窄化成 Codex 工具的表述。

### D2 — 用「平台数据源（source/adapter）」抽象，分析层平台无关

架构分两层：

```
平台数据源层（per-platform adapter）        分析层（platform-agnostic）
Codex      ── @ccusage/codex ──┐
Claude Code ── ccusage ────────┼──► 统一用量模型 ──► 习惯分析 / prompt 评级 / feature-first 建议 / 成绩卡
（未来）OpenClaw / Harness …  ──┘
```

- 每个平台一个适配器，负责把该平台的本机记录归一化成**统一用量模型**；
- 习惯分析、prompt 评级、人格化吐槽、成绩卡等**分析层与平台解耦**，新增平台只需补一个适配器。
- 这与 ADR 0010「构建在 ccusage 之上」天然契合：ccusage 已同时覆盖两平台
  （`ccusage` for Claude Code、`@ccusage/codex` for Codex），是双平台适配器的现成底座。

### D3 — 未来扩展到其它 Agent CLI（规划，不在本期）

把 **OpenClaw、Harness** 等其它 Agent CLI / 编码工具列为后续数据源。落地前提：
该平台有可读的本机用量记录，且能写出对应适配器归一化到统一用量模型。
本期不实现，仅在架构上为其预留位置（D2 的适配器层）。

## 后果

- 好处：产品定位准确（双平台教练，非 Codex 专属）；分析层一次写好、多平台复用；新增平台成本低。
- 代价：需维护多平台适配器与其差异（窗口、计价、字段口径）；统一用量模型要兼容各平台特性。
- 影响：PRD §1 / §2 定位与措辞、README / README_CN 描述、CLI 输出文案统一为双平台并预告未来扩展。

## 待定（Open Questions）

- **OQ1**：统一用量模型的最小公共字段集，与各平台特有字段（如 Codex reasoning、Claude 缓存 token）如何并存。
- **OQ2**：OpenClaw / Harness 的本机记录格式与可得性确认（实现前调研）。
- **OQ3**：多平台同时呈现时的对比口径（成本估算参考价、时间窗口）如何对齐，避免误导性横比。
