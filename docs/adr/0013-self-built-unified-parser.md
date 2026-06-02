# ADR 0013 — 自建统一解析层（学习 ccusage 方法，不作运行时依赖）

> 状态：已接受（规划，待实现） · 日期：2026-06-02
> · 相关：[`PRD.md`](../PRD.md) §2 / §5、[`TODO.md`](../TODO.md) T9、[`adr/0011-multi-platform-usage-sources.md`](0011-multi-platform-usage-sources.md)
> · **取代 [ADR 0010](0010-cli-rewrite-node-ccusage.md) D2**（「中等偏轻：把 ccusage 作为 npm 依赖」）

## 背景

ADR 0010 D2 定的是「构建在 ccusage 之上（中等偏轻）」——把 ccusage 当 npm 依赖拿结构化用量，
ccoach 只叠加分析层。这个判断的前提是「解析不是护城河，别重复造轮子」。

但有个新需求改变了前提：ccoach 除了统计用量（token / 成本 / 模型 / 窗口），**还要从同一批
JSONL 里抓 user prompt 与习惯/行为指标**（prompt 评级、人格吐槽都靠它）。也就是说，ccoach 要的
数据是 **ccusage 数据的超集**——读同一批文件，抽出比它更多的东西。

这时「依赖/外调 ccusage」反而别扭：拿到用量后，还得把**同一批 JSONL 再读一遍**去抓 prompt——
同一份文件解析两次、两套逻辑、两个数据源还要对齐时间窗口与 session id，这才是真正的麻烦。

结论反过来：既然无论如何都要自己读 JSONL 抓 prompt，不如**一次 pass 把用量也一起解析了**，
比依赖/外调 ccusage 更干净。

## 决策

### D1 — 自建统一解析层，一个 pass 出全部数据

ccoach 自己读 JSONL，一次遍历产出 **用量 + user prompt + 习惯/行为指标** 的完整结构化数据，
不再依赖/外调 ccusage 取数。

### D2 — 向 ccusage 学「方法」，不抄「代码」

- **该学（方法论）**：JSONL 的结构怎么读——字段含义、token 用量挂在哪条 assistant 消息、
  cache creation / read token 怎么区分、5 小时窗口怎么按时间戳切、成本怎么用 token×单价估算、
  怎么按 session / project 聚合。ccusage 的公开源码就是最好的教材，读它的 parser 理解格式，纯知识。
- **不该做（代码）**：**不复制粘贴**它的代码进仓库。ccusage 是 MIT，复制要保留版权声明，且会背上
  维护负担、失去独立性。学方法、自己实现，才是「统一封装」的正确姿势。README 里写「解析思路
  参考了 ccusage」是体面的致敬，甚至是加分项。

### D3 — 分平台适配器 → 统一数据结构

解析层做成独立内部模块（如 Node 侧 `src/parsers/`），内含 `claude-code` 与 `codex` 两个适配器，
各自处理一种 JSONL 格式差异，但都吐出**同一个统一数据结构**（`usage` + `prompts` + 派生 `habits`）。
上层评级、HTML 生成只认这个统一结构、不关心数据来自哪个平台。以后加第三个平台
（opencode / amp 之类）只是再写一个适配器。这与 [ADR 0011](0011-multi-platform-usage-sources.md)
的「平台适配器 + 平台无关分析层」一致——本 ADR 是其数据层的落地方式。

### D4 — ccusage 仅作交叉验证（对答案），非运行时依赖

实现时用 ccusage **验证**：自己算出的 token / 成本跟 `npx ccusage` 的输出对一下，数字对得上就说明
用量解析没退化。**用它验证、不依赖它运行**——`package.json` 不挂 ccusage 运行时依赖。

### D5 — 隐私边界贯穿解析层

抓 user prompt 时严守既有边界（[ADR 0005](0005-tiered-analysis-and-signals.md)）：**需用户批准才读、
绝不读 system / assistant 内容**；全局层零 prompt 原文，会话/项目层转述 + 脱敏。

## 后果

- 好处：仓库**自包含、无 ccusage 依赖**（不再有「链接别人仓库」的观感）；**一个 pass 出全量**
  （用量 + prompt + 习惯），不维护两套逻辑、不对齐两个数据源、不受 ccusage 版本变动影响；
  掌控「原始文件 → 最终洞察」全链路，prompt 这层独有数据完全在手里（护城河清晰）。
- 代价：Claude Code / Codex 的 JSONL 官方改版需**自己跟进维护**，不能再坐享 ccusage 扛。
  但本来就要读 JSONL 抓 prompt（跑不掉），多扛一个用量解析的边际成本不大，换来独立性与数据完整性，值。
- 影响：ADR 0010 D2 作废（仍保留 D1 的 Node/TS 迁移与 D3/D4/D5）；PRD §2 / §5、TODO T9、
  CLAUDE.md 架构方向同步改为「自建统一解析层 + ccusage 交叉验证」。

## 待定（Open Questions）

- **OQ1**：统一数据结构的字段定义（`usage` / `prompts` / `habits` 三块的最小公共集，与各平台特有字段如何并存）——与 ADR 0011 OQ1 合并推进。
- **OQ2**：交叉验证的固化方式（CI 里跑一次 `ccusage` 对账，还是仅开发期手动对）。
- **OQ3**：JSONL 格式变更的回归防护（保留两平台样例 fixture，格式漂移时测试先红）。
