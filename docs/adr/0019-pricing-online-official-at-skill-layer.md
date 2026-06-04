# 0019. 成本定价改为 skill 层联网查官方价；CLI 出离线 fallback；默认窗口=today

状态：已接受（2026-06-03）

相关：[0004](0004-skills-based-analysis.md)（CLI 出数据 / skill 出解读）、
[0010](0010-cli-rewrite-node-ccusage.md)（取代其「复用 ccusage 取价」）、
[0012](0012-codex-cost-tokens-ccusage-method.md)（**取代/supersede**：其内置 LiteLLM 镜像价、不联网取价、Codex 按日 ccusage 估算）、
[0013](0013-self-built-unified-parser.md)（自建统一解析；ccusage 仅交叉验证）、
[0018](0018-cli-absorbs-collection-prompt-preview.md)（CLI 接管采集层）。

## 背景

`ccoach-insight` skill 实跑时暴露了几个相互纠缠的问题：

1. **「LiteLLM 离线定价」措辞令人困惑、且不够权威**。Claude Code 成本来自 `ccusage` 内置的 LiteLLM
   价格快照（`model_prices_and_context_window.json`），是二手聚合、会过期；`src/pricing.ts` 还硬编码了
   一张对齐该快照的价表（含「VERBATIM 移植自 `internal/codexreport/pricing.go`」的 Go 影子注释）。
   数据所有者要的是**官方一手 API 定价**、**不写死**（模型常更新），且用户可能用 cc-switch 接入
   **第三方模型**（kimi/deepseek 等）——价表无法穷举。
2. **Codex 成本显示 0 / partial**。根因不是算不出：`merge_dual_platform.mjs` 的 `buildCodex` 把 ccoach
   自己算好的成本扔进 `codex_today` 角落，顶层 `cost_usd`/`models` 改用 `ccusage codex daily`——而 ccusage
   对 Codex 的 per-model `costUSD` 是 0，于是 models 全 0、写死 `cost_is_real:'partial'`。
3. **时间窗口对不上**：skill 默认拉很宽的窗口（`--since` 年初），且报告头部不标统一统计窗口，
   两平台活动期不重叠时就并排出两个错位区间。

约束：ccoach CLI 是**纯本地离线只读**工具（隐私护栏：全程只读、默认不外发），不能让它联网查价。

## 决策

把**定价**从「数据层取价」整体上移到 **skill 层联网查官方价**，CLI 只对 token/模型负责：

- **D1（CLI = token + 模型清单，纯离线）**：CLI 新增 `model_tokens[]`——每个模型全窗口的 token 分桶
  （`input/cached_input/output/reasoning_output/cache_creation/total`）+ 离线 fallback 成本 + `priced`
  标记。计价公式按模型族不同（Claude 互斥桶 vs Codex `cached⊆input`），故必须分桶。见 `src/aggregate.ts`
  `model_tokens` / `src/model.ts` `ModelTokenBreakdown`。
- **D2（成本 = skill 层联网官方价）**：skill 从合并 JSON 里收集**实际出现的每个模型名**，**联网查询其官方
  API 定价**（含第三方 provider 自己的价目页），写 `/tmp/pricing.json`，由新脚本
  `skills/ccoach-insight/scripts/apply_pricing.mjs` **确定性**按各模型 token 分桶算成本，重写
  `platforms.<plat>.{models[].cost,cost_usd}`、`combined.total_cost_usd`，盖 `cost_basis:'official-online'`
  + `priced_at`，并设 `cost_is_real`（全命中=`true`、有未命中=`'partial'`）。查不到官方价的模型回退到
  离线 fallback 估算并记入 `unpriced_models`。`apply_pricing` 的口径与 `src/pricing.ts:estimateCost` 完全一致。
- **D3（`src/pricing.ts` 降级为可选离线 fallback）**：硬编码价表只在 CLI 单独离线跑、或某模型查不到官方价时
  兜底；去掉 Go 影子与 LiteLLM 字段名注释。**取代 [0012](0012-codex-cost-tokens-ccusage-method.md)** 的
  D2/D3（内置 LiteLLM 镜像价、不联网取价）与 [0010](0010-cli-rewrite-node-ccusage.md) 的「复用 ccusage 取价」。
- **D4（token 来源分平台）**：对账发现 ccoach 与 ccusage 的 Claude per-model token 归属差约 20%（ccusage 逐行读、
  ccoach 去重），故 **Claude 的显示 token 仍用 ccusage 的逐行归属**（可信、`verify-ccusage.ts` 把关），
  **Codex 用 ccoach 的 `model_tokens[]`**（ccusage codex 不可用且是 0 成本 bug 的根源）。两平台的**钱**都改用官方价。
- **D5（默认窗口=today）**：CLI 默认已是 today（`src/window.ts`，`--date>--since>--days>默认`）；SKILL 工作流对齐——
  不给时间就 today，给 `--date/--days/--since` 才放宽，所有命令共用同一窗口。merge 输出加 `window` 块，render
  头部显式标「统计窗口」；某平台窗口内无活动时面板标「本窗口内无活动」（guard 空 `date_range`）。
- **D6（ccusage 降为交叉验证）**：沿用 [0013](0013-self-built-unified-parser.md)；`--codex-ccusage` 变可选；
  清理把 ccusage 当运行时依赖 / 计价权威的措辞。

## 影响

- 修好 Codex 成本（按模型归属、非 0）；成本不再依赖 LiteLLM 二手快照；价表不再需要随模型更新改代码。
- 报告头部时间一致、可读；两平台窗口不重叠时不再并排错位。
- 代价：每次出报告多一步联网查价（仅发模型名、不发用量/prompt）；第三方价目页格式不稳，靠 `unpriced_models`
  + 离线 fallback 兜底。

## 开放问题

- 跨运行的官方价缓存（避免每次都查）。
- 第三方 provider 价目页的可靠核验与单位归一（per-1K vs per-1M）。
