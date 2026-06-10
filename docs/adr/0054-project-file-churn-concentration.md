# ADR 0054 — 项目层跨会话文件级 churn 集中度（仅 basename 的受控扩展）

> 状态：已接受 · 日期：2026-06-10 · 分支：`autoresearch`
> · 受控扩展 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md) 的「非敏感标签」白名单
> · 与 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md) D5（文件名瞬时即弃）并存：
> 回合层承诺不变，本决策只在**项目层**新增 basename 聚合

## 背景

「跨会话的文件级 churn 集中度」是指引代码类根因的高价值信号：哪些文件被反复改、改动是否高度集中在少数文件
（→ code_structure 根因：超大文件 / 信号穿层）。现状是文件身份在回合层瞬时即弃，只剩匿名的
`max_edits_per_file`——能看出「有文件被改了 8 次」，看不出**是哪个**、也看不出**跨会话是否总是它**。
deepinsight 目前靠 skill 层读 git 热点文件补位，但 git 只看到 commit 后的世界，看不到提交前被覆盖掉的
agent 编辑 churn。

## 决策

### D1 `projects[].file_churn`（--scope project）

聚合器按 `repo → basename` 攒编辑计数与涉及会话数（两平台 parser 在每次「编辑」时喂入：Claude 的
Edit/Write/NotebookEdit、Codex 的 `patch_apply_end`；均沿用各自既有的窗口/主会话过滤）。
`--scope project` 输出：

```json
"file_churn": {
  "files": 17, "edits": 96,
  "top": [{ "file": "aggregate.ts", "edits": 23, "sessions": 6 }],
  "top3_share": 0.54
}
```

`top` 按编辑次数取前 8；`top3_share` 为集中度主指标（前 3 个文件占总编辑的比例）。

### D2 隐私边界（受控扩展的范围与红线）

- **仅文件 basename，绝不含目录或全路径**（与既有 `fileKey` 口径一致；basename 与 skill 名/错误类别同级，
  属用户自己仓库的非敏感标签）。
- **仅 `--scope project` 的本地分析产物**；全局报告不出、**可分享成绩卡绝不引用文件名**（同 prompt 的
  「全局层纯聚合」红线，ADR 0015）。
- top-N 封顶（8），防长尾爆炸；不存文件内容、diff、行号，只有计数。
- 回合层（`episodes_detail`）承诺不变：仍然无文件名（ADR 0032 D5）。

## 后果

- deepinsight Pass 1 可直接回答「改动最集中在哪几个文件」并与 git 热点交叉验证（transcript churn ∩ git churn
  = 真热点；transcript-only churn = 提交前反复重写的隐性 churn，git 看不见的那部分）。
- CLAUDE.md 隐私护栏同步补一句 basename 受控例外。
