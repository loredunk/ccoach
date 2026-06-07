// test/codex-episode-signals.test.ts — Codex 回合编辑/错误信号（ADR 0050 D1/D2）
import { describe, it, expect } from 'vitest'
import { parseCodex } from '../src/parsers/codex.js'

const window = { fromYmd: '2026-06-05', toYmd: '2026-06-05', desc: '2026-06-05' }

describe('codex episode edit/error signals (ADR 0050)', () => {
  const r = parseCodex('test/fixtures/codex-edits', window, 'episode') as any

  it('patch_apply_end → files_touched / max_edits / edit_ring + rework', () => {
    expect(r.episode_summary.episodes).toBeGreaterThanOrEqual(1)
    const ep = (r.episodes_detail as any[]).find((e) => e.files_touched > 0)
    expect(ep, 'expected an episode with file edits').toBeTruthy()
    expect(ep.files_touched).toBe(1) // 同一文件 a.ts
    expect(ep.max_edits_per_file).toBe(3) // 3 次 patch_apply_end → edit_ring
    expect(ep.spiral.edit_ring).toBe(true)
    expect(r.rework_signals.edits).toBe(3)
    expect(r.rework_signals.lines_added).toBe(5) // +2 +2 +1
    expect(r.rework_signals.lines_removed).toBe(3) // -1 -1 -1
  })

  it('exec_command_end exit≠0 → error_count / error_signals', () => {
    const ep = (r.episodes_detail as any[]).find((e) => e.files_touched > 0)
    expect(ep.error_count).toBeGreaterThanOrEqual(1)
    expect(r.error_signals.tool_errors).toBeGreaterThanOrEqual(1)
  })
})
