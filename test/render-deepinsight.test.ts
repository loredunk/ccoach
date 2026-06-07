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
          digest_stats: 'tight ~7.5K', findings: [
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
    expect(html).toContain('instrument notes')
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
})
