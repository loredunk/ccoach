# ADR 0010 — CLI 从 Go 迁移到 Node/TypeScript，衔接 ccusage（中等偏轻）

> 状态：已接受（规划，待实现） · 日期：2026-06-02
> · 相关：[`PRD.md`](../PRD.md) §2 / §5、[`TODO.md`](../TODO.md) T8 / T9、[`adr/0003-npm-distribution.md`](0003-npm-distribution.md)、[`adr/0011-multi-platform-usage-sources.md`](0011-multi-platform-usage-sources.md)
> · 影响：取代 ADR 0003 中「用 npm 分发 Go 二进制」的实现路径

## 背景

CLI 现在是 Go 写的（`cmd/ccoach`、`internal/codexreport`）。当初选 Go 的唯一理由是
**单二进制好分发**——一个零依赖可执行文件，`./ccoach` 立刻就跑。

但产品的整条线其实都活在 Node 生态里：

- skills 通过 `npx skills add` 分发；
- 用户群是 **Claude Code / Codex** 用户，本身就在 Node 生态；
- 我们已经在 skill 侧依赖的 **ccusage 是纯 TypeScript**，且有 `@ccusage/codex` 专门处理 Codex（含 GPT-5、1M 窗口）。

要走 npm（ADR 0003 的目标）反而得给 Go 二进制套一层「平台子包 + `optionalDependencies`」的分发封装
（ADR 0003 D2），等于**为了分发方便引入了不方便**。CLI 也用 Node 写，整个故事就统一成
「一切皆 npx」，没有任何阻抗。

## 决策

### D1 — CLI 用 TypeScript 重写

放弃 Go，CLI 改用 **TypeScript**（非纯 JS——项目要长期维护、开源被人读，类型值这个钱）。

**失去**（确认不在意）：启动速度与「单文件分发」的纯粹性。Go 二进制零依赖即跑，Node 版
`npx ccoach` 首次要拉包、有运行时冷启动开销。但 ccoach 是「偶尔跑一次看报告」的低频工具，
不是热路径，这点延迟无所谓。

**得到**：

1. **分发彻底统一**——CLI 与 skill 都在 npm/npx 里，用户心智不切换，README 安装段清爽成一行；
   且 Node 包天然跨平台，ADR 0003 D2 的多平台二进制矩阵 / 下载封装直接**不再需要**（消掉 TODO 最麻烦的一项）。
2. **可复用 ccusage 的解析逻辑**（见 D2）。
3. **HTML 成绩卡生成更顺手**——模板渲染、SVG 转图、配色，JS/TS 生态比 Go 拼字符串舒服得多。

### D2 — 构建在 ccusage 之上（中等偏轻）

ccoach 的差异化价值**从来不在「解析 JSONL」**（ccusage 做得比我们好且免费），而在
**习惯分析、prompt 评级、人格化吐槽、feature-first 建议**——这些是 ccusage 完全没有的。
因此把「解析这层」尽量外包，专注在我们真正独特、且能病毒传播的那层。

采用**中等偏轻**：

- **中等**：把 ccusage 作为 **npm 依赖**引入（`ccusage` for Claude Code、`@ccusage/codex` for Codex），
  调它的 API 拿**结构化用量数据**，ccoach 在其上叠加习惯 / prompt 分析层。定位清晰——
  ccoach 就是「**ccusage 之上的 coach 层**」。
- **偏轻**：ccusage 尚未覆盖、或以子进程调用更省事的部分（如 skill 侧 Claude Code 数据已在用
  `ccusage` 命令），保留**外部命令调用**而非强行进 API。

> 取舍：放弃「全部自己解析、只换语言」（最重）——那是在别人已做好的事情上重复投入，与项目自我诊断相悖。
> 也放弃「纯把 ccusage 当外部命令、自己不依赖它的包」（最轻）——拿不到稳定的结构化 API，多平台扩展更费劲。

### D3 — 技术选型

- **CLI 框架**：用轻量的 `cac` 或 `citty`（ccusage 生态偏好的极简款），不用 `commander` 那么重——
  命令不多（`report` 默认 + `--date / --since / --days / --by-repo / --json`）。
- **构建打包**：`tsdown` / `unbuild` 一类，保持 **bundle 小**（对 `npx` 拉取体验有实际好处，对标 ccusage 的极小包）。
- **跨平台**：Node 天然跨 mac / linux / win，无需预编译矩阵。

### D4 — 保持 JSON 契约不变，skill 侧无感切换

`ccoach --json` 的输出契约（字段、`glossary` 口径）**保持不变**。skill 侧本就是消费 CLI 的
`--json`，只要 Node 版守住同一份 JSON 契约，`skills/ai-usage-html-report/` **无需改动**——
这是 ADR 0004「CLI 与 skill 分离」设计的红利。

### D5 — 渐进迁移，不一次性重写

Go 版能跑、逻辑验证过，是宝贵的**参考实现**，迁移期间保留当对照：

1. 先在新 Node 项目里把**核心数据流**跑通：读 `~/.codex` rollout（或直接调 `@ccusage/codex`）→
   结构化用量 → 输出 `--json`，**先对齐 Go 版的 JSON**，用同一份数据**交叉验证两版结果一致**，确保解析不退化；
2. 再往上叠习惯分析、评级、HTML；
3. Node 版稳定后再退役 Go 版。

避免「重写完才发现某个 Codex 边界 case 漏了」的回归。

## 后果

- 好处：分发统一为 npx；省掉自维护的 JSONL 解析与多平台二进制矩阵；HTML / 成绩卡开发更顺；多平台扩展更易（见 ADR 0011）。
- 代价：引入 Node 运行时冷启动开销；新增对 ccusage 的依赖（需跟随其版本与 API 变化）。
- 影响：ADR 0003 的「Go 二进制平台子包分发」（D2）作废，npm 分发简化为「普通 Node 包」；PRD §2 / §5、README 安装段、TODO T4 同步更新。

## 待定（Open Questions）

- **OQ1**：ccusage 的 API 稳定度与版本策略——以包依赖（pin 版本）为主，还是关键路径留子进程兜底？
- **OQ2**：`@ccusage/codex` 是否已覆盖我们记录过的 Codex JSONL 边界 case；不足处由 ccoach 适配层补。
- **OQ3**：习惯分析 / 配置扫描（原 `habits.go` / `configscan.go` / `language.go`）在 Node 侧的等价实现与测试基线。
