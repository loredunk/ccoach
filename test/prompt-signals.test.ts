// test/prompt-signals.test.ts
import { describe, it, expect } from 'vitest'
import { newPromptAcc, promptAccUpdate, promptSignals } from '../src/prompt-signals.js'

describe('prompt signals（仅数值、无原文）', () => {
  it('结构化/文件引用/约束/返工各计一次', () => {
    const acc = newPromptAcc()
    promptAccUpdate(acc, '请修改 src/main.ts，必须保留现有测试\n- 第一点\n- 第二点')
    promptAccUpdate(acc, 'actually 改回去')
    const s = promptSignals(acc)
    expect(s.prompts).toBe(2)
    expect(s.structured_ratio).toBe(0.5)   // 第一条有列表
    expect(s.file_ref_ratio).toBe(0.5)     // 第一条引用 .ts
    expect(s.constraint_ratio).toBe(0.5)   // “必须”
    expect(s.correction_rate).toBe(0.5)    // “actually”
  })
  it('空 acc 全零', () => {
    expect(promptSignals(newPromptAcc()).prompts).toBe(0)
  })
})
