import { type Tokens } from './model.js'

// 每百万 token 费率（USD）。cacheCreation 仅 Claude 家族有：它的存在同时表示
// “该家族的 input/cached_input/cache_creation 是互斥桶”（disjoint），据此切换计费口径。
export interface Price {
  input: number
  cachedInput: number   // 缓存读取价（per-million USD）
  output: number        // 已含 reasoning（两平台 output 都把 reasoning 计入）
  cacheCreation?: number // 仅 Claude：缓存写入价；存在=>disjoint 口径
}

// ⚠️ 这是 CLI 的**可选离线 fallback 价表**，非权威来源。权威成本由 skill 层按报告里
// 实际出现的模型名联网查询官方定价后计算（apply_pricing.mjs，ADR 0019）；本表仅在未联网
// 查价时给一个 best-effort 估算（CLI 单独离线跑、或某模型查不到官方价时兜底）。
// 模型会更新，本表难免滞后——别把它当账单依据。
// 最长前缀匹配；更具体的 key（如 gpt-5.1-codex-mini）胜过家族默认（gpt-5）。USD / 1e6 token。
// 较旧的 claude-3-* 家族故意不列（会被报告为未计价 / unpriced，交给 skill 层联网查）。
const priceTable: { prefix: string; p: Price }[] = [
  { prefix: 'gpt-5.5', p: { input: 5.0, cachedInput: 0.5, output: 30.0 } },
  { prefix: 'gpt-5.4-mini', p: { input: 0.75, cachedInput: 0.075, output: 4.5 } },
  { prefix: 'gpt-5.4-nano', p: { input: 0.20, cachedInput: 0.02, output: 1.25 } },
  { prefix: 'gpt-5.4', p: { input: 2.50, cachedInput: 0.25, output: 15.0 } },
  { prefix: 'gpt-5.3-codex', p: { input: 1.75, cachedInput: 0.175, output: 14.0 } },
  { prefix: 'gpt-5.2-codex', p: { input: 1.75, cachedInput: 0.175, output: 14.0 } },
  { prefix: 'gpt-5.2', p: { input: 1.75, cachedInput: 0.175, output: 14.0 } },
  { prefix: 'gpt-5.1-codex-mini', p: { input: 0.25, cachedInput: 0.025, output: 2.0 } },
  { prefix: 'gpt-5.1', p: { input: 1.25, cachedInput: 0.125, output: 10.0 } },
  { prefix: 'gpt-5-mini', p: { input: 0.25, cachedInput: 0.025, output: 2.0 } },
  { prefix: 'gpt-5-nano', p: { input: 0.05, cachedInput: 0.005, output: 0.40 } },
  { prefix: 'gpt-5', p: { input: 1.25, cachedInput: 0.125, output: 10.0 } },
  { prefix: 'codex-mini', p: { input: 1.5, cachedInput: 0.375, output: 6.0 } },
  // Claude 家族：带 cacheCreation（缓存写入价）=> 互斥桶口径。费率对齐 ccusage/LiteLLM、
  // 经 scripts/verify-ccusage.ts 实测校准。注：新 Opus（4.5/4.8）已降价到 $5/$25（cache_read
  // 0.1×、cache_write 1.25×）；旧 Opus 4.0/4.1 为 $15/$75，本期以当前在用的新价为家族默认。
  { prefix: 'claude-opus', p: { input: 5, cachedInput: 0.5, output: 25, cacheCreation: 6.25 } },
  { prefix: 'claude-sonnet', p: { input: 3, cachedInput: 0.3, output: 15, cacheCreation: 3.75 } },
  { prefix: 'claude-haiku', p: { input: 1.0, cachedInput: 0.1, output: 5, cacheCreation: 1.25 } },
]

export function normalizeModel(model: string): string {
  let m = model.trim().toLowerCase()
  if (m.startsWith('gpt5') && !m.startsWith('gpt-5')) m = 'gpt-5' + m.slice(4)
  if (m.startsWith('codex-mini')) return 'codex-mini'
  return m
}

// Claude 家族的 input / cached_input / cache_creation 是互斥桶（input 不含缓存）；
// Codex/gpt 的 input 含 cached（需相减得到非缓存输入）。按"模型"而非"聚合器平台"判定，
// 这样单平台与 --platform all（混合模型）用同一套统一 cache_hit_rate 口径。
export function disjointInputBuckets(model: string): boolean {
  return normalizeModel(model).startsWith('claude')
}

export function lookupPrice(model: string): { price: Price; found: boolean } {
  const m = normalizeModel(model)
  let bestLen = -1
  let best: Price | undefined
  for (const e of priceTable) {
    if (m.startsWith(e.prefix) && e.prefix.length > bestLen) { bestLen = e.prefix.length; best = e.p }
  }
  return { price: best ?? { input: 0, cachedInput: 0, output: 0 }, found: bestLen >= 0 }
}

export function estimateCost(d: Tokens, model: string): { usd: number; priced: boolean } {
  const { price, found } = lookupPrice(model)
  if (!found) return { usd: 0, priced: false }
  let usd: number
  if (price.cacheCreation !== undefined) {
    // Claude：互斥桶，各按各价，不相减。
    usd = (d.input * price.input) / 1e6
        + (d.cached_input * price.cachedInput) / 1e6
        + (d.cache_creation * price.cacheCreation) / 1e6
        + (d.output * price.output) / 1e6
  } else {
    // Codex：cached_input ⊆ input，减去后非缓存按输入价；output 已含 reasoning，无 cache_creation 计费。
    const cached = Math.min(d.cached_input, d.input)
    const nonCached = d.input - cached
    usd = (nonCached * price.input) / 1e6
        + (cached * price.cachedInput) / 1e6
        + (d.output * price.output) / 1e6
  }
  return { usd, priced: true }
}
