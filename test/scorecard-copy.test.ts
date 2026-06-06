// test/scorecard-copy.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const copy = JSON.parse(readFileSync('skills/ccoach-insight/references/scorecard-copy.json', 'utf8'))

describe('scorecard copy — Prompt-axis tiers are renamed and honest', () => {
  it('Prompt tier names match the agreed xianxia (zh) / AI-meme (en) ladder', () => {
    const tiers = copy.axes.prompt.tiers
    expect(tiers.map((t: any) => t.zh_name)).toEqual(['渡劫飞升', '结丹有成', '筑基初成', '卡瓶颈', '伪灵根'])
    expect(tiers.map((t: any) => t.en_name)).toEqual(['One-Shot', 'Locked In', 'Mid', 'Vibe Coder', 'Manifesting'])
  })

  it('no copy text claims unmeasured "repetition" (the old Broken Record bug)', () => {
    const blob = JSON.stringify(copy)
    expect(/复读机|Broken Record|reworded|改写了好几轮|repeat/i.test(blob)).toBe(false)
  })
})
