// ccusage 交叉验证：把 ccoach 自算的 token/成本与 npx ccusage / @ccusage/codex 对账。
// ccusage 仅作验证、不作运行时依赖（这里通过 npx 临时拉取，不进 dependencies）。
// 在线时强校验；离线/未安装时打印 SKIP 并以 0 退出（CI 在线时才强制对齐）。
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolveWindow } from '../src/window.js'
import { buildReport, type Platform } from '../src/index.js'

export interface Measure { tokens: number; cost: number }

// token 必须完全相等；成本允许 1% 相对误差（费率表/四舍五入差异）。
export function withinTolerance(ours: Measure, theirs: Measure): boolean {
  if (ours.tokens !== theirs.tokens) return false
  const denom = Math.max(Math.abs(theirs.cost), 1e-9)
  return Math.abs(ours.cost - theirs.cost) / denom <= 0.01
}

function runCcusage(pkg: string, args: string[]): unknown | null {
  try {
    const out = execFileSync('npx', ['-y', pkg, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 180_000,
    })
    return JSON.parse(out)
  } catch {
    return null
  }
}

// 从 ccusage --json 提取总 token / 总成本（容忍跨版本的字段形状）。
function ccusageTotals(j: unknown): Measure | null {
  if (!j || typeof j !== 'object') return null
  const obj = j as Record<string, unknown>
  const pick = (o: unknown): Measure | null => {
    if (!o || typeof o !== 'object') return null
    const r = o as Record<string, unknown>
    const cost = Number(r.totalCost ?? r.cost ?? NaN)
    const tokens = Number(r.totalTokens ?? r.tokens ?? NaN)
    return Number.isFinite(cost) && Number.isFinite(tokens) ? { tokens, cost } : null
  }
  const fromTotals = pick(obj.totals)
  if (fromTotals) return fromTotals
  const daily = Array.isArray(obj.daily) ? obj.daily : null
  if (daily && daily.length > 0) {
    let tokens = 0
    let cost = 0
    for (const d of daily) {
      const row = d as Record<string, unknown>
      const tk = Number(row.totalTokens ?? NaN)
      const c = Number(row.totalCost ?? NaN)
      // 任一行不完整就放弃整段累加（返回 null → 上层 SKIP），绝不拿部分和去做"严格相等"比较。
      if (!Number.isFinite(tk) || !Number.isFinite(c)) return null
      tokens += tk
      cost += c
    }
    return { tokens, cost }
  }
  return null
}

function ours(platform: Platform): Measure {
  // 用很宽的窗口覆盖"全部历史"，与 ccusage 默认全量对齐。
  const window = resolveWindow({ since: '2020-01-01' }, new Date())
  const r = buildReport({ platform, window })
  return { tokens: r.tokens.total, cost: r.estimated_cost_usd }
}

function main(): void {
  const checks: { name: string; pkg: string; platform: Platform }[] = [
    { name: 'Claude Code', pkg: 'ccusage@latest', platform: 'claude-code' },
    { name: 'Codex', pkg: '@ccusage/codex@latest', platform: 'codex' },
  ]
  let anyChecked = false
  let failed = false
  for (const c of checks) {
    const raw = runCcusage(c.pkg, ['--json'])
    if (!raw) {
      console.log(`[SKIP] ${c.name}: ${c.pkg} 不可用（离线或未安装）`)
      continue
    }
    const theirs = ccusageTotals(raw)
    if (!theirs) {
      console.log(`[SKIP] ${c.name}: 无法解析 ${c.pkg} 输出`)
      continue
    }
    const mine = ours(c.platform)
    anyChecked = true
    const pass = withinTolerance(mine, theirs)
    if (!pass) failed = true
    console.log(
      `[${pass ? 'OK' : 'FAIL'}] ${c.name}: ccoach tokens=${mine.tokens} cost=$${mine.cost.toFixed(4)} | ` +
        `ccusage tokens=${theirs.tokens} cost=$${theirs.cost.toFixed(4)}`,
    )
  }
  if (!anyChecked) {
    console.log('[SKIP] 没有可对账的平台（ccusage 不可用）——视为通过。')
    process.exit(0)
  }
  process.exit(failed ? 1 : 0)
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
