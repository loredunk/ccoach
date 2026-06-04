# ADR 0023 — 平台特色分析板块：Codex 执行画像是蓝海、Claude 差异化已覆盖

> 状态：已接受 · 日期：2026-06-04（D1 codex_specific / D2 claude_specific 已实现；D4 已进 CLI text 与 skill 层 HTML（端点/计费/执行画像卡片））
> · 沿用 [`adr/0011-multi-platform-usage-sources.md`](0011-multi-platform-usage-sources.md)（「平台数据源适配器」+「平台无关分析层」；新增信号只补适配器）
> · 复用 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md) 的「瞬时读 → 只留计数/白名单标签、原文绝不留」红线（本 ADR 全部新信号都落在此边界）
> · 与 [`adr/0022-billing-mode-plan-split-relay-guardrail.md`](0022-billing-mode-plan-split-relay-guardrail.md) 同批：0022 管「计费维度」、本篇管「执行画像维度」

## 背景

ccoach 的统一结构（`src/model.ts`）刻意做成**平台无关**：token / cache_hit_rate / repos / hours /
models_timeline / tools / git_habits / error_signals / rework_signals / prompt_signals 两平台共用，便于对称比较
（0011）。但对真实 JSONL 做字段盘点后发现：**两平台各有一批「独有信号」，且覆盖度极不对称**——Claude 的独有
信号 ccoach **多数已采**，Codex 的独有信号 ccoach **基本没采**，存在明显「Codex 特色蓝海」。

**Claude 独有 —— 多数已覆盖**：`cache_creation`（缓存写入 token，Codex=0）✓、`permissionMode` 分布✓、
`attributionSkill`（skill 使用）✓、`structuredPatch` 返工（userModified + ±行）✓、`version`✓、`attachment`✓、
子代理 sidechain✓。尚未采的小项：`usage.server_tool_use`（`web_search_requests`/`web_fetch_requests` 计数）、
`usage.service_tier`/`inference_geo`/`speed`（实测近乎常量、低价值，0022 已判 service_tier 不编码订阅，无分析价值）。

**Codex 独有 —— 基本是蓝海（本机全量实测值）**：
- `reasoning_output` token + `reasoning_ratio`✓（已采，Claude=0）。
- `turn_context.effort`（推理强度）：`high`×849 / `medium`×46 —— **Codex 独有的「用户调的努力档」**。
- `turn_context.approval_policy`：`on-request`×883 / `never`×8 / `untrusted`×4 —— 审批策略画像。
- `turn_context.sandbox_policy`：`workspace-write` 等 —— 沙箱档。
- `turn_context.collaboration_mode`：`default` / `plan` —— 协作模式（**类似 Claude 的 plan/默认模式**）。
- `turn_context.personality`：`pragmatic`×694 —— 人格档。
- `compacted` / `context_compacted` 事件×26 —— **上下文压缩频次**（长会话信号）。
- `turn_aborted` 事件×91 —— 中断回合数（与 error_signals 互补的「主动放弃」信号）。
- `token_count.info.model_context_window`：258400 —— 上下文窗口规格。
- `session_meta.git`：`repository_url` + `commit_hash` + `branch` —— **比 Claude 富**（Claude 只有 `gitBranch`）。
- `session_meta.originator`：`codex_cli_rs` / `codex_vscode` / `codex-tui` / `codex_exec` —— 细粒度客户端身份
  （比 Claude 的 `entrypoint` cli/sdk-cli 更细）。
- `rate_limits.plan_type` / `credits` —— 计费维度，归 [0022](0022-billing-mode-plan-split-relay-guardrail.md)，本篇不重复。

> 🔒 隐私要点：`collaboration_mode` 的 payload 里夹带 `developer_instructions`（**类 prompt 正文**）。本 ADR 的
> 所有 Codex 信号**只取枚举/计数**（`mode` 名 + `reasoning_effort` 标签 + 各类计数），**绝不读 `developer_instructions`
> 文本**——与 0017「绝不读非错误正文做内容用途」一致。

## 决策（提议）

在「平台无关分析层」之上**叠加**两个**纯附加、按平台填充**的特色块（不破坏对称比较的公共字段；`all` 平台或
不适用平台时整块缺省）：

- **D1（`codex_specific` 块 —— 把蓝海信号采进来）**：适配器派生以下**计数/白名单标签**（全部落 0017 边界）：
  ```
  codex_specific: {
    effort: { high: n, medium: n, ... }              // turn_context.effort 分布
    approval_policy: { "on-request": n, never: n, ... }
    sandbox: { "workspace-write": n, ... }           // 仅 mode 名
    collaboration_mode: { default: n, plan: n }      // 仅 mode 名，绝不含 developer_instructions
    personality: { pragmatic: n, ... }
    compactions: n                                    // 上下文压缩事件数
    aborted_turns: n                                  // turn_aborted 数
    context_window: 258400                            // model_context_window（取众数/最大）
    originators: { codex_cli_rs: n, codex_vscode: n, ... }
    git_repo_identity: boolean                        // 是否带 repository_url/commit（不存 URL 原文，仅布尔/或取 host 白名单）
  }
  ```
- **D2（`claude_specific` 块 —— 小而精，承认已基本覆盖）**：仅补 `server_tool_use` 计数
  （`web_search_requests` / `web_fetch_requests`）这类尚未采的项；明确**不**把 `service_tier`/`inference_geo`/`speed`
  做成板块（近常量、0022 已判无订阅区分价值）。Claude 的差异化（permission/skills/返工/版本/附件）**沿用现有
  字段、不重复造块**。
- **D3（结构与对称）**：沿用 0011——公共字段继续两平台对称、用于「谁更省缓存/谁返工多」等横向比较；特色块只承载
  **天生不对称、无法横比**的维度（你没法拿 Codex 的 sandbox 档去比 Claude）。`--platform all` 时两个特色块可并存
  （各自来源平台填充），互不污染公共聚合。
- **D4（先进 `--json`，渲染/成绩卡后议）**：特色块先只进 `--json` 契约（agent 友好），是否进 CLI text 摘要 /
  HTML 报告 / 成绩卡留给 skill 层按价值决定（0004 的「CLI 出数据、skill 出解读」分工）。

## 影响

- 补齐 Codex 侧长期缺失的「执行画像」——effort/审批/沙箱/协作模式/压缩/中断/客户端身份，让 Codex 用户的报告
  不再只是「token + repos」，有了和 Claude（permission/skill/返工）对等的**习惯纵深**。
- 全部新信号都是**派生计数/白名单标签**，无新隐私面、无原文留存（developer_instructions 显式排除）。
- 公共对称层不动，横向比较口径不受影响；特色块缺省即省 token。
- 代价：适配器要多扫 `turn_context` / `compacted` / `turn_aborted` 等记录类型（Codex 单遍内即可顺带，无额外 IO）。

## 开放问题（待讨论）

1. **板块边界**：哪些值得进、哪些是噪声？（如 `personality` 几乎恒 `pragmatic`、`context_window` 近常量——
   是否纳入，还是只留有分布的 effort/approval/collaboration_mode/compaction/abort？）
2. `git_repo_identity` 取**布尔**（是否有 repo 身份）还是 **host 白名单标签**（github.com/gitlab…）？倾向布尔或 host，
   绝不存完整 `repository_url`（可能含私有路径）。
3. 特色块是否反哺成绩卡的「轴」（如 Codex 的 compaction/abort 可做「长任务耐力」轴）？还是仅作解读素材？
4. 未来扩展平台（0011 提到的 OpenClaw/Harness）若也有独有信号，是沿用「每平台一个 `*_specific` 块」还是抽象成
   通用 `platform_extras`？（倾向前者，显式优先。）
