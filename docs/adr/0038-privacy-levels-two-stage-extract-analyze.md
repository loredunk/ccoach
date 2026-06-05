# ADR 0038 — 隐私分级 L0–L3 + per-project 覆盖 + extract→analyze 两段式 + 脱敏即数据

> 状态：提议中 · 日期：2026-06-05
> · 扩展 [`adr/0015-standing-local-authorization-prompt-reading.md`](0015-standing-local-authorization-prompt-reading.md)（本人 prompt 长期授权）为可分级模型
> · 沿用 [`adr/0016-error-signals-derived-tool-result-reading.md`](0016-error-signals-derived-tool-result-reading.md) 与 [`adr/0017-derived-non-content-signals.md`](0017-derived-non-content-signals.md) 的「瞬时读 → 只留派生信号、原文绝不留」红线
> · 复用 [`adr/0005-tiered-analysis-and-signals.md`](0005-tiered-analysis-and-signals.md) 的 scope 分层做 per-project 覆盖
> · 依赖 [`adr/0032-episode-abstraction-layer.md`](0032-episode-abstraction-layer.md) 的 E1 episode 抽象与 [`adr/0039-interruption-attribution-cli-structure-skill-semantics.md`](0039-interruption-attribution-cli-structure-skill-semantics.md) 的打断归因来定位证据窗口；该两篇的深挖语义本切片不实现、仅留蓝图占位

## 背景

ccoach 想把分析做深——「打断到底在哪、spiral 区间发生了什么、p90 那次 episode 慢在哪」——这些都要读比现状更多的
原始 transcript。但隐私红线（ADR 0015/0016/0017）必须守住：绝不读 assistant/thinking/system·developer prompt、
绝不外发、写入前一律脱敏 + 截断。**「读更多」与「守红线」的张力，不能靠口头承诺解决**。

现状（ADR 0015）是单一档：本人 prompt 默认读、长期授权，其余内容（assistant 文本、工具调用与结果全量）一概不读。
这把「保守」和「深挖」对立成二选一。本 ADR 的做法是：

1. 把「读到什么」拆成**显式分级 L0–L3**，每级首次启用确认一次，并支持 **per-project 覆盖**（公司 SDK 仓锁死最低档、
   个人 side project 放最高档）；
2. 把数据流强制收敛成**两段式 `extract → analyze`**，中间**落盘成一个可打开看的文件**——让「发给模型的到底是什么」
   从抽象承诺变成磁盘上的产物；
3. 把**脱敏规则当成开源数据**（repo 内独立文件 + fixture），接受公开审计、社区可提 PR。

定位语随之改变：别的工具说 *we don't collect your data*；ccoach 可以说 **you can diff what leaves your machine**。

本切片**不实现** episode/打断的语义深挖本身（依赖 ADR 0032 的 E1 episode 与 ADR 0039 的打断归因），仅落地分级、
两段式与脱敏框架，为「pull 式深挖」预留接口与磁盘契约。

## 决策

### D1 — 隐私分级 L0–L3 + 首次确认 + per-project 覆盖（草案）

四档累进，每档**包含**前一档：

| 级别 | 新增读取 | 与现有 ADR 关系 |
|---|---|---|
| `L0` | 仅元数据 / 结构信号（token、模型、`error_signals`/`rework_signals` 等派生计数与白名单标签） | 默认、即现状下界（ADR 0016/0017） |
| `L1` | + user prompts（本人 prompt，转述 + 脱敏） | 即现有审批流（ADR 0015）的内容面 |
| `L2` | + assistant 文本 | **本 ADR 新开**，超出 0015 红线，须显式升级 |
| `L3` | + 工具调用与结果（全量 stdout/stderr/diff/命令行，仅供脱敏后入证据包） | **本 ADR 新开**，最高档 |

- **每个级别首次启用显式确认一次**（一次性，非每报告弹门，沿用 0015 的「长期授权」精神，但确认粒度细化到 level）。
- **per-project 覆盖**复用 ADR 0005 的 scope 体系：可对单个项目桶锁定上限（如公司 SDK 仓 `lock=L0`）或放开（side project `L3`），
  覆盖优先级高于全局默认。配置形态见 OQ4。
- **每份报告头部打印本次生效级别 + 扫过的 session 数**（可审计行，如 `privacy=L2 (per-project: 3 repos@L0, 5 repos@L3) · scanned 214 sessions`），
  让用户随时知道这次到底读了到哪一档、读了多少。
- L2/L3 仍受全部红线约束：**绝不外发**（默认本地）、写入证据包前一律经 D2 脱敏 + 截断。升档放宽的是「读什么」，
  不是「能不能外发」「能不能存原文」。

### D2 — 脱敏在 CLI 侧、替换优于删除（草案）

- 脱敏**必须发生在 CLI 输出 JSON / 证据包之前**（不是 skill 侧、不是渲染侧）。CLI 是唯一接触原始 transcript 的环节，
  脱敏在此处做才有边界意义（D6）。
- 用成熟 secret 检测正则集（`gitleaks` / `trufflehog` 那套）扫：API key / token、邮箱、IP、含用户名的路径（`/Users/<name>/…`）等。
- **替换优于删除**：命中项替换成**保结构占位符**（`<EMAIL_1>`、`<KEY_2>`、`<PATH_3>`），同一值跨出现保持同一编号，
  这样**不破坏归因分析**（仍能看出「同一个 key 反复出现」「同一路径被反复编辑」），又不泄露真值。
- 另设 **「代码本身敏感」档**：把代码块**整体摘要化**，只留行为描述（如「一段读取 env 并发 HTTP 请求的函数，~40 行」），
  不留源码。该档可全局开，也可作为 D6 的 strict 模式默认。

### D3 — 两段式 `extract → analyze`，中间落盘（草案）

- CLI 把**脱敏后的证据包**写成本地文件：`~/.ccoach/extracts/<DATE>.json`。
- **skill 的硬规则：只允许读这个产物文件，永不直接碰原始 transcript**（不读 `~/.claude/projects/**`、不读 `~/.codex/**`）。
  这条写进 `SKILL.md`（见 D6）。
- 新增 `ccoach extract --preview`：先生成证据包、打印产物路径、让用户过目，**确认后才进入分析**。
- **不把全量对话喂模型**：CLI 先做**结构化预提取**，只把被**结构信号标红的窗口**当证据包递给 skill——
  打断事件包（ADR 0039）、spiral 区间（结构信号）、p90 episode（ADR 0032）。即 **pull 式深挖**：
  先用**免费结构信号**定位「最差的 N 个现场」，再**花 token 做语义勘查**。证据包 = 定位结果 + 对应脱敏窗口，
  而非整本 transcript。
- 证据包 JSON 形态预留：`{ privacy_level, scanned_sessions, redaction_summary, windows: [{ kind, episode_ref, redacted_text }] }`
  （字段名草案，实现时定）。

### D4 — 脱敏自报家门（草案）

- 每次 extract 输出 **`redaction_summary`**，量化本次替换，例如：
  「本次替换 3 个 API key / 14 个邮箱 / 217 条含用户名路径 / 代码块摘要化 6 处」。
  该摘要既打印在终端，也写进证据包头部（可被 skill 转述给用户，但 skill 看不到被替换的真值）。
- 新增 **`--show-redactions`**：**仅本地**显示替换前后对照（`<EMAIL_1> ← alice@corp.com`），供用户自查脱敏是否到位；
  此对照**绝不写入证据包、绝不外发**，是纯本地一次性 stdout。

### D5 — 规则即数据（草案）

- 脱敏正则集放 repo 内**独立成文件**（如 `src/redaction/patterns.*` + 配套 `test/fixtures/redaction/` 样例），
  不藏在代码逻辑里。
- 配 **fixture 测试样例**（输入含真值样本 → 期望脱敏后输出），跑进 vitest，保证规则改动有回归。
- **接受公开审计、社区可提 PR 补 pattern**：漏网的 secret 形态由社区补规则，规则演进可被 diff、可被 review。

### D6 — 诚实边界：可检查 / 可拦截 / 可审计，而非「绝对安全」（草案）

- 诚实前提：**CLI 开源管得住 CLI，管不住 agent**。skill 跑在 agent 进程里，agent 有文件系统权限，
  理论上能绕过 CLI 直接读原始 transcript。本 ADR 不假装能从技术上杜绝这一点。
- 三重补救：
  1. **可审计**：`SKILL.md` 写成**显式禁令**（「只读 `~/.ccoach/extracts/*.json`，禁止直接读 `~/.claude/projects`/`~/.codex`」）。
     违反会体现在工具调用记录里——**违规可被事后审计**。
  2. **可拦截**：随 repo 附**推荐 permission 配置片段**——Claude Code 用 permission `deny` 拦截「直接读 `~/.claude/projects`」、
     只 `allow` ccoach 产物路径；Codex 用 sandbox 做对应文件系统限制。把「别绕过」从约定变成**机器拦截**。
  3. **可检查**：D3 的证据包落盘 + D4 的脱敏摘要，让用户**升级前能 diff**「到底什么离开了我的机器」。
- 话术统一为 **「可检查、可拦截、可审计」**，**不写「绝对安全」**。
- 对高敏感场景提供 **strict 模式**：代码块**全摘要化**（D2 的「代码本身敏感」档默认开），进一步缩小语义面。

## 后果

- **隐私从单档变成可分级**：保守用户停在 L0/L1（与现状等价），愿意深挖的用户显式升 L2/L3，
  且能 per-project 把公司仓锁死——把「深挖 vs 保守」从二选一变成可调旋钮。
- **数据流可见**：证据包落盘 + `--preview` + `redaction_summary` + `--show-redactions`，把「发给模型的是什么」
  做成可打开、可 diff、可量化的产物，支撑「you can diff what leaves your machine」的定位。
- **脱敏可审计、可演进**：规则成文件 + fixture，社区可提 PR；漏网形态有补救路径而非黑箱。
- **边界诚实**：明确「管得住 CLI、管不住 agent」，用禁令 + permission 片段 + 审计三重补救替代虚假的「绝对安全」承诺。
- 实现面新增：`ccoach extract`（+ `--preview`/`--show-redactions`）、`src/redaction/*`（规则 + 脱敏管线，须在 emit JSON 前接入）、
  分级配置与首次确认流、报告头部审计行、`SKILL.md` 禁令、随 repo 的 permission 片段；并补隐私回归断言（证据包不含真值、不落原文）。
- 依赖项未就位：D3 的「标红窗口」依赖 ADR 0032（episode）与 ADR 0039（打断归因）落地，本切片仅留接口与磁盘契约占位，
  深挖语义后续切片接入。

## 开放问题

### OQ1 — 正则覆盖面与漏网的诚实标注
secret 正则集**必然有漏网**（自定义 token 格式、内嵌在代码里的密钥等）。`redaction_summary` 是否应附**置信度 / 覆盖声明**
（如「基于 N 类已知 pattern，可能漏检自定义密钥」），避免用户把「替换了 X 个」误读成「已脱敏干净」？倾向：在摘要末尾固定打一行
诚实免责，并在 D5 文件里维护「已知不覆盖」清单。

### OQ2 — strict 模式粒度
代码块全摘要化会损失归因精度（看不出改了哪几行）。strict 是**全局开关**，还是可 **per-project / per-level** 调（如 L3 仍想看 diff、
但对某仓强制 strict）？摘要由谁生成（CLI 本地确定性摘要 vs 留给 skill）——若留给 skill 则又把源码递了出去，与 D2 矛盾，
故倾向 CLI 侧本地生成行为描述。

### OQ3 — 权限配置片段双端落地
Claude Code 的 permission `deny`/`allow` 语法与 Codex sandbox 的文件系统限制语义不同，两端片段需各自验证**真能拦住**
「直接读原始 transcript」且**不误伤** ccoach 自身。是否随 repo 附一键安装脚本，还是仅给可复制片段 + 文档？两端覆盖度需实测。

### OQ4 — 分级与 per-project 覆盖的 UX
首次确认在哪触发（CLI 交互 vs 配置文件 vs 二者）、per-project 覆盖如何配置（复用 ADR 0005 scope 的项目桶标识）、
锁定（`lock=L0`，禁止被全局默认或命令行临时抬高）如何表达与强制、报告头部审计行的措辞与信息量——均需在实现时定，
避免分级本身变成噪音门。
