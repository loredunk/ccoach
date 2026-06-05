import { describe, it, expect } from 'vitest'
import { classifyTask, type TaskFeatures } from '../src/task-type.js'

const base = (): TaskFeatures => ({
  reads: 0, edits: 0, searches: 0, shells: 0, others: 0,
  filesTouched: 0, hasTest: false, longRun: false,
  docExtRatio: 0, codeExtRatio: 0, linesChanged: 0, errorRate: 0,
})

describe('classifyTask', () => {
  it('读多写少 → explore', () => {
    const f = { ...base(), reads: 12, searches: 6, edits: 1, filesTouched: 9 }
    expect(classifyTask(f).type).toBe('explore')
  })
  it('编辑密集 + 测试 → implement', () => {
    const f = { ...base(), edits: 10, reads: 4, hasTest: true, filesTouched: 3, codeExtRatio: 0.9 }
    expect(classifyTask(f).type).toBe('implement')
  })
  it('错误驱动 + 文件窄 → debug', () => {
    const f = { ...base(), edits: 6, reads: 5, errorRate: 0.6, filesTouched: 2, hasTest: true }
    expect(classifyTask(f).type).toBe('debug')
  })
  it('触碰文件多 + 大改 → refactor', () => {
    const f = { ...base(), edits: 14, filesTouched: 11, linesChanged: 800, codeExtRatio: 0.8 }
    expect(classifyTask(f).type).toBe('refactor')
  })
  it('长命令少编辑 → experiment', () => {
    const f = { ...base(), shells: 8, longRun: true, edits: 0, reads: 2 }
    expect(classifyTask(f).type).toBe('experiment')
  })
  it('文档为主 → docs', () => {
    const f = { ...base(), edits: 5, docExtRatio: 0.9, filesTouched: 2 }
    expect(classifyTask(f).type).toBe('docs')
  })
  it('信号过弱 → unknown 且 confidence 低', () => {
    const r = classifyTask(base())
    expect(r.type).toBe('unknown')
    expect(r.confidence).toBeLessThan(0.4)
  })
})
