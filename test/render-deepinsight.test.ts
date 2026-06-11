// test/render-deepinsight.test.ts — deepinsight HTML renderer (structure + escaping + robustness)
import { describe, it, expect } from 'vitest'
// @ts-expect-error — skill .mjs has no types; we only assert on the returned HTML string
import { renderDeepinsight } from '../skills/ccoach-deepinsight/scripts/render_deepinsight.mjs'

describe('render_deepinsight', () => {
  it('renders passes, findings, grounding, verdict; demotes metric to a signal margin', () => {
    const html = renderDeepinsight({
      project: 'demo', platform: 'claude-code', window: 'w', generated_at: '2026-06-07',
      tldr: 'short verdict',
      passes: [
        {
          id: '01', kind: 'Pass · Project', title: 'Systemic', findings: [
            { title: 'Blind edits', category: 'workflow', confidence: 'high', root_cause: 'no gate', fix: 'add a hook', feature: 'PostToolUse hook', signal: '21% spirals' },
          ],
        },
        {
          id: '02', kind: 'Pass · Session', title: 'Session x', verdict: { label: 'Healthy', tone: 'healthy' },
          grounding: [{ hash: 'abc1234', ts: '2026-06-04', subject: 'shipped T15' }],
          digest_stats: 'compact summary ~7.5K tokens', findings: [
            { title: 'opener', category: 'prompt_issue', confidence: 'high', root_cause: 'terse', fix: 'use @file', feature: '@file references', signal: 'len 41' },
          ],
        },
      ],
      honesty: ['classifier is uncalibrated'],
      privacy: 'local only',
    })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain("class='pass'")
    expect(html.match(/class='card'/g)?.length).toBe(2)
    expect(html).toContain('PostToolUse hook')
    expect(html).toContain('var(--c-flow)') // workflow category color mapping
    expect(html).toContain('verdict healthy') // verdict banner tone
    expect(html).toContain('shipped T15') // grounding ledger row
    expect(html).toContain("class='signal'") // metric is demoted to a signal margin, never the headline
    expect(html).toContain('tool limits') // honesty notes chrome (plain words, localized)
  })

  it('HTML-escapes injected content (no raw tags survive)', () => {
    const html = renderDeepinsight({
      project: '<img src=x onerror=alert(1)>',
      passes: [{ id: '01', kind: 'P', title: 'T', findings: [
        { title: '<script>alert(1)</script>', category: 'other', confidence: 'low', root_cause: 'x', fix: 'y' },
      ] }],
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('handles minimal/empty data without throwing', () => {
    expect(() => renderDeepinsight({})).not.toThrow()
    expect(renderDeepinsight({})).toContain('Deep')
  })

  it('renders a clickable findings TOC with matching card anchors; omits when no findings', () => {
    const html = renderDeepinsight({
      lang: 'zh',
      passes: [
        { id: '01', kind: 'Pass · Project', title: 'Systemic', findings: [
          { title: 'first finding', category: 'workflow', root_cause: 'x' },
          { title: 'second finding', category: 'unknown_feature', root_cause: 'y' },
        ] },
        { id: '02', kind: 'Pass · Session', title: 'Deep dive', findings: [
          { title: 'third finding', category: 'prompt_issue', root_cause: 'z' },
        ] },
      ],
    })
    expect(html).toContain("class='toc'")
    expect(html).toContain('发现清单')
    // every TOC link has a matching card anchor
    expect(html).toContain("href='#f-0-1'")
    expect(html).toContain("id='f-0-1'")
    expect(html).toContain("href='#f-1-0'")
    expect(html).toContain("id='f-1-0'")
    expect(html).toContain('Pass · Session · Deep dive') // grouped headers when >1 pass has findings
    const none = renderDeepinsight({ lang: 'zh', passes: [{ id: '01', kind: 'P', title: 'T', findings: [] }] })
    expect(none).not.toContain("class='toc'")
  })

  it('localizes category badges per lang — unknown_feature is self-explanatory, never "Unknown Feature"', () => {
    const passes = [{ id: '01', kind: 'P', title: 'T', findings: [
      { title: 'memory unused', category: 'unknown_feature', confidence: 'high', root_cause: 'x', fix: 'use /memory', feature: '/memory', signal: 'memory_usage_count 0' },
      { title: 'gap', category: 'cognitive_gap', confidence: 'med', root_cause: 'y' },
    ] }]
    const zh = renderDeepinsight({ lang: 'zh', passes })
    expect(zh).toContain('有现成官方特性')
    expect(zh).toContain('知识盲区')
    expect(zh).not.toContain('Unknown Feature')
    expect(zh).toContain('改法') // fix label localized
    expect(zh).toContain('信号') // would appear in legend-free reports too via sig-k when signal present
    const en = renderDeepinsight({ lang: 'en', passes })
    expect(en).toContain('Native feature available')
    expect(en).not.toContain('Unknown Feature')
  })

  it('renders a category legend for known categories that appear (with plain definitions), omits otherwise', () => {
    const zh = renderDeepinsight({ lang: 'zh', passes: [{ id: '01', kind: 'P', title: 'T', findings: [
      { title: 'a', category: 'unknown_feature', root_cause: 'x' },
    ] }] })
    expect(zh).toContain("class='legend'")
    expect(zh).toContain('这是机会，不是故障')
    expect(zh).toContain('分类含义')
    expect(zh).not.toContain('知识盲区') // legend lists only categories that appear
    const none = renderDeepinsight({ lang: 'zh', passes: [{ id: '01', kind: 'P', title: 'T', findings: [
      { title: 'a', category: 'my_own_thing', category_label: '自造类', root_cause: 'x' },
    ] }] })
    expect(none).not.toContain("class='legend'") // novel-only report → no legend
  })

  it('novel categories prefer category_label; title-case fallback still works', () => {
    const html = renderDeepinsight({ lang: 'zh', passes: [{ id: '01', kind: 'P', title: 'T', findings: [
      { title: 'a', category: 'context_thrash', category_label: '上下文反复重建', novel_category: true, root_cause: 'x' },
      { title: 'b', category: 'observability_gap', root_cause: 'y' },
    ] }] })
    expect(html).toContain('上下文反复重建')
    expect(html).toContain('Observability Gap') // fallback unchanged
  })

  it('renders the magic_time highlight strip (value/unit/basis/tone), omits when absent', () => {
    const html = renderDeepinsight({
      project: 'demo', platform: 'codex',
      magic_time: [
        { value: '74', unit: 'min', label: 'fast mode saved you ~74 minutes', basis: "Codex App's own estimate · 56 runs", tone: 'win' },
        { value: '88', label: 'threads indexed, 0 ever archived', basis: 'exact count from your local session index', tone: 'loss' },
        { value: '<b>x</b>', label: 'escape me', basis: 'b' },
      ],
    })
    expect(html).toContain('Magic Time')
    expect(html.match(/class='mt-card/g)?.length).toBe(3)
    expect(html).toContain('mt-win')
    expect(html).toContain('mt-loss')
    expect(html).toContain("class='mt-unit'>min")
    expect(html).toContain("Codex App&#39;s own estimate") // provenance line rendered
    expect(html).not.toContain('<b>x</b>') // escaped
    const without = renderDeepinsight({ project: 'demo' })
    expect(without).not.toContain('Magic Time')
  })
})
