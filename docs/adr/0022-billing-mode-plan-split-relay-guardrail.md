# ADR 0022 — 计费维度拆分：Codex 订阅 plan tier 可拆、Claude 不可拆；中转(relay)检测护栏

> 状态：已接受 · 日期：2026-06-04（D1/D2a/D2b/D3/D4 均已实现并测试；endpoints[] 块落地，数据面扩张已生效）
> · 沿用 [`adr/0011-multi-platform-usage-sources.md`](0011-multi-platform-usage-sources.md)（平台数据源适配器 + 平台无关分析层）
> · 复用 [`adr/0016-error-signals-derived-tool-result-reading.md`](0016-error-signals-derived-tool-result-reading.md) /
>   [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md) 的「瞬时读 → 只留布尔/计数/白名单标签、原文绝不留」红线
> · 受 [`adr/0019-pricing-online-official-at-skill-layer.md`](0019-pricing-online-official-at-skill-layer.md)（成本估算口径、默认窗口=today）约束
> · 触碰 [`CLAUDE.md`](../../CLAUDE.md)「隐私护栏」的「不输出配额百分比、`rate_limits` 恒 null」——本 ADR 给出**不放宽该红线**的派生边界

## 背景

用户希望把 token 用量按**计费模式**拆开看：哪些花在**订阅/Plan**（Claude Max·Pro / ChatGPT Plus·Pro），
哪些花在**按量 API**。动手前对两平台真实 JSONL 做了字段探查 + 对 `openai/codex` 主分支做了源码级核对
+ 对中转切换器（本机 `cc-switch-cli`，赞助商 PackyCode 中转）做了机制确认。结论是**两平台严重不对称，且
中转会污染最直接的信号**：

1. **Codex —— 订阅 plan tier 可从历史 JSONL 恢复**。`event_msg` 的 `token_count.info` 旁挂
   `payload.rate_limits`，含 `plan_type`（实测取值 `plus` / `pro` / `null`）+ `primary`/`secondary` 双配额窗口
   + `credits`。本机全量实测：**99.8% token 落在「有 rate_limits」的订阅会话**（plus 3.44 亿 / pro 3183 万 /
   plan_type 为 null 但有窗口 3880 万），仅 0.2%（7 个 rollout、全是同型号同周）「有 token 无 rate_limits」。

2. **「无 rate_limits」≠ 确定 API**。那 7 个 rollout 同型号（gpt-5.4）、集中在 2026-03 一周内，更像**某版
   客户端/exec 模式不下发 rate_limits**（与 `openai/codex` issue #14728「exec 模式 `rate_limits` 恒 null」一致），
   而非真按量 API。故「订阅」可靠可测、**补集只能叫「未分类」，不能武断标 API**。

3. **Claude —— 计费模式无法从历史 JSONL 恢复**。`message.usage.service_tier` 实测**恒为 `standard`**（本机
   10073 条全 standard、34 条 null）。按 Anthropic 官方 Service tiers 文档，`service_tier` 只编码**服务容量档**
   （`standard`/`priority`/`batch`），与「用订阅 OAuth 还是按量 API key 认证」**完全正交**——订阅与按量都落
   `standard`。Claude JSONL 也不记录端点/host。故 Claude 侧**没有任何 per-token 计费信号**。

4. **中转(relay)会污染最直接的信号（源码级坐实）**。`rate_limits.plan_type` 的值来自**后端流响应体**
   （`codex.rate_limits` 事件 → `codex-rs/codex-api/src/rate_limits.rs:parse_rate_limit_event` → `plan_type: event.plan_type`），
   **不是**本地 `id_token` JWT 校验得来；该事件经 WebSocket 透传、落入 `TokenCountEvent.rate_limits` 并写进
   rollout。中转作为中间人**既能透传也能伪造** plan_type。→ **仅凭 rollout JSONL 无法区分「真订阅」与「中转
   模拟订阅」**。实测主流中转（PackyCode / cc-switch）走的是 **API-key 风格**接入（`auth.json` 写第三方
   `OPENAI_API_KEY`、`config.toml` 写 `[model_providers.<名>].base_url` 指向中转域名、`wire_api="responses"`），
   真实表现是**订阅信号缺失/降级为 ApiKey 态**，而非主动伪造假订阅；但「能伪造」这条链路在源码中成立。

5. **唯一可靠的中转签名是「端点覆写」，但它不在 ccoach 现读的两类 JSONL 里**。Codex 的 `base_url` 只存在于
   `~/.codex/config.toml`，Claude 的 `ANTHROPIC_BASE_URL` 只在 `~/.claude/settings.json`/env——**都不会写进
   rollout / projects 的 JSONL**。在 JSONL 内唯一的弱信号是 Codex `session_meta.model_provider`：切到中转后会变成
   自定义名（`custom`/`deepseek`…）而非 `openai`——但中转可命名为 `openai` 规避，**低-中置信、可伪造**。

## 决策（提议）

把「计费模式」做成一个**诚实、带置信、绝不越隐私红线**的维度。核心原则：**只在能可靠区分处拆，分不清就
明说「未分类」；plan_type 可被中转伪造，故必须与端点信号交叉、并标注置信度，绝不下「这是官方订阅」的断言。**

- **D1（Codex `billing` 块 —— 按 plan tier 拆 token）**：适配器对每个 rollout 记录该会话观测到的
  `rate_limits.plan_type`（取首个非空值），把该会话的 token 归入对应桶。新增统一结构字段（仅 Codex 填）：
  ```
  billing: {
    by_plan_tier: { plus: <tokens>, pro: <tokens>, ... }   // 仅出现过的 tier
    unclassified: <tokens>                                   // 有 token 但整段无 plan_type
    sessions_with_plan: <n>, sessions_unclassified: <n>
    confidence: "spoofable-by-relay"                         // 固定告警标签
  }
  ```
  **绝不输出**配额百分比（`used_percent`）、`resets_at`、`credits.balance`、`window_minutes`——`rate_limits`
  顶层字段**仍恒为 null**（CLAUDE.md 红线不放宽）。我们只从 rate_limits 的**存在性**与 **plan_type 标签值**
  派生「计费归类」，这是 token 归因、不是账户级配额，符合 0016/0017 的「布尔/计数/白名单标签」边界。

- **D2（中转检测 —— 分两层，均采纳；D2b 读 config 做可靠端点检测，已拍板 2026-06-04）**：
  - **D2a（JSONL 内，零数据面扩张）**：Codex 适配器读 `session_meta.model_provider`，派生白名单布尔
    `non_default_provider`（`model_provider !== "openai"`）。这是**低置信、可被命名规避**的弱旁证，仅作提示。
  - **D2b（读 config 做端点检测 —— 已采纳，正式扩 ccoach 只读数据面）**：读本机配置派生**端点白名单标签**
    （绝不读 key/token 原文、绝不存完整 URL）：`~/.codex/config.toml` 的活跃 `model_provider` base_url 的 **host
    是否官方域名**（只留布尔/host 白名单）、`~/.codex/auth.json` 的 `auth_mode`（`chatgpt`|`apikey`，布尔）、
    `~/.claude/settings.json` 的 `ANTHROPIC_BASE_URL` host 是否 `api.anthropic.com`、`~/.claude/.credentials.json`
    的 `subscriptionType` 标签。产出 `endpoint: official|custom|unknown` + `relay_suspected: bool`。这些都是
    **派生布尔/白名单标签**、瞬时读、不外发、不存 token，落在 0016/0017 的派生信号边界内。
    **数据面扩张（本 ADR 正式登记）**：ccoach 的只读数据面由 0013/0018 的「两类 JSONL」**扩为「两类 JSONL +
    本机 4 个 config（codex `config.toml`/`auth.json`、claude `settings.json`/`.credentials.json`）的派生白名单标签」**。
    红线不放宽：仅读这 4 个文件、仅派生布尔/host 白名单/枚举标签、**绝不存或外发 key/token/完整 base_url URL**。

- **D3（诚实置信 —— billing_mode 三态，绝不武断）**：综合 plan_type（可伪造）+ 端点信号（D2）给出
  `billing_mode ∈ { subscription, api_or_relay, unknown }`，并永远附 `confidence`。**有 plan_type 但端点非官方
  → 标 `api_or_relay` 而非 `subscription`**（中转模拟优先判为非订阅，宁可保守）。无端点信息时（仅 D2a）
  对有 plan_type 的会话标 `subscription?`（带问号/低置信），绝不去掉问号。

- **D4（Claude —— 不做 per-token 拆分）**：`service_tier` 与计费模式正交、JSONL 无端点字段，故 Claude
  **不提供 token 计费拆分**。至多在启用 D2b 时给一个**账户级当前快照**标签 `account_billing: {subscriptionType,
  base_url_official, auth_token_kind}`（明确标注「本机·当前快照、非历史、非 per-token」）。默认不输出，避免把
  账户级现状误读成历史用量归属。

- **D5（与默认窗口的衔接）**：沿用 0019 D5 默认窗口=today。`billing` 维度随窗口聚合；窗口内无 Codex 活动时
  `billing` 缺省（与「本窗口内无活动」一致）。**顺带澄清**：用户曾观察「Codex 统计不出项目名/时间」实为
  默认窗口=today 命中无活动日所致（`--days N` / `--since` 即正常），**非 Codex 适配器缺陷**——已实测
  `--since 2025-01-01` 下 Codex 正常给出 21 项目 / 5 模型 timeline / 13 小时桶。

## 影响

- 用户能看到「订阅 plan tier（plus/pro）各花了多少 token」——本机实测这能解释 99.8% 的 Codex 用量归属，
  且**明确把分不清的 0.2% 标「未分类」、把中转风险标 `spoofable-by-relay`**，不制造虚假确定性。
- `rate_limits` 顶层仍 null、不输出任何配额百分比/余额——隐私红线零放宽。
- Claude 侧诚实地「不提供」per-token 计费拆分，避免用 `service_tier` 造一个会误导人的假维度。
- 代价（已接受）：ccoach 数据面从「两类 JSONL」扩到「+ 本机 4 个 config 文件的派生白名单标签」（只读、派生标签、
  不外发、不存 key/完整 URL）；实现时在 0013/0018 的数据面描述旁补登记。换来的是中转可被可靠识别、billing_mode
  能给出有据的三态判定，而非停留在「plus/pro 但可能是中转模拟」的低置信。

## 已拍板

- **D2b 采纳（2026-06-04）**：读本机 4 个 config 做可靠端点检测，正式扩 ccoach 只读数据面（见 D2b）。
  本 ADR 是该数据面扩张的登记处；实现时同步在 [`adr/0018-cli-absorbs-collection-prompt-preview.md`](0018-cli-absorbs-collection-prompt-preview.md)
  的数据面描述旁补一笔指引。

## 开放问题（待讨论）

1. **官方域名白名单的维护**：`endpoint=official` 的判定需一张官方 host 白名单（`api.anthropic.com`、
   `api.openai.com`、`chatgpt.com`…）。第三方/区域端点、企业自建网关如何归类（custom 还是单列）？白名单随官方变化谁来更新？
2. `billing` 维度是否进 `--scope project/session` 桶？是否进可分享成绩卡（成绩卡红线：纯聚合、零原文——
   plan tier 是聚合标签，似可；但「订阅 vs 中转」涉敏感，建议成绩卡只出聚合 token、不出 billing_mode 判定）。
3. 与 ccusage 对账：ccusage 按模型名计量、对端点/计费模式无感知，故 `billing` 维度**无对照基准**，
   `verify-ccusage.ts` 只能继续校 token 总量/成本，不校 billing 拆分（需在测试里说明）。
4. 是否给一个 `ccoach billing`/`--explain-billing` 子命令或仅作 `--json` 字段？（倾向后者，先只进 JSON 契约。）
