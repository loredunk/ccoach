// ADR 0045: MCP usage top (per-tool + per-server) and skill plugin attribution.
import { describe, it, expect } from 'vitest'
import { Aggregator } from '../src/aggregate.js'

function build() {
  const agg = new Aggregator('claude-code')
  agg.applyTokens({ input: 100, cached_input: 0, output: 50, reasoning_output: 0, cache_creation: 0, total: 150 }, 'claude-opus-4-8', 'ccoach', 's1', new Date('2026-06-02T03:00:00Z'))
  agg.touchSession('s1')
  // MCP tool calls across two servers
  agg.applyToolName('mcp__playwright__browser_navigate')
  agg.applyToolName('mcp__playwright__browser_navigate')
  agg.applyToolName('mcp__playwright__browser_click')
  agg.applyToolName('mcp__plugin_imessage_imessage__reply')
  agg.applyToolName('mcp__plugin_imessage_imessage')          // malformed: missing tool segment
  agg.applyToolName('Bash')                                    // native tool, must NOT count as mcp
  // skills with and without plugin namespace
  agg.applySkill('superpowers:brainstorming')
  agg.applySkill('superpowers:brainstorming')
  agg.applySkill('tdd')
  return agg.assemble({ fromYmd: '2026-06-02', toYmd: '2026-06-02', desc: '2026-06-02' }, 'glob')
}

describe('MCP & skills usage top (ADR 0045)', () => {
  it('tools.mcp ranks tools and servers, excludes native tools', () => {
    const r = build()
    expect(r.tools.mcp).toBeTruthy()
    expect(r.tools.mcp!.total_calls).toBe(5)                  // 4 well-formed + 1 malformed, Bash excluded
    const top = r.tools.mcp!.top_tools
    expect(top[0]).toEqual({ name: 'mcp__playwright__browser_navigate', server: 'playwright', tool: 'browser_navigate', count: 2 })
    const servers = r.tools.mcp!.top_servers
    expect(servers[0]).toEqual({ name: 'playwright', count: 3 })
    expect(servers.find((s) => s.name === 'plugin_imessage_imessage')!.count).toBe(2)
    // malformed name → server is the whole remainder, tool ''
    expect(top.find((t) => t.name === 'mcp__plugin_imessage_imessage')!.tool).toBe('')
  })

  it('skills carry plugin attribution (parsed from plugin:skill)', () => {
    const r = build()
    const brainstorm = r.skills!.find((s) => s.command === 'superpowers:brainstorming')!
    expect(brainstorm.count).toBe(2)
    expect(brainstorm.plugin).toBe('superpowers')
    const tdd = r.skills!.find((s) => s.command === 'tdd')!
    expect(tdd.plugin).toBeUndefined()
  })
})
