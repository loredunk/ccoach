// test/deepinsight-grounding.test.ts — grounding gate parser（ADR 0048 D2）
import { describe, it, expect } from 'vitest'
// @ts-ignore — skill 层 .mjs 无类型声明（运行时导入）
import { parseGitLog } from '../skills/ccoach-deepinsight/scripts/grounding.mjs'

describe('grounding parseGitLog', () => {
  it('解析 hash/ts/subject，空输入返回空数组，绝不臆造提交', () => {
    const raw =
      'abc1234567\t2026-06-04T19:20:00+08:00\tfeat: T15 i18n\n' +
      'def8901234\t2026-06-04T21:11:00+08:00\tfix: T16 token display\n'
    const c = parseGitLog(raw)
    expect(c).toHaveLength(2)
    expect(c[0]).toEqual({ hash: 'abc12345', ts: '2026-06-04T19:20:00+08:00', subject: 'feat: T15 i18n' })
    expect(c[1].subject).toBe('fix: T16 token display')
    expect(parseGitLog('')).toEqual([])
    expect(parseGitLog('garbage-no-tabs')).toEqual([])
  })
})
