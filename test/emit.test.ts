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
  agg.applyToolName('mcp__playwright__browser_navigate')
  agg.applySkill('superpowers:brainstorming')
  return agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
}

describe('emit', () => {
  it('JSON 含 glossary 与 rate_limits:null，可解析（默认英文 glossary，ADR 0026）', () => {
    const out = emitJson(sample())
    const parsed = JSON.parse(out)
    expect(parsed.rate_limits).toBeNull()
    expect(parsed.glossary._about).toContain('Local-machine data only')
    expect(parsed.tokens.total).toBe(200)
    expect(parsed.tools.mcp.top_servers[0].name).toBe('playwright')
    expect(parsed.skills[0].plugin).toBe('superpowers')
  })
  it('文本默认英文：含 token 行与 local-only 声明', () => {
    const out = emitText(sample(), false)
    expect(out).toContain('Local-only data')
    expect(out).toContain('total')
    expect(out).toContain('MCP:')                         // MCP server line
    expect(out).toContain('playwright(1)')
    expect(out).toContain('brainstorming·superpowers(1)') // skill shows short name + plugin, not raw 'superpowers:brainstorming'
    expect(out).toContain('browser_navigate·playwright(1)')
  })
})
