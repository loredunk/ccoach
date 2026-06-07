# Codex deep-insight 可行性验证 — `~/.codex` 数据宝藏

> 状态：验证完成（草案，待是否立项） · 日期：2026-06-07 · 分支：`exp/codex-deepinsight`
> 背景：deepinsight v1 仅 Claude Code（ADR 0048/0049 明确 Codex 对称留后）。本文用真实 `~/.codex` 数据验证 Codex 侧是否同样可支撑深洞见。
> 证据：本机 `~/.codex` 88 个 rollout · 42.6 MB · 2025-12-11 → 2026-04-28；抽样 60 文件 13017 条记录 + 单会话深挖。

## 裁决：可行，且 Codex 在多处比 Claude 更富

`~/.codex/sessions/**/rollout-*.jsonl` 的信息量**不亚于** `~/.claude`，在几处对 deepinsight 关键的维度上**更强**。四项核心能力已逐一在真实数据上验证。

## 已验证（真实数据）

### 1. 数据宝藏地图（record type → deepinsight 支柱）

| rollout 记录 | 抽样量 | 对应 deepinsight 支柱 |
|---|---|---|
| `turn_context`（model/cwd/**effort/approval/sandbox**） | 130 | **episode 边界**（ADR 0032 已用）+ Codex 独有的每回合配置 |
| `response_item: function_call`(+args) | 2534 | spiral：工具序列 / edit_ring / no_progress |
| `response_item: function_call_output` | 2534 | **正文 digest（防幻觉验证闸）**：工具结果正文 |
| `response_item: message` role=assistant | 951 | digest：assistant 回复正文 |
| `response_item: reasoning`(summary/content/encrypted) | 1272 | 🚫 **思维链——红线，绝不读正文** |
| `event_msg: exec_command_end`(exit_code) | 1052 | spiral：error_dense（退出码=错误信号） |
| `event_msg: patch_apply_end`(changes=**diff**) | 175 | edit_ring / rework / 改动行数（diff 内联！） |
| `event_msg: token_count` | 1875 | 用量/成本（ccoach 已用） |
| `event_msg: collab_*` / `spawn_agent`/`wait_agent` | 多 | 🆕 子代理/协作编排（Codex 独有可见） |
| `compacted` | 4 | 🆕 上下文压缩事件（长会话触顶信号） |
| `session_meta`(id/cwd/source/originator) | 60 | grounding（cwd）+ 来源 |

### 2. 缺口实证：Codex 回合对"文件编辑/错误"是瞎的

`ccoach --platform codex --scope episode` 已产出 277 回合，但 top spiral 全是 `files=0/maxEdits=0/errs=0` 的弱 `time_outlier`。单会话深挖证明数据其实**全在**：

> 会话 `019dc909`（pod_trans）：`patch_apply_end` **23 次编辑、20 个不同文件**、`exec_command_end` 178 次（**22 次非零退出=错误**）——但 ccoach episode 记为 `files_touched=0 / max_edits=0`。

**根因**：`src/parsers/codex.ts` 只 forward `applyTokens / applyTool('shell'|'web'|'other') / applyToolResult / markInterrupted`，**从不调 `applyEdit`，也不给 `applyTool` 传 `fileKey/isEdit/ext`**（对比 Claude 路径 `aggregate.ts` 的 `applyEdit(...)` + `applyTool('file',{isEdit,fileKey,ext})`）。→ Codex 的 `edit_ring/no_progress/rework_signals` 无法触发。**这不止影响 deepinsight，基础 spiral 检测对 Codex 也是半瞎的。**

### 3. 正文 digest 原型：token 经济学与 Claude 完全对称

同一会话，用 `function_call_output + assistant 文本 + function_call args`（**排除 reasoning**）构 digest：

- 完整正文 ~**26.6 万 token**（不可控）→ **tight ~7.5K（省 97%）**、rich ~30K（省 89%）。
- 与 Claude 侧（~18.9 万 → tight 7.5K/96%）同一量级 → **防幻觉验证闸对 Codex 同样成立且 token 可控**。

### 4. grounding 原型：cwd + git 即可（平台无关）

会话 `session_meta.cwd` 存在（`git_origin_url/git_branch` 本批数据未填，但 cwd 足够）。现成的 `grounding.mjs` 喂 [first,last] + cwd → 返回窗内提交 `39cfb887 fix: stabilize long task lifecycle and TTS playback`，与会话主题吻合。**grounding gate 直接复用，无需 Codex 专用代码。**

## 红线（与 Claude 同，不放宽）

`reasoning`(content/encrypted_content)、`developer`/system 消息、`session_meta.instructions` —— **绝不读正文**。digest 仅取 assistant 文本 + 工具 args + 工具结果。reasoning 的 `summary` 字段属灰区，默认也不取。

## Codex 独有的加分宝藏（Claude 没有）

- **每回合 effort/approval/sandbox**（`turn_context`）→ 可把"高 effort/低 sandbox"与 churn 关联，Claude 给不出。
- **collab/子代理编排事件** → 多代理协作模式洞察。
- **compaction 事件** → 长会话触顶诊断。
- **AGENTS.md / config.toml / rules/ / memories/**（项目级上下文）+ **sqlite 索引**（`logs_2.sqlite`/`state_5.sqlite`/`session_index.jsonl`）→ Pass 1 项目尺度可读"你给了 Codex 什么上下文"。

## 落地路径（若立项）

1. **补 Codex 回合编辑/错误信号**（`codex.ts`）：从 `patch_apply_end.changes` 派生 `applyEdit`(±行) + 文件 fileKey；`exec_command_end.exit_code≠0` → `applyToolResult(isError)`。**先修这条，base spiral 检测对两平台才对称。**
2. **`ccoach digest --platform codex`**：从 rollout 取 `function_call_output + assistant 文本 + fn args`（脱敏、截断、封顶、**不含 reasoning**），与 Claude digest 对称。
3. **Codex prompt 门**（`isHumanPrompt` 对称）：滤掉 `<environment_context>` 注入与 developer 消息（ADR 0041/0043 follow-up）。
4. **deepinsight SKILL.md 加 Codex 两遍流**：grounding 已平台无关；episode/spiral 待第 1 步补全后即可用。
5.（加分）surface effort/sandbox/collab/compaction 维度。

## 下一步

验证确认可行。建议按 Claude 同样的流程推进：brainstorm → spec（含新 ADR：Codex 对称 + digest 扩 codex）→ plan → 实现。**先做第 1 步（补回合信号）单独可发版**，它本身就修复了 Codex 的基础 spiral 检测。
