# ccoach TS 重构 · Phase 1（CLI 核心）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或
> superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal：** 把 ccoach CLI 用 TypeScript 重写成 npm 包 `@loredunk/ccoach`（bin `ccoach`），自建统一解析层，
一个 pass 从 Claude Code / Codex 的本机 JSONL 抽出「用量 + prompt 信号 + 习惯」，输出 `ccoach --json`，
并用 ccusage 交叉验证数字。

**Architecture：** 分平台适配器（`claude-code` 先做、`codex` 次之）→ 统一数据结构 → 平台无关聚合 →
`--json` / 人读文本两种 emitter。隐私红线贯穿解析层（只读 user prompt 派生数值信号、绝不读 assistant/工具输出）。
ccusage 仅作交叉验证、非运行时依赖。Go 版原地保留作行为基准。

**Tech Stack：** TypeScript（ESM, Node ≥ 18）、cac（CLI）、tsdown（打包）、vitest（测试）、Node 内置 fs/path/readline。

**参考实现（仓库内现成，作为行为基准）：** `internal/codexreport/*.go`（Codex）、
`skills/ai-usage-html-report/scripts/collect_claude_behavior.py`（Claude Code）。移植时以它们为准、保持口径一致。

**全局原则：** DRY、YAGNI、TDD（先红后绿）、频繁提交。每个 Task 结束 = 一次可工作、测试通过的提交。

---

## 文件结构（先锁定边界）

```
package.json                     # @loredunk/ccoach, bin, scripts, devDeps
tsconfig.json
tsdown.config.ts
vitest.config.ts
src/
  cli.ts                         # cac：参数解析 → 调 buildReport → emit
  window.ts                      # 时间窗口解析（--date/--since/--days）
  model.ts                       # 统一数据结构类型 + glossary
  pricing.ts                     # 双平台计价表 + estimateCost
  aggregate.ts                   # 平台无关聚合器 + assemble → Report
  habits.ts                      # git_habits / project_management 派生
  prompt-signals.ts             # user prompt → 数值信号（隐私安全）
  text.ts                        # 文本/路径工具（firstToken/gitSub/ext/repoName/comma）
  emit/
    json.ts                      # Report → JSON
    text.ts                      # Report → 人读文本
  parsers/
    claude-code.ts               # ~/.claude/projects/**/*.jsonl 适配器
    codex.ts                     # ~/.codex/sessions/**/rollout-*.jsonl 适配器（glob 路径）
  index.ts                       # 库导出（buildReport、类型）
test/
  fixtures/
    claude/sample.jsonl
    codex/rollout-sample.jsonl
  *.test.ts
scripts/
  verify-ccusage.ts              # 与 npx ccusage / @ccusage/codex 对账
.github/workflows/ci.ts.yml      # TS lint/test/build + 对账
```

**Phase 1 范围裁剪（YAGNI）：**
- Codex 走 **glob 路径**（`globRollouts` + 解析每个 rollout 的 `session_meta`/`turn_context`），
  **不**移植自定义 sqlite B-tree 读取器（`sqlite.go`）——glob 路径已能产出正确用量，sqlite 元数据增强留后续。
- `codex` 配置扫描（`configscan.go`）、`language.go` 的仓库文件语言推断 **本期保留为最小实现**
  （见 Task 11 说明），不阻塞核心数据流。
- prompt 评级/段位/HTML 不在此计划（留 skill / Phase 2）。

---

## Task 0：项目脚手架

**Files:**
- Create: `package.json`、`tsconfig.json`、`tsdown.config.ts`、`vitest.config.ts`、`.gitignore`（追加 `node_modules`、`dist`）、`src/index.ts`

- [ ] **Step 1：写脚手架文件**

`package.json`：
```json
{
  "name": "@loredunk/ccoach",
  "version": "0.1.0",
  "description": "本机 AI 用量教练：只读分析 Claude Code / Codex 用量与习惯",
  "type": "module",
  "bin": { "ccoach": "./dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsdown",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "verify:ccusage": "tsx scripts/verify-ccusage.ts"
  },
  "devDependencies": {
    "@types/node": "^22",
    "tsdown": "^0.9",
    "tsx": "^4",
    "typescript": "^5.6",
    "vitest": "^2"
  },
  "dependencies": {
    "cac": "^6.7.14"
  }
}
```

`tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "test", "scripts"]
}
```

`tsdown.config.ts`：
```ts
import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  clean: true,
})
```

`vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
```

`src/index.ts`：
```ts
export const VERSION = '0.1.0'
```

- [ ] **Step 2：安装依赖并验证构建**

Run: `npm install && npm run typecheck`
Expected: 无类型错误。

- [ ] **Step 3：提交**

```bash
git add package.json tsconfig.json tsdown.config.ts vitest.config.ts .gitignore src/index.ts package-lock.json
git commit -m "chore(ts): scaffold @loredunk/ccoach (cac/tsdown/vitest, ESM, node>=18)"
```

---

## Task 1：统一数据结构与 glossary（`src/model.ts`）

移植 `report.go:27-186` 的 JSON 形状到 TS 类型，**字段名与现有 `--json` 契约逐一对齐**（snake_case，
因为 emit/json.ts 直接序列化）。glossary 文案沿用 `report.go:83-94`。

**Files:**
- Create: `src/model.ts`、`test/model.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// test/model.test.ts
import { describe, it, expect } from 'vitest'
import { REPORT_GLOSSARY, emptyTokens, type Report } from '../src/model.js'

describe('model', () => {
  it('glossary 含核心口径键且声明仅本机/不含配额', () => {
    expect(REPORT_GLOSSARY._about).toContain('仅本机')
    expect(REPORT_GLOSSARY._about).toContain('rate_limits')
    expect(REPORT_GLOSSARY).toHaveProperty('cache_hit_rate')
    expect(REPORT_GLOSSARY).toHaveProperty('estimated_cost_usd')
  })
  it('emptyTokens 全零', () => {
    expect(emptyTokens()).toEqual({
      input: 0, cached_input: 0, output: 0, reasoning_output: 0,
      cache_creation: 0, total: 0,
    })
  })
})
```

- [ ] **Step 2：运行确认失败**

Run: `npx vitest run test/model.test.ts`
Expected: FAIL（`src/model.js` 不存在）。

- [ ] **Step 3：实现**

`src/model.ts` 定义类型与常量：
```ts
// 统一 token 结构：两平台公共字段 + 平台特有可选并存。
// reasoning_output 主要来自 Codex；cache_creation（缓存写入）主要来自 Claude Code。
export interface Tokens {
  input: number
  cached_input: number       // = Claude 的 cache_read；Codex 的 cached_input
  output: number
  reasoning_output: number    // Codex 专有，Claude 为 0
  cache_creation: number      // Claude 专有（缓存写入），Codex 为 0
  total: number
}
export const emptyTokens = (): Tokens => ({
  input: 0, cached_input: 0, output: 0, reasoning_output: 0, cache_creation: 0, total: 0,
})

export interface CommandCount { command: string; count: number }
export interface UsageReport { name: string; sessions: number; tokens: number }
export interface HourReport { hour: number; tokens: number }
export interface RepoReport {
  repo: string; branches?: string[]; sessions: number; tokens: number
  estimated_cost_usd: number; language?: string
}
export interface PromptSignals {
  prompts: number; avg_len: number; structured_ratio: number
  file_ref_ratio: number; constraint_ratio: number; correction_rate: number
}
export interface GitHabitsReport {
  command_count: number; top_subcommands?: CommandCount[]
  branch_count: number; multi_branch_repos: number
  review_signals?: string[]; risk_signals?: string[]
}
export interface ProjectMgmtReport {
  repos_with_tests: number; repos_with_build_system: number; repos_with_ci: number
  signals?: string[]
}
export interface Report {
  generated_for: string
  timezone: string
  platform: string            // "claude-code" | "codex" | "all"
  source: string              // "glob" | "sqlite"
  sessions: number
  duration_seconds: number
  duration: string
  tokens: Tokens
  cache_hit_rate: number
  reasoning_ratio: number
  estimated_cost_usd: number
  models: string[]
  unpriced_models?: string[]
  tools: { shell_calls: number; web_searches: number; file_changes: number; total_calls: number; top_commands: CommandCount[] }
  repos: RepoReport[]
  hours: HourReport[]
  sources: UsageReport[]
  languages: UsageReport[]
  git_habits: GitHabitsReport
  project_management: ProjectMgmtReport
  prompt_signals: PromptSignals
  rate_limits: null           // 恒 null（配额是账号级，CLI 不输出）
  glossary?: Record<string, string>
}

export const REPORT_GLOSSARY: Record<string, string> = {
  _about: '仅本机数据，不跨机器汇总；不含任何账户级配额百分比（CLI 下 rate_limits 恒为 null）。',
  cache_hit_rate: 'cached_input / input，缓存命中率；越高越省钱（重复上下文被缓存复用）。',
  reasoning_ratio: 'reasoning_output / output，推理 token 占输出的比例；偏高常意味任务被反复推理。',
  estimated_cost_usd: '估算成本，仅供参考、不等于实际账单。算法对齐 ccusage（按各 token 类别 × LiteLLM 参考价）。',
  tokens: 'input/cached_input/output/reasoning_output/cache_creation/total；cached_input 是 input 的子集。',
  prompt_signals: '仅由 user prompt 派生的数值信号（长度/结构化率/文件引用率/约束率/返工率），不含任何原文。',
  git_habits: 'git 子命令频次与评审/风险信号（如只 diff/status 不 commit）。',
  project_management: '各仓库是否有测试/构建/CI 信号。',
  duration: '活跃时长（相邻事件间隔 ≤5 分钟才计入），非墙钟跨度。',
}
```

- [ ] **Step 4：运行确认通过**

Run: `npx vitest run test/model.test.ts`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/model.ts test/model.test.ts
git commit -m "feat(ts): 统一数据结构 + glossary（对齐 --json 契约）"
```

---

## Task 2：时间窗口解析（`src/window.ts`）

移植 `report.go:234-260`（`resolveWindow`）。窗口按**本机时区的本地日期**判定。

**Files:**
- Create: `src/window.ts`、`test/window.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// test/window.test.ts
import { describe, it, expect } from 'vitest'
import { resolveWindow, inLocalRange } from '../src/window.js'

const now = new Date('2026-06-02T10:00:00Z')

describe('resolveWindow', () => {
  it('--date 单日', () => {
    const w = resolveWindow({ date: '2026-05-30' }, now)
    expect(w.desc).toBe('2026-05-30')
    expect(w.fromYmd).toBe('2026-05-30')
    expect(w.toYmd).toBe('2026-05-30')
  })
  it('--days N 含今天', () => {
    const w = resolveWindow({ days: 3 }, now)
    expect(w.fromYmd).toBe('2026-05-31')
    expect(w.toYmd).toBe('2026-06-02')
  })
  it('默认=今天', () => {
    const w = resolveWindow({}, now)
    expect(w.fromYmd).toBe('2026-06-02')
    expect(w.toYmd).toBe('2026-06-02')
  })
  it('--date 非法报错', () => {
    expect(() => resolveWindow({ date: 'nope' }, now)).toThrow(/YYYY-MM-DD/)
  })
})

describe('inLocalRange', () => {
  it('按本地日期边界（含端点）判定', () => {
    const w = resolveWindow({ date: '2026-05-30' }, now)
    expect(inLocalRange(new Date('2026-05-30T23:59:00Z'), w)).toBe(true)
    expect(inLocalRange(new Date('2026-05-31T12:00:00Z'), w)).toBe(false)
  })
})
```

- [ ] **Step 2：运行确认失败**

Run: `npx vitest run test/window.test.ts`
Expected: FAIL。

- [ ] **Step 3：实现**

`src/window.ts`：用本地日期字符串（`YYYY-MM-DD`）做窗口端点，把记录时间戳转本地日期字符串比较，
天然避免时区算术。提供 `localYmd(date)`（用 `Intl.DateTimeFormat` 的本机时区或 `process.env.TZ`）。
```ts
export interface WindowOpts { date?: string; since?: string; days?: number }
export interface Window { fromYmd: string; toYmd: string; desc: string }

const YMD = /^\d{4}-\d{2}-\d{2}$/
export function localYmd(d: Date): string {
  // 'en-CA' 产出 YYYY-MM-DD；不传 timeZone 即用本机时区。
  return new Intl.DateTimeFormat('en-CA').format(d)
}
function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, day] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day + delta))
  return dt.toISOString().slice(0, 10)
}
export function resolveWindow(o: WindowOpts, now: Date): Window {
  const today = localYmd(now)
  if (o.date) {
    if (!YMD.test(o.date)) throw new Error(`invalid --date ${o.date} (want YYYY-MM-DD)`)
    return { fromYmd: o.date, toYmd: o.date, desc: o.date }
  }
  if (o.since) {
    if (!YMD.test(o.since)) throw new Error(`invalid --since ${o.since} (want YYYY-MM-DD)`)
    return { fromYmd: o.since, toYmd: today, desc: `${o.since} 至 ${today}` }
  }
  if (o.days && o.days > 0) {
    const from = addDaysYmd(today, -(o.days - 1))
    return { fromYmd: from, toYmd: today, desc: `最近 ${o.days} 天 (${from} 至 ${today})` }
  }
  return { fromYmd: today, toYmd: today, desc: today }
}
export function inLocalRange(ts: Date, w: Window): boolean {
  const ymd = localYmd(ts)
  return ymd >= w.fromYmd && ymd <= w.toYmd
}
```

- [ ] **Step 4：运行确认通过**（测试用 `TZ=UTC npx vitest run test/window.test.ts` 固定时区）

Run: `TZ=UTC npx vitest run test/window.test.ts`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/window.ts test/window.test.ts
git commit -m "feat(ts): 时间窗口解析（本地日期口径，移植 resolveWindow）"
```

---

## Task 3：文本/路径工具（`src/text.ts`）

移植 `parse.go:496-617`（firstCommand/gitSubcommand/...）与 python `first_token/git_subcommand/ext_of/repo_name`，
以及 `report.go:620` 的 `comma`。**隐私关键**：命令只取首 token、git 只认白名单子命令、文件只取扩展名、repo 只取 basename。

**Files:**
- Create: `src/text.ts`、`test/text.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// test/text.test.ts
import { describe, it, expect } from 'vitest'
import { firstToken, gitSubcommand, extOf, repoName, comma, GIT_SUBCMDS } from '../src/text.js'

describe('text utils（隐私安全）', () => {
  it('firstToken 取可执行名、剥 env 前缀与路径', () => {
    expect(firstToken('FOO=bar /usr/bin/rg -n secret')).toBe('rg')
    expect(firstToken('git commit -m "x"')).toBe('git')
  })
  it('gitSubcommand 只认白名单、未知不泄露', () => {
    expect(gitSubcommand('git commit -m x')).toBe('commit')
    expect(gitSubcommand('git --no-pager diff')).toBe('diff')
    expect(gitSubcommand('git frobnicate-secret')).toBeNull()
    expect(gitSubcommand('rg foo')).toBeNull()
    expect(GIT_SUBCMDS.has('push')).toBe(true)
  })
  it('extOf 只取扩展名', () => {
    expect(extOf('/abs/path/src/main.ts')).toBe('ts')
    expect(extOf('Makefile')).toBe('')
  })
  it('repoName 只取 basename', () => {
    expect(repoName('/Users/x/workspace/ccoach')).toBe('ccoach')
    expect(repoName('')).toBe('(unknown)')
  })
  it('comma 千分位', () => {
    expect(comma(1234567)).toBe('1,234,567')
  })
})
```

- [ ] **Step 2：运行确认失败** — Run: `npx vitest run test/text.test.ts` → FAIL。

- [ ] **Step 3：实现** `src/text.ts`，把 `GIT_SUBCMDS` 白名单按 python `collect_claude_behavior.py:51-58` 列全；
`firstToken`/`gitSubcommand`/`extOf`/`repoName`/`comma` 逻辑分别对照上述 Go/python 实现，逐条保持口径。

- [ ] **Step 4：运行确认通过** — Run: `npx vitest run test/text.test.ts` → PASS。

- [ ] **Step 5：提交**
```bash
git add src/text.ts test/text.test.ts
git commit -m "feat(ts): 文本/路径隐私工具（firstToken/gitSub/ext/repoName/comma）"
```

---

## Task 4：prompt 信号（`src/prompt-signals.ts`）

移植 python `collect_claude_behavior.py:237-279` 的 `prompt_acc`/`prompt_signals` 与正则词表
（`CONSTRAINT_WORDS_*`、`CORRECTION_STARTS_*`、`LIST_RE`、`FILE_REF_RE`、`SECRET_RE`、`_FILE_EXT_GROUP`，
见该文件 88-111 行）。**隐私关键**：只接收 user 文本派生计数，绝不返回/存储原文。

**Files:**
- Create: `src/prompt-signals.ts`、`test/prompt-signals.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// test/prompt-signals.test.ts
import { describe, it, expect } from 'vitest'
import { newPromptAcc, promptAccUpdate, promptSignals } from '../src/prompt-signals.js'

describe('prompt signals（仅数值、无原文）', () => {
  it('结构化/文件引用/约束/返工各计一次', () => {
    const acc = newPromptAcc()
    promptAccUpdate(acc, '请修改 src/main.ts，必须保留现有测试\n- 第一点\n- 第二点')
    promptAccUpdate(acc, 'actually 改回去')
    const s = promptSignals(acc)
    expect(s.prompts).toBe(2)
    expect(s.structured_ratio).toBe(0.5)   // 第一条有列表
    expect(s.file_ref_ratio).toBe(0.5)     // 第一条引用 .ts
    expect(s.constraint_ratio).toBe(0.5)   // “必须”
    expect(s.correction_rate).toBe(0.5)    // “actually”
  })
  it('空 acc 全零', () => {
    expect(promptSignals(newPromptAcc()).prompts).toBe(0)
  })
})
```

- [ ] **Step 2：运行确认失败** — Run: `npx vitest run test/prompt-signals.test.ts` → FAIL。

- [ ] **Step 3：实现** `src/prompt-signals.ts`，把词表/正则与计数逻辑逐条对照 python 实现。
导出 `newPromptAcc()`、`promptAccUpdate(acc, text)`、`promptSignals(acc): PromptSignals`。
比率用 `Math.round(x*1e4)/1e4`（对齐 python `round(...,4)`），`avg_len` 用 `round(...,1)`。

- [ ] **Step 4：运行确认通过** — Run: `npx vitest run test/prompt-signals.test.ts` → PASS。

- [ ] **Step 5：提交**
```bash
git add src/prompt-signals.ts test/prompt-signals.test.ts
git commit -m "feat(ts): prompt 数值信号（移植 collect_claude_behavior，隐私安全）"
```

---

## Task 5：计价（`src/pricing.ts`）

两平台计价表 + `estimateCost`。Codex 部分移植 `pricing.go`（gpt-* 家族，最长前缀匹配，
cached/output 口径见 `estimateCost`）。Claude 部分新增（claude-opus/sonnet/haiku），含 **cache 写入价**
（Claude `cache_creation_input_tokens` 计费高于普通 input）与 **cache 读取价**。
**所有费率最终以 `scripts/verify-ccusage.ts`（Task 11）对账为准**，CI 失败即说明费率漂移需更新。

**Files:**
- Create: `src/pricing.ts`、`test/pricing.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// test/pricing.test.ts
import { describe, it, expect } from 'vitest'
import { estimateCost } from '../src/pricing.js'

describe('estimateCost', () => {
  it('Codex：非缓存输入×输入价 + 缓存×缓存读价 + 输出×输出价', () => {
    // gpt-5.1: input 1.25, cachedInput 0.125, output 10.0（/1e6）
    const c = estimateCost({ input: 1_000_000, cached_input: 0, output: 1_000_000,
      reasoning_output: 0, cache_creation: 0, total: 2_000_000 }, 'gpt-5.1')
    expect(c.priced).toBe(true)
    expect(c.usd).toBeCloseTo(1.25 + 10.0, 6)
  })
  it('Claude：cache_creation 用写入价、cache_read 用读取价', () => {
    const c = estimateCost({ input: 1_000_000, cached_input: 1_000_000, output: 0,
      reasoning_output: 0, cache_creation: 1_000_000, total: 3_000_000 }, 'claude-opus-4-8')
    expect(c.priced).toBe(true)
    expect(c.usd).toBeGreaterThan(0)
  })
  it('未知模型 priced=false、usd=0', () => {
    expect(estimateCost({ input: 100, cached_input: 0, output: 0, reasoning_output: 0,
      cache_creation: 0, total: 100 }, 'mystery')).toEqual({ usd: 0, priced: false })
  })
})
```

- [ ] **Step 2：运行确认失败** — Run: `npx vitest run test/pricing.test.ts` → FAIL。

- [ ] **Step 3：实现** `src/pricing.ts`：
  - `interface Price { input; cachedInput; output; cacheCreation? }`（每百万 token，USD）。
  - Codex 表逐条照搬 `pricing.go:33-46`；`normalizeModel` 照搬 `pricing.go:50-60`。
  - Claude 表用当下 LiteLLM 口径填 claude-opus/sonnet/haiku 的 input/output/cache_read/cache_creation 费率
    （以 ccusage 对账为准）。匹配同样用最长前缀。
  - `estimateCost(tokens, model)`：
    ```ts
    const nonCached = input - min(cached_input, input)
    usd = nonCached*input/1e6 + cached_input*cachedInput/1e6
        + output*output/1e6 + cache_creation*(cacheCreation ?? input)/1e6
    ```
    （Codex 无 cache_creation→该项为 0；输出已含 reasoning，不另计。）
  - 导出 `normalizeModel`、`estimateCost(): { usd: number; priced: boolean }`。

- [ ] **Step 4：运行确认通过** — Run: `npx vitest run test/pricing.test.ts` → PASS。

- [ ] **Step 5：提交**
```bash
git add src/pricing.ts test/pricing.test.ts
git commit -m "feat(ts): 双平台计价（Codex 移植 pricing.go + Claude 缓存写入/读取价）"
```

---

## Task 6：聚合器（`src/aggregate.ts`）

平台无关聚合：适配器把每条「事件」喂进来，聚合器累计 tokens/cost/tools/repos/hours/sources/languages/
prompt + 活跃时长。移植 `parse.go:58-122`（aggregate 结构）、`parse.go:318-440`（apply*）、
`report.go:262-326`（assemble）、`humanizeDuration`（425-435）、活跃时长 idleCap=5min（parse.go:314-316）。

**Files:**
- Create: `src/aggregate.ts`、`test/aggregate.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// test/aggregate.test.ts
import { describe, it, expect } from 'vitest'
import { Aggregator } from '../src/aggregate.js'

describe('Aggregator', () => {
  it('累计 token/成本、派生 cache_hit_rate，assemble 出 Report', () => {
    const agg = new Aggregator('claude-code')
    const t = new Date('2026-06-02T03:00:00Z')
    agg.applyTokens({ input: 100, cached_input: 40, output: 50, reasoning_output: 0,
      cache_creation: 0, total: 150 }, 'claude-opus-4-8', 'ccoach', 's1', t)
    agg.touchSession('s1')
    const r = agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
    expect(r.tokens.input).toBe(100)
    expect(r.tokens.total).toBe(150)
    expect(r.cache_hit_rate).toBeCloseTo(0.4, 6)
    expect(r.sessions).toBe(1)
    expect(r.repos[0].repo).toBe('ccoach')
    expect(r.estimated_cost_usd).toBeGreaterThan(0)
    expect(r.rate_limits).toBeNull()
    expect(r.glossary?._about).toContain('仅本机')
  })
  it('活跃时长只累计 ≤5min 的相邻间隔', () => {
    const agg = new Aggregator('codex')
    const base = new Date('2026-06-02T03:00:00Z')
    const d = { input: 1, cached_input: 0, output: 1, reasoning_output: 0, cache_creation: 0, total: 2 }
    agg.markActive(base)
    agg.markActive(new Date(base.getTime() + 2*60*1000))   // +2min → 计入
    agg.markActive(new Date(base.getTime() + 60*60*1000))  // +60min → 不计
    expect(agg.durationSeconds()).toBe(120)
  })
})
```

- [ ] **Step 2：运行确认失败** — Run: `npx vitest run test/aggregate.test.ts` → FAIL。

- [ ] **Step 3：实现** `src/aggregate.ts`：`class Aggregator`，内部 Map 累计，方法：
  `applyTokens(tokens, model, repo, session, ts)`、`applyTool(kind, command?)`、
  `applyFileChangeExt(repo, ext)`、`applyUsageSource(name, tokens, session)`、
  `applyLanguage(name, tokens, session)`、`touchSession(id)`、`markActive(ts)`、
  `durationSeconds()`、`assemble(window, source): Report`。
  cost 用 `estimateCost`；模型经 `normalizeModel` 收集到 `models`/`unpriced_models`；
  `cache_hit_rate=cached_input/input`，`reasoning_ratio=reasoning_output/output`；
  repos 按 tokens 降序、sources/languages 同 `usageReports` 排序（report.go:360-376）。
  git_habits/project_management 调 Task 7 的函数。

- [ ] **Step 4：运行确认通过** — Run: `npx vitest run test/aggregate.test.ts` → PASS。

- [ ] **Step 5：提交**
```bash
git add src/aggregate.ts test/aggregate.test.ts
git commit -m "feat(ts): 平台无关聚合器 + assemble（移植 parse/report 聚合逻辑）"
```

---

## Task 7：习惯派生（`src/habits.ts`）

移植 `habits.go`（git_habits 的 review/risk 信号、多分支统计）与 project_management 派生
（`report.go:buildProjectMgmt` + `habits.go`）。本期只需 tools/git/test-build 信号即可。

**Files:**
- Create: `src/habits.ts`、`test/habits.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// test/habits.test.ts
import { describe, it, expect } from 'vitest'
import { buildGitHabits, buildProjectMgmt } from '../src/habits.js'

describe('habits', () => {
  it('只 diff/status 不 commit → 风险信号', () => {
    const g = buildGitHabits({ status: 5, diff: 4 }, /*branchCount*/2, /*multiBranchRepos*/1)
    expect(g.command_count).toBe(9)
    expect(g.risk_signals?.some(s => s.includes('commit'))).toBe(true)
  })
  it('有 commit + push → 评审/正常信号，无该风险', () => {
    const g = buildGitHabits({ commit: 3, push: 2, diff: 1 }, 1, 0)
    expect(g.risk_signals ?? []).not.toContainEqual(expect.stringContaining('只'))
  })
  it('project mgmt 统计含测试/构建的仓库数', () => {
    const p = buildProjectMgmt([
      { repo: 'a', sessions: 1, tokens: 1, estimated_cost_usd: 0, hasTests: true, hasBuild: true },
      { repo: 'b', sessions: 1, tokens: 1, estimated_cost_usd: 0, hasTests: false, hasBuild: true },
    ] as any)
    expect(p.repos_with_tests).toBe(1)
    expect(p.repos_with_build_system).toBe(2)
  })
})
```

- [ ] **Step 2：运行确认失败** — Run: `npx vitest run test/habits.test.ts` → FAIL。

- [ ] **Step 3：实现** `src/habits.ts`：`buildGitHabits(gitCommands, branchCount, multiBranchRepos)` 与
`buildProjectMgmt(repos)`，信号文案与阈值对照 `habits.go`。risk「只 diff/status 不 commit」=
有 diff/status 但 commit 计数为 0。

- [ ] **Step 4：运行确认通过** — Run: `npx vitest run test/habits.test.ts` → PASS。

- [ ] **Step 5：提交**
```bash
git add src/habits.ts test/habits.test.ts
git commit -m "feat(ts): 习惯派生 git_habits/project_management（移植 habits.go）"
```

---

## Task 8：Claude Code 适配器（`src/parsers/claude-code.ts`）

读 `~/.claude/projects/**/*.jsonl`，逐行解析，喂聚合器。记录类型与字段见本计划开头的实测结构。
**隐私**：user 文本只经 `promptAccUpdate` 派生信号（仅 `content` 里 `type==='text'` 块或纯字符串，
忽略 tool_result/image）；assistant 只读 `message.usage`，绝不读其文本。`isSidechain===true` 跳过（subagent）。

token 口径（对齐 ccusage Claude）：每条 assistant `message.usage` →
`input=input_tokens`、`cached_input=cache_read_input_tokens`、`output=output_tokens`、
`cache_creation=cache_creation_input_tokens`、`total=input+output+cache_read+cache_creation`、`reasoning_output=0`。
模型取 `message.model`。repo 取 `cwd` 的 basename。工具调用从 assistant `message.content` 里 `type==='tool_use'` 统计
（Bash→shell + firstToken/gitSub；WebFetch/WebSearch→web；Edit/Write/Read/NotebookEdit→file + extOf(input.file_path)）。

**Files:**
- Create: `src/parsers/claude-code.ts`、`test/fixtures/claude/sample.jsonl`、`test/claude-code.test.ts`

- [ ] **Step 1：造 fixture（合成、无敏感内容）**

`test/fixtures/claude/sample.jsonl`（每行一条 JSON；时间戳落在 2026-06-02）：
```
{"type":"user","sessionId":"s1","cwd":"/home/u/work/ccoach","gitBranch":"main","timestamp":"2026-06-02T03:00:00.000Z","isSidechain":false,"message":{"role":"user","content":[{"type":"text","text":"请改 src/main.ts，必须保留测试\n- a\n- b"}]}}
{"type":"assistant","sessionId":"s1","cwd":"/home/u/work/ccoach","gitBranch":"main","timestamp":"2026-06-02T03:00:05.000Z","isSidechain":false,"message":{"role":"assistant","model":"claude-opus-4-8","content":[{"type":"tool_use","name":"Bash","input":{"command":"git commit -m x"}},{"type":"tool_use","name":"Edit","input":{"file_path":"src/main.ts"}}],"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":40,"cache_creation_input_tokens":10}}}
{"type":"assistant","sessionId":"sidechain","cwd":"/home/u/work/ccoach","timestamp":"2026-06-02T03:00:06.000Z","isSidechain":true,"message":{"role":"assistant","model":"claude-opus-4-8","content":[],"usage":{"input_tokens":9999,"output_tokens":9999}}}
{"type":"assistant","sessionId":"s1","cwd":"/home/u/work/ccoach","timestamp":"2026-05-01T03:00:00.000Z","isSidechain":false,"message":{"role":"assistant","model":"claude-opus-4-8","content":[],"usage":{"input_tokens":777,"output_tokens":777}}}
```

- [ ] **Step 2：写失败测试**

```ts
// test/claude-code.test.ts
import { describe, it, expect } from 'vitest'
import { parseClaudeCode } from '../src/parsers/claude-code.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('parseClaudeCode', () => {
  it('解析窗口内用量、跳过 sidechain 与窗口外记录', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.tokens.input).toBe(100)        // 不含 sidechain 9999、不含 5/1 的 777
    expect(r.tokens.cached_input).toBe(40)
    expect(r.tokens.cache_creation).toBe(10)
    expect(r.tokens.output).toBe(50)
    expect(r.sessions).toBe(1)
    expect(r.repos[0].repo).toBe('ccoach')
    expect(r.models).toContain('claude-opus-4-8')
  })
  it('工具与 git 习惯', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.tools.shell_calls).toBe(1)
    expect(r.tools.file_changes).toBe(1)
    expect(r.git_habits.command_count).toBe(1)
    expect(r.git_habits.top_subcommands?.[0]).toEqual({ command: 'commit', count: 1 })
  })
  it('prompt 信号仅数值、JSON 不含原文', () => {
    const r = parseClaudeCode('test/fixtures/claude', window)
    expect(r.prompt_signals.prompts).toBe(1)
    expect(r.prompt_signals.constraint_ratio).toBe(1)
    expect(JSON.stringify(r)).not.toContain('保留测试')
  })
})
```

- [ ] **Step 3：运行确认失败** — Run: `TZ=UTC npx vitest run test/claude-code.test.ts` → FAIL。

- [ ] **Step 4：实现** `src/parsers/claude-code.ts`：
  - `claudeProjectsDir()`：`$CLAUDE_CONFIG_DIR/projects` 或 `~/.claude/projects`。
  - `parseClaudeCode(dir, window): Report`：递归 `*.jsonl`，逐行 `JSON.parse`（坏行跳过），
    `inLocalRange(new Date(timestamp), window)` 过滤；按上面口径喂 `Aggregator('claude-code')`，
    `assemble(window, 'glob')` 返回。用 Node `readline` 流式读，避免大文件一次性载入。
  - 严格隐私：user 文本经 `user_text` 同款抽取（python 214-234）后只交给 `promptAccUpdate`。

- [ ] **Step 5：运行确认通过** — Run: `TZ=UTC npx vitest run test/claude-code.test.ts` → PASS。

- [ ] **Step 6：提交**
```bash
git add src/parsers/claude-code.ts test/fixtures/claude/sample.jsonl test/claude-code.test.ts
git commit -m "feat(ts): Claude Code 适配器（用量+工具+git+prompt信号，隐私安全）"
```

---

## Task 9：Codex 适配器（`src/parsers/codex.ts`，glob 路径）

移植 `parse.go:140-312`（parseThread）+ `discover.go:globRollouts`（206-231）+ `loadThreadsForRange` 的 glob 分支。
**不**移植 sqlite。token 口径严格按 `parse.go:211-259`：优先 `info.last_token_usage`，缺失时对
`info.total_token_usage` 求 saturating 增量（基线 0）；`info==null` 跳过；`cached_input` 钳制 ≤ `input`；
空增量跳过；窗口过滤在增量计算之后。模型取 `turn_context.model`（curModel），repo 取 `session_meta.cwd` basename，
subagent（session_meta payload 含 `subagent`/`thread_spawn`）整文件跳过。

**Files:**
- Create: `src/parsers/codex.ts`、`test/fixtures/codex/rollout-sample.jsonl`、`test/codex.test.ts`

- [ ] **Step 1：造 fixture**

`test/fixtures/codex/sessions/2026/06/02/rollout-sample.jsonl`：
```
{"timestamp":"2026-06-02T03:00:00.000Z","type":"session_meta","payload":{"id":"c1","cwd":"/home/u/work/ccoach","source":"cli"}}
{"timestamp":"2026-06-02T03:00:01.000Z","type":"turn_context","payload":{"model":"gpt-5.1"}}
{"timestamp":"2026-06-02T03:00:02.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":50,"reasoning_output_tokens":10,"total_tokens":150}}}}
{"timestamp":"2026-06-02T03:00:03.000Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"cmd\":\"git status\"}"}}
```
（另建 `.../rollout-subagent.jsonl` 第一行 `session_meta.payload` 含 `"subagent"`，断言被整文件跳过。）

- [ ] **Step 2：写失败测试**

```ts
// test/codex.test.ts
import { describe, it, expect } from 'vitest'
import { parseCodex } from '../src/parsers/codex.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('parseCodex（glob）', () => {
  it('用 last_token_usage 累计、识别模型与 repo', () => {
    const r = parseCodex('test/fixtures/codex', window)
    expect(r.tokens.input).toBe(100)
    expect(r.tokens.cached_input).toBe(40)
    expect(r.tokens.reasoning_output).toBe(10)
    expect(r.tokens.total).toBe(150)
    expect(r.models).toContain('gpt-5.1')
    expect(r.repos[0].repo).toBe('ccoach')
    expect(r.git_habits.top_subcommands?.[0]).toEqual({ command: 'status', count: 1 })
  })
  it('跳过 subagent 文件', () => {
    const r = parseCodex('test/fixtures/codex', window)
    expect(r.tokens.input).toBe(100) // subagent 的用量未计入
  })
})
```

- [ ] **Step 3：运行确认失败** — Run: `TZ=UTC npx vitest run test/codex.test.ts` → FAIL。

- [ ] **Step 4：实现** `src/parsers/codex.ts`：
  - `codexHome()`：`$CODEX_HOME` 或 `~/.codex`。
  - `globRollouts(home)`：walk `home/sessions`，收 `rollout-*.jsonl`。
  - `parseCodex(home, window): Report`：对每个 rollout 流式逐行解析，按 `parse.go` 的状态机
    （prevTotal、satSub、curModel、threadTouched、prevActive/idleCap）喂 `Aggregator('codex')`，
    `assemble(window, 'glob')`。`satSub`/钳制/空增量/窗口过滤顺序严格照搬。
  - response_item 工具计数照 `parse.go:279-305`。

- [ ] **Step 5：运行确认通过** — Run: `TZ=UTC npx vitest run test/codex.test.ts` → PASS。

- [ ] **Step 6：提交**
```bash
git add src/parsers/codex.ts test/fixtures/codex test/codex.test.ts
git commit -m "feat(ts): Codex 适配器 glob 路径（移植 parseThread token 口径）"
```

---

## Task 10：emitters（`src/emit/json.ts` + `src/emit/text.ts`）

**Files:**
- Create: `src/emit/json.ts`、`src/emit/text.ts`、`test/emit.test.ts`

- [ ] **Step 1：写失败测试**

```ts
// test/emit.test.ts
import { describe, it, expect } from 'vitest'
import { emitJson } from '../src/emit/json.js'
import { emitText } from '../src/emit/text.js'
import { Aggregator } from '../src/aggregate.js'

function sample() {
  const agg = new Aggregator('claude-code')
  agg.applyTokens({ input: 100, cached_input: 40, output: 50, reasoning_output: 0,
    cache_creation: 10, total: 200 }, 'claude-opus-4-8', 'ccoach', 's1', new Date('2026-06-02T03:00:00Z'))
  agg.touchSession('s1')
  return agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
}

describe('emit', () => {
  it('JSON 含 glossary 与 rate_limits:null，可解析', () => {
    const out = emitJson(sample())
    const parsed = JSON.parse(out)
    expect(parsed.rate_limits).toBeNull()
    expect(parsed.glossary._about).toContain('仅本机')
    expect(parsed.tokens.total).toBe(200)
  })
  it('文本含 token 行与“仅本机”声明', () => {
    const out = emitText(sample(), false)
    expect(out).toContain('仅本机')
    expect(out).toContain('total')
  })
})
```

- [ ] **Step 2：运行确认失败** — Run: `TZ=UTC npx vitest run test/emit.test.ts` → FAIL。

- [ ] **Step 3：实现** `emitJson(report)` = `JSON.stringify(report, null, 2)`；
`emitText(report, byRepo)` 移植 `report.go:437-538` 的人读排版（token/工具/来源/语言/习惯/仓库/时段），空态护栏照 444-448。

- [ ] **Step 4：运行确认通过** — Run: `TZ=UTC npx vitest run test/emit.test.ts` → PASS。

- [ ] **Step 5：提交**
```bash
git add src/emit test/emit.test.ts
git commit -m "feat(ts): JSON/文本 emitter（移植 renderText 排版）"
```

---

## Task 11：CLI 装配（`src/cli.ts` + `src/index.ts`）

cac 装配命令与选项：`--date / --since / --days / --by-repo / --json / --platform <claude-code|codex|all>`。
`--platform all`（默认）分别跑两适配器、合并到一份 `platform:"all"` 的报告（tokens/tools/... 相加，
models/sources 合并，repos 合并同名）。`buildReport(opts)` 放 `src/index.ts` 作库导出。

**Files:**
- Create: `src/cli.ts`、`test/cli.test.ts`；Modify: `src/index.ts`

- [ ] **Step 1：写失败测试**

```ts
// test/cli.test.ts
import { describe, it, expect } from 'vitest'
import { buildReport } from '../src/index.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('buildReport', () => {
  it('platform=all 合并两平台 token', () => {
    const r = buildReport({ platform: 'all', window,
      claudeDir: 'test/fixtures/claude', codexHome: 'test/fixtures/codex' })
    expect(r.platform).toBe('all')
    expect(r.tokens.input).toBe(200) // claude 100 + codex 100
    expect(r.models).toEqual(expect.arrayContaining(['claude-opus-4-8', 'gpt-5.1']))
  })
  it('platform=claude-code 只含 Claude', () => {
    const r = buildReport({ platform: 'claude-code', window, claudeDir: 'test/fixtures/claude' })
    expect(r.tokens.input).toBe(100)
  })
})
```

- [ ] **Step 2：运行确认失败** — Run: `TZ=UTC npx vitest run test/cli.test.ts` → FAIL。

- [ ] **Step 3：实现**
  - `src/index.ts`：导出 `buildReport({platform, window, claudeDir?, codexHome?}): Report`，
    内部调 `parseClaudeCode` / `parseCodex`，`all` 时调 `mergeReports([...])`（合并函数也放此处，
    tokens 逐字段相加、重算 cache_hit_rate/reasoning_ratio、cost 相加、models/sources/languages/repos 按名合并、
    git/project 合并计数、prompt_signals 按 prompts 加权合并）。
  - `src/cli.ts`：cac 定义、`#!/usr/bin/env node` shebang、解析 → `resolveWindow(opts, new Date())` →
    `buildReport` → `opts.json ? emitJson : emitText`；错误打到 stderr、退出码 1。

- [ ] **Step 4：运行确认通过** — Run: `TZ=UTC npx vitest run test/cli.test.ts` → PASS。

- [ ] **Step 5：端到端冒烟**

Run: `npm run build && node dist/cli.js --json --days 7`
Expected: 输出合法 JSON，含 `tokens`、`glossary`、`rate_limits:null`（本机有数据时非零）。

- [ ] **Step 6：提交**
```bash
git add src/cli.ts src/index.ts test/cli.test.ts
git commit -m "feat(ts): CLI 装配（cac + platform 合并 + --json/--text）"
```

---

## Task 12：ccusage 交叉验证（`scripts/verify-ccusage.ts`）

对账：跑 `npx ccusage@latest --json`（Claude Code）与 `npx @ccusage/codex@latest --json`（Codex），
取同一时间窗口的 token/成本，与 ccoach 自算逐项 diff，超容差非零退出。ccusage **不进 dependencies**。

**Files:**
- Create: `scripts/verify-ccusage.ts`、`test/verify-tolerance.test.ts`

- [ ] **Step 1：写失败测试（纯比较逻辑，可离线测）**

```ts
// test/verify-tolerance.test.ts
import { describe, it, expect } from 'vitest'
import { withinTolerance } from '../scripts/verify-ccusage.js'

describe('withinTolerance', () => {
  it('token 必须完全相等', () => {
    expect(withinTolerance({ tokens: 100, cost: 1.0 }, { tokens: 100, cost: 1.0 })).toBe(true)
    expect(withinTolerance({ tokens: 100, cost: 1.0 }, { tokens: 101, cost: 1.0 })).toBe(false)
  })
  it('成本允许 1% 相对误差（费率表/四舍五入差异）', () => {
    expect(withinTolerance({ tokens: 100, cost: 1.000 }, { tokens: 100, cost: 1.005 })).toBe(true)
    expect(withinTolerance({ tokens: 100, cost: 1.000 }, { tokens: 100, cost: 1.2 })).toBe(false)
  })
})
```

- [ ] **Step 2：运行确认失败** — Run: `npx vitest run test/verify-tolerance.test.ts` → FAIL。

- [ ] **Step 3：实现** `scripts/verify-ccusage.ts`：
  - 导出 `withinTolerance(ours, theirs)`：token 严格相等、cost 相对误差 ≤1%。
  - `main()`：用 `node:child_process` 跑两个 ccusage CLI（`--json`，传与本机一致的窗口），
    解析其总 token/cost；调 `buildReport` 取 ccoach 数字；逐平台 `withinTolerance`，
    打印对照表，任一不过则 `process.exit(1)`。无网络/未安装 ccusage 时打印 SKIP 并 `exit 0`
    （CI 在线时才强校验）。

- [ ] **Step 4：运行确认通过** — Run: `npx vitest run test/verify-tolerance.test.ts` → PASS。

- [ ] **Step 5：本机手动对账（有数据时）**

Run: `npm run verify:ccusage`
Expected: 打印 ccoach vs ccusage 对照，token 相等、cost 在容差内（或在无 ccusage 时 SKIP）。

- [ ] **Step 6：提交**
```bash
git add scripts/verify-ccusage.ts test/verify-tolerance.test.ts
git commit -m "feat(ts): ccusage 交叉验证脚本（token 严等/cost 1% 容差，非运行时依赖）"
```

---

## Task 13：隐私回归测试 + CI

**Files:**
- Create: `test/privacy.test.ts`、`.github/workflows/ci.ts.yml`

- [ ] **Step 1：写隐私回归测试**

```ts
// test/privacy.test.ts
import { describe, it, expect } from 'vitest'
import { buildReport } from '../src/index.js'

const window = { fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }

describe('隐私红线', () => {
  const out = JSON.stringify(buildReport({ platform: 'all', window,
    claudeDir: 'test/fixtures/claude', codexHome: 'test/fixtures/codex' }))
  it('不含 prompt 原文', () => {
    expect(out).not.toContain('保留测试')
  })
  it('不含绝对路径，只含 basename', () => {
    expect(out).not.toContain('/home/u/work')
    expect(out).toContain('ccoach')
  })
  it('不含密钥样式 / 完整命令行', () => {
    expect(out).not.toMatch(/sk-[A-Za-z0-9]{6,}/)
    expect(out).not.toContain('commit -m') // 命令只留首 token/git 子命令
  })
  it('rate_limits 恒 null', () => {
    expect(JSON.parse(out).rate_limits).toBeNull()
  })
})
```

- [ ] **Step 2：运行确认通过**

Run: `TZ=UTC npx vitest run test/privacy.test.ts`
Expected: PASS（若红，说明适配器泄露，必须修适配器而非改断言）。

- [ ] **Step 3：写 CI**

`.github/workflows/ci.ts.yml`：
```yaml
name: ts-ci
on: [push, pull_request]
jobs:
  ts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm run verify:ccusage   # 在线时强校验，离线 SKIP
```

- [ ] **Step 4：本地全绿**

Run: `npm run typecheck && TZ=UTC npm test && npm run build`
Expected: 全 PASS、构建产出 `dist/cli.js`。

- [ ] **Step 5：提交**
```bash
git add test/privacy.test.ts .github/workflows/ci.ts.yml
git commit -m "test(ts): 隐私回归 + TS CI（typecheck/test/build/ccusage 对账）"
```

---

## Task 14：文档同步

**Files:**
- Modify: `README.md`、`README_CN.md`、`docs/TODO.md`、`CLAUDE.md`

- [ ] **Step 1：改 README 安装段**为 `npx @loredunk/ccoach` / `npm i -g @loredunk/ccoach`，
  双平台措辞，标注成本为估算、仅本机、不含配额。

- [ ] **Step 2：TODO** 新增 Phase 1 任务块并勾选完成项；标注 Codex sqlite 路径、language/config 扫描为后续。

- [ ] **Step 3：CLAUDE.md** 仓库布局补 `src/` 结构；「架构方向」标注 Phase 1 已落地（CLI 核心 TS）。

- [ ] **Step 4：提交**
```bash
git add README.md README_CN.md docs/TODO.md CLAUDE.md
git commit -m "docs: TS CLI Phase 1 落地，安装改 npx @loredunk/ccoach，布局同步"
```

---

## Self-Review（计划 vs spec 覆盖）

- spec §Phase1「统一解析层一个 pass」→ Task 6/8/9。
- spec「双平台适配器，Claude 优先」→ Task 8（先）/ Task 9。
- spec「--json 契约不破」→ Task 1（类型对齐）+ Task 10（emit）+ Task 13（rate_limits/glossary 断言）。
- spec「习惯分析」→ Task 7 + 适配器内 tools/git/language 统计。
- spec「prompt_signals 仅数值」→ Task 4 + Task 8 + Task 13。
- spec「ccusage 对账一等」→ Task 12 + CI。
- spec「隐私红线」→ Task 3/4 工具 + Task 8/9 解析约束 + Task 13 回归。
- spec「选型 cac/tsdown/vitest/ESM/node18」→ Task 0。
- spec「Go 原地保留」→ 不动 cmd/internal；新代码全在 src/。
- **已知裁剪（spec §范围裁剪一致）**：Codex sqlite 元数据、language.go 文件语言推断、configscan.go 在 Phase 1 用 glob/最小实现，后续补。

## 执行说明

Codex/Claude 端口任务（Task 8/9）以仓库内 Go/python 为行为基准：实现后除单测外，
**务必跑 `npm run verify:ccusage` 与现有 `go run ./cmd/ccoach --json` 对照**，数字不一致优先怀疑 TS 适配器。
