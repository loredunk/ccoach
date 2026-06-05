import type { TaskType } from './model.js'
export type { TaskType }

// episode 任务分型的输入特征（ADR 0033）：全部由已派生的结构信号汇总，零内容读取。
export interface TaskFeatures {
  reads: number; edits: number; searches: number; shells: number; others: number
  filesTouched: number
  hasTest: boolean
  longRun: boolean        // 出现疑似长任务命令（train/notebook/反复 rerun 等）
  docExtRatio: number     // 触碰文件中文档扩展名占比 0–1
  codeExtRatio: number    // 代码扩展名占比 0–1
  linesChanged: number    // +/- 累计
  errorRate: number       // 工具错误率 0–1
}

// 确定性分类（ADR 0033 D1）：各类型按结构强度打分，取最高；低分→unknown 交 skill 语义裁决。
// 阈值/权重为草案，待真实多画像数据校准（ADR 0033 OQ1）。
export function classifyTask(f: TaskFeatures): { type: TaskType; confidence: number } {
  const total = f.reads + f.edits + f.searches + f.shells + f.others
  if (total < 2) return { type: 'unknown', confidence: 0.1 }
  const readish = f.reads + f.searches
  const scores: Record<Exclude<TaskType, 'unknown'>, number> = {
    docs: f.docExtRatio >= 0.6 && f.edits > 0 ? 0.6 + f.docExtRatio * 0.4 : 0,
    experiment: f.longRun ? 0.7 + (f.edits === 0 ? 0.2 : 0) : 0,
    debug: f.errorRate >= 0.4 && f.edits > 0 && f.filesTouched <= 3 ? 0.5 + f.errorRate * 0.4 : 0,
    refactor: f.filesTouched >= 6 && (f.linesChanged >= 400 || f.edits >= 10) ? 0.7 + Math.min(0.3, f.filesTouched / 40) : 0,
    implement: f.edits >= 3 && (f.hasTest || f.codeExtRatio >= 0.5) ? 0.5 + Math.min(0.4, f.edits / 25) : 0,
    explore: readish >= 4 && f.edits <= 1 ? 0.5 + Math.min(0.4, readish / 25) : 0,
    scripting: f.edits >= 1 && !f.hasTest && total <= 6 && f.filesTouched <= 2 ? 0.45 : 0,
  }
  let bestType: TaskType = 'unknown'
  let best = 0
  for (const [k, v] of Object.entries(scores)) if (v > best) { best = v; bestType = k as TaskType }
  if (best < 0.4) return { type: 'unknown', confidence: Math.min(0.39, best) }
  return { type: bestType, confidence: Math.min(1, best) }
}
