# ADR 0050 — Codex deep-insight 对称：补回合编辑/错误信号 + Codex 正文 digest

> 状态：已接受 · 日期：2026-06-07 · 分支：`exp/codex-deepinsight`
> · 落地 [`adr/0048-deepinsight-two-pass-grounding-gate.md`](0048-deepinsight-two-pass-grounding-gate.md) 的 Codex 对称（原 v1 仅 Claude）
> · 扩展 [`adr/0049-ccoach-digest-optin-content.md`](0049-ccoach-digest-optin-content.md) 到 Codex（rollout 正文）
> · 修正 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md) / [`adr/0034-spiral-detection-deepest-pit-story.md`](0034-spiral-detection-deepest-pit-story.md) 在 Codex 侧的信号缺失
> · 依据：`docs/superpowers/specs/2026-06-07-codex-deepinsight-feasibility.md`（真实 `~/.codex` 验证）

## 背景

`~/.codex` rollout 的信息量不亚于 `~/.claude`，但实测发现 **Codex 回合对文件编辑/错误是瞎的**：`src/parsers/codex.ts` 从不处理 `event_msg: patch_apply_end`（文件改动连同 `unified_diff` 全丢），错误检测又依赖对 `function_call_output` 文本的推断式 JSON 解析（真实输出是文本 blob，解析失败 → 恒不报错）。结果 Codex 的 `edit_ring / no_progress / rework_signals` 无法触发，spiral 退化为弱 `time_outlier`。这不止挡住 deep-insight，也让**基础 spiral 检测对 Codex 半瞎**。

## 决策

### D1 从 `patch_apply_end` 派生编辑信号（修基础缺口）

`event_msg: patch_apply_end.changes` 形如 `{ "<path>": { type, unified_diff, move_path } }`。对窗口内、非子代理的每个改动文件：
- 解 `unified_diff` 数 `+`/`-` 行（排除 `+++/---/@@` 头）→ `agg.applyEdit(added, removed, false)`（Codex 无 `userModified` 概念，恒 false）。
- `agg.applyTool('file', undefined, { isEdit: true, fileKey: basename, ext })` → 喂 episode `files_touched` + `editCounts`（→ `max_edits_per_file` → `edit_ring`）。
先 `beginRecord(repo, sessionId, ts)` 保持 scope 桶口径。

### D2 错误检测改用 `exec_command_end.exit_code`（可靠数字）

新增 `call_id → exit_code` 映射，由 `event_msg: exec_command_end`（含可靠数字 `exit_code`）填充。`function_call_output` 处理时优先用该映射的退出码判 `isError`，回退到原 `codexOutcome` 文本解析。并把 `custom_tool_call_output`（其 `output` 是带 `metadata.exit_code` 的 JSON）纳入结果处理。口径不变：仅白名单类别 + 计数，错误文本瞬时派生即弃。

### D3 `ccoach digest --platform codex`（扩 ADR 0049 到 Codex）

新增 `buildCodexDigest(home, opts)`：按 `--id`（子串）定位单 rollout，按时间序提取 **assistant message 文本 + function_call 名/args + function_call_output / custom_tool_call_output 结果正文**，复用 `redact()` 脱敏 + 逐项截断 + 总量封顶（tight/rich，同 Claude）。**绝不含 reasoning（思维链）/ developer / system / `instructions`**。CLI `digest` 命令解除"仅 claude-code"限制，`--platform codex` 走此路径（同样 `--id` 必填、无时间窗）。

### D4 grounding 直接复用

Codex `session_meta.cwd` 已有；`grounding.mjs`（平台无关，cwd + git log 窗口）无需改动。deep-insight SKILL 增加 Codex 两遍流说明。

### D5 暂不做（留 T26）

Codex 用户 prompt 语义对齐（滤 `<environment_context>` 注入、developer 消息）属 ADR 0041 / T26 范畴；deep-insight Pass 2 暂以 digest（含 assistant 叙事）+ grounding + 回合信号为主，prompt 为辅。SKILL 注明该限制。

## 后果

- **Codex 基础 spiral 检测被修复**（D1/D2 与 deep-insight 解耦，本身可独立发版）。
- `--json` 加性扩展（episode 字段语义不变，只是 Codex 现在真正填上）；隐私红线零放宽（reasoning/system 仍绝不读）。
- digest 在两平台对称；grounding 平台无关。

## 开放问题

- OQ1 `patch_apply_end` 与 `function_call_output(apply_patch)` 是否对同一改动重复计数——以 `patch_apply_end` 为编辑权威源、`apply_patch` 类 function_call 不再单独计 file 编辑，避免双算（实现时以 fixture 校验）。
- OQ2 Codex effort/sandbox/collab/compaction 作为 deep-insight 额外维度，留后续。
