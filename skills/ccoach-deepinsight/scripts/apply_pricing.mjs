#!/usr/bin/env node
// Apply online official prices to the merged dual-platform usage JSON.
//
// ccoach CLI stays 100% offline: it only emits authoritative tokens + model list.
// The *authoritative cost* is computed here, in the skill layer, from official
// prices the agent looked up online (per actually-observed model name, including
// third-party cc-switch models). This script is deterministic — the agent does the
// web lookup, writes /tmp/pricing.json, and this prices each model's token buckets.
//
// Inputs:
//   --data      merged dual-platform JSON (from merge_dual_platform.mjs); has
//               platforms.<plat>.models[] each carrying unified token buckets:
//               { model, tokens:{input,cached_input,output,reasoning_output,cache_creation,total},
//                 cost (offline fallback), priced (offline-table hit) }
//   --pricing   /tmp/pricing.json written by the agent (per-million USD):
//               { queried_at, models: { "<name>": {input,cached_input,output,cache_creation?,source} }, unpriced?[] }
//   --output    output path (default: overwrite --data)
//
// Cost口径 mirrors src/pricing.ts estimateCost EXACTLY:
//   - price has cache_creation  => Claude family: disjoint buckets, each priced as-is.
//   - else (Codex/gpt/3rd-party) => cached_input ⊆ input: subtract before pricing input.
// Per-million-token rates. Models with no online price fall back to the offline
// estimate carried in models[].cost and are flagged in unpriced_models[].
//
// Pure Node ≥18 (ESM, no deps). No network here — the agent already did the lookup.
import { readFileSync, writeFileSync } from 'node:fs'

const round = (x, n = 0) => { const f = 10 ** n; return Math.round(Number(x) * f) / f }

// Cost for one model's token buckets given a per-million-USD price. Mirrors
// src/pricing.ts:64-83 — presence of cache_creation switches to Claude disjoint口径.
export function priceModel(tokens, price) {
  const t = tokens ?? {}
  const input = t.input ?? 0
  const cachedInput = t.cached_input ?? 0
  const output = t.output ?? 0
  const cacheCreation = t.cache_creation ?? 0
  if (price.cache_creation !== undefined && price.cache_creation !== null) {
    // Claude: input/cached_input/cache_creation are disjoint buckets.
    return (input * price.input
          + cachedInput * price.cached_input
          + cacheCreation * (price.cache_creation ?? 0)
          + output * price.output) / 1e6
  }
  // Codex/gpt/third-party: cached_input ⊆ input.
  const cached = Math.min(cachedInput, input)
  const nonCached = input - cached
  return (nonCached * price.input
        + cached * price.cached_input
        + output * price.output) / 1e6
}

// Look up an online price by exact then case-insensitive model name.
function findPrice(models, name) {
  if (models[name]) return models[name]
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(models)) if (k.toLowerCase() === lower) return v
  return null
}

// Rewrite authoritative cost on the merged data from online prices. Returns the
// mutated data object. Exported for unit tests.
export function applyPricing(data, pricing) {
  const priceTable = pricing?.models ?? {}
  const queriedAt = pricing?.queried_at ?? null
  const platforms = data?.platforms ?? {}
  let grandTotal = 0
  const allUnpriced = new Set()

  for (const plat of Object.values(platforms)) {
    const models = Array.isArray(plat.models) ? plat.models : []
    let platCost = 0
    const platUnpriced = []
    for (const m of models) {
      const tok = m.tokens ?? {}
      const totalTok = tok.total ?? 0
      if (totalTok === 0) { m.cost = 0; continue } // synthetic/empty placeholders cost nothing
      const price = findPrice(priceTable, m.model ?? '')
      if (price) {
        m.cost = round(priceModel(tok, price), 4)
        m.price_source = price.source ?? null
      } else {
        // No online price → keep the offline fallback already on m.cost; flag it.
        m.cost = round(m.cost ?? 0, 4)
        platUnpriced.push(m.model)
        allUnpriced.add(m.model)
      }
      platCost += m.cost
    }
    plat.cost_usd = round(platCost, 2)
    plat.cost_basis = 'official-online'
    plat.priced_at = queriedAt
    plat.cost_is_real = platUnpriced.length === 0 ? true : 'partial'
    if (platUnpriced.length) plat.unpriced_models = platUnpriced.sort()
    grandTotal += plat.cost_usd
  }

  data.cost = { basis: 'official-online', priced_at: queriedAt }
  if (allUnpriced.size) data.cost.unpriced_models = [...allUnpriced].sort()
  if (data.combined) data.combined.total_cost_usd = round(grandTotal, 2)
  return data
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) o[a.slice(2)] = argv[++i] }
  return o
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.data || !a.pricing) { process.stderr.write('usage: apply_pricing.mjs --data <merged.json> --pricing <pricing.json> [--output <path>]\n'); process.exit(2) }
  const data = JSON.parse(readFileSync(a.data, 'utf8'))
  const pricing = JSON.parse(readFileSync(a.pricing, 'utf8'))
  applyPricing(data, pricing)
  const out = a.output ?? a.data
  writeFileSync(out, JSON.stringify(data, null, 2))
  const plats = Object.entries(data.platforms ?? {}).map(([k, p]) => `${k} $${p.cost_usd} (${p.cost_is_real === true ? 'all-priced' : 'partial'})`)
  process.stderr.write(`wrote ${out}\n  ${plats.join('\n  ')}\n  combined $${data.combined?.total_cost_usd}\n`)
}

// Run main only as CLI (allow importing for tests).
if (process.argv[1] && process.argv[1].endsWith('apply_pricing.mjs')) main()
