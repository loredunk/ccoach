// test/token-display.test.ts — T16: 报告"输入/输出 Token"展示口径修正（ADR 0024）。
// 背景：Claude 的 tokens.input 仅"非缓存新输入"，cache_read/cache_creation 独立桶；Codex 的
// tokens.input 已含缓存。旧版头对头比较 input 是苹果对橘子（Claude 虚小），Codex 构成面板还双算。
// 这里对展示层口径助手做单测 + 一个渲染级回归（纯展示层修复，不动数据/计价层）。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-ignore — skill 层 .mjs 无类型声明（运行时导入，仅用于单测）
import { inputSideTotal, tokenComposition } from '../skills/ai-usage-html-report/scripts/render_dual_platform.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RENDER = path.resolve(HERE, '..', 'skills', 'ai-usage-html-report', 'scripts', 'render_dual_platform.mjs')

// 还原 T16 报告里的反常形状：Claude input(fresh) 远小于 output，但 cache_read 占大头；
// Codex input(含缓存) 远大于 output。两平台 total 都是全部 token 之和。
const ccTokens = { input: 192128, output: 3553058, cache_read: 28000000, cache_create: 800000, total: 32545186 }
const cxTokens = { input: 34593032, output: 153180, cache_read: 30000000, reasoning: 40000, total: 34746212 }

describe('T16 token 显示口径 (ADR 0024)', () => {
  it('inputSideTotal：Claude 含 cache_read+cache_create；Codex 的 input 已含缓存', () => {
    expect(inputSideTotal(ccTokens, 'claude')).toBe(192128 + 28000000 + 800000)
    expect(inputSideTotal(cxTokens, 'codex')).toBe(34593032)
    expect(inputSideTotal(null, 'claude')).toBe(0)
  })

  it('修复后两平台"输入侧总量"都 ≫ 输出（解决 Claude 反常）', () => {
    expect(inputSideTotal(ccTokens, 'claude')).toBeGreaterThan(ccTokens.output)
    expect(inputSideTotal(cxTokens, 'codex')).toBeGreaterThan(cxTokens.output)
  })

  it('tokenComposition：互斥桶求和 == total（reasoning 不另加，⊆output）', () => {
    const cc = tokenComposition(ccTokens, 'claude')
    expect(cc.fresh + cc.cacheRead + cc.cacheCreate + cc.output).toBe(ccTokens.total)
    expect(cc.reasoning).toBe(0)

    const cx = tokenComposition(cxTokens, 'codex')
    // Codex：input 含缓存 → fresh = input - cache_read；构成桶不含 reasoning（它 ⊆ output）。
    expect(cx.fresh).toBe(34593032 - 30000000)
    expect(cx.fresh + cx.cacheRead + cx.output).toBe(cxTokens.total)
    expect(cx.reasoning).toBe(40000)
  })

  it('渲染：头对头"输入"用含缓存的输入侧总量、Codex 构成不再双算', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccoach-tokdisp-'))
    try {
      const plat = (name: string, tokens: Record<string, number>, chr: number) => ({
        platform: name, source: 's', active_days: 1, sessions: 1,
        date_range: ['2026-06-01', '2026-06-01'], tokens, cost_usd: 0, cost_is_real: true,
        cache_hit_rate: chr, models: [], daily_series: [], top_sessions: [], behavior: null,
      })
      const merged = {
        title: 't', generated_at: '2026-06-04', window: { desc: 'w' },
        platforms: { claude_code: plat('Claude Code', ccTokens, 0.99), codex: plat('Codex', cxTokens, 0.86) },
        combined: { total_cost_usd: 0, total_tokens: ccTokens.total + cxTokens.total, total_sessions: 1 },
      }
      const dataPath = path.join(dir, 'merged.json')
      const insPath = path.join(dir, 'insights.json')
      const outPath = path.join(dir, 'out.html')
      writeFileSync(dataPath, JSON.stringify(merged))
      writeFileSync(insPath, JSON.stringify({ executive_summary: 'x', insights: [], recommendations: [] }))
      execFileSync('node', [RENDER, '--data', dataPath, '--insights', insPath, '--lang', 'zh', '--output', outPath])
      const html = readFileSync(outPath, 'utf8')
      // 头对头"输入"展示 Claude 的输入侧总量（28,992,128），而非裸 fresh 192,128。
      expect(html).toContain('输入 Token（含缓存读）')
      expect(html).toContain((192128 + 28000000 + 800000).toLocaleString('en-US')) // 28,992,128
      // Codex 构成用"输入（非缓存）"= 4,593,032，不再把含缓存的 input 当一桶。
      expect(html).toContain((34593032 - 30000000).toLocaleString('en-US')) // 4,593,032
      expect(html).toContain('其中 reasoning')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
