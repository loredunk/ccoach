# 0018. CLI 接管采集层：scope / 会话钻取 / opt-in prompt 预览面

状态：已接受（2026-06-03）

相关：[0004](0004-skills-based-analysis.md)（CLI 出数据 / skill 出解读）、[0005](0005-tiered-analysis-and-signals.md)（三层 scope）、
[0013](0013-self-built-unified-parser.md)（自建统一解析）、[0014](0014-claude-code-prompt-review-data-surface.md)（prompt 评级数据面）、
[0015](0015-standing-local-authorization-prompt-reading.md)（本人 prompt 默认读）、[0016](0016-error-signals-derived-tool-result-reading.md) / [0017](0017-derived-non-content-signals.md)（派生信号）。

## 背景

Phase 1 已把 CLI 从 Go 迁到 TS（`@loredunk/ccoach`），并以 ccusage 交叉验证取代 Go 行为基准。
Phase 2「去 Python」中，skill 的确定性渲染/计算层（merge / scorecard / render×2）已改写为 `.mjs`；
只剩三个**采集类** Python：

- `collect_claude_behavior.py`：Claude Code 行为画像（含 `--scope global/project/session`）。
- `session_drilldown.py`：Codex 会话钻取（+ opt-in 单会话 prompt）。
- `claude_session_prompts.py`：Claude 会话钻取（+ opt-in 单会话 redacted prompt 预览）。

它们直接读原始 JSONL 做脱敏，是**隐私关键**代码，且与 `src/parsers/*` 逻辑高度重叠。
为彻底去 Python 且不重复实现，决定把这层能力**下沉到 ccoach CLI**，skill 改调 ccoach（取代「照搬为 .mjs」）。

## 决策

1. **行为画像并入 `ccoach report`**：`Report` 增补可选 `tools.by_name` / `tools.categories` /
   `hours[].count` / `file_languages`（纯计数 / 扩展名→语言映射，契约兼容、加法）；skill 的 Claude 行为改吃
   `ccoach report --platform claude-code --json`（Codex 行为本就来自 `ccoach report`，由此两平台对称）。
2. **scope 并入 `ccoach report --scope {global,project,session}`**：输出 `projects[]` / `sessions_detail[]`
   （每桶 tokens / tool_calls / cache_hit_rate / categories / git_top / prompt_signals）。
3. **会话钻取 + opt-in 预览并入 `ccoach sessions`** 子命令：
   - `ccoach sessions --platform … [--repo] [--top] --json`：会话候选清单（数值：tokens/tools/model/source/branch/span/signals），**零 prompt 原文**。
   - `ccoach sessions --platform … --id <id> --include-user-prompts --json`：**单会话** redacted `prompts[]`
     （`preview` + 每条 `signals`）；Claude 缺 id 时自动选 token 最高单会话（延续 ADR 0015 的本机长期授权）。

## 隐私契约（延续 0014 / 0015 / 0016 / 0017，红线不放宽）

- **默认 `ccoach report --json` 永不含 prompt 原文**（`test/privacy.test.ts` 继续守）。prompt 预览**只**经
  `ccoach sessions --include-user-prompts` 显式产出，**单会话、脱敏（密钥 / home / 邮箱 / IP / 深路径折叠）+ 截断、纯本地**。
- 绝不读 assistant / thinking / tool_result 正文 / system·developer prompt / 文件内容。
- 派生信号沿用 0016 / 0017 口径：布尔 / 计数 / 白名单类别 / 非敏感标签；内容瞬时派生即弃、绝不存储或外发。
- 可分享成绩卡纯聚合、零原文。

## 后果

- 好处：全仓库零 Python；采集逻辑单一实现（CLI），skill 只消费；两平台对称；加平台只写一个适配器。
- 代价：CLI 表面变大（新增子命令 + `Report` 可选字段 + 预览门控）；需新增脱敏移植与隐私回归测试。
- 迁移：分块落地（**A** 行为字段 → **B** scope → **C** sessions/预览），每块独立可提交；
  完成后删除三个 `.py`，并更新引用它们的 ADR 链接（仅路径，不改既有决策）。
