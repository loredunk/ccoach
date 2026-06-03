// 隐私关键：入参 text 是瞬时的——只派生计数/长度，绝不存储或返回原文。
// 口径严格移植自 Python collect_claude_behavior.py（new_prompt_acc / prompt_acc_update / prompt_signals）。
import { type PromptSignals } from './model.js'

// 约束词表（EN 在小写文本上匹配，ZH 在原文上匹配）。
const CONSTRAINT_WORDS_EN = [
  'must', 'should', "don't", 'do not', 'only', 'never',
  'ensure', 'require', 'avoid', 'without', 'acceptance',
] as const
const CONSTRAINT_WORDS_ZH = [
  '必须', '应该', '不要', '不能', '只', '确保', '需要',
  '避免', '禁止', '验收', '务必',
] as const

// 返工/纠正起手词（前缀匹配）。
const CORRECTION_STARTS_EN = [
  'actually', 'instead', 'wait', 'no,', 'no ', 'not ',
  'sorry', 'oops', 'rather',
] as const
const CORRECTION_STARTS_ZH = [
  '不对', '重来', '不是', '错了', '应该是', '改成',
  '其实', '等等', '算了',
] as const

// 规范的密钥正则，供下游脱敏（Task 8）复用。
// 注意：SECRET_RE 不参与任何信号计数，仅作为与 prompt 词表放在一处的密钥模式。
export const SECRET_RE =
  /(sk-[A-Za-z0-9]{6,}|ghp_[A-Za-z0-9]{6,}|AKIA[0-9A-Z]{10,}|xox[baprs]-[A-Za-z0-9-]{6,})/

// 列表标记：行首的 -/*/• 或 数字后跟 .) ——无需 flag（注意不要加 g，否则跨 .test 调用有状态）。
// “•” 为字面 bullet 字符。
const LIST_RE = /(^|\n)\s*([-*•]|\d+[.)])\s+/

// 文件扩展名分组（逐字移植 _FILE_EXT_GROUP）。
const _FILE_EXT_GROUP =
  '(?:py|go|js|jsx|ts|tsx|rs|java|kt|swift|c|h|cc|cpp|cxx|hpp|rb|php|cs|' +
  'sh|bash|zsh|html|htm|css|scss|less|md|json|yaml|yml|toml|xml|sql|vue|' +
  'svelte|dart|scala|lua|ipynb|cfg|ini|env|gradle|proto|txt|lock|mod)'

// 文件引用：@path / a/b/c.ext / 裸 file.ext——只用 i flag，禁用 g（避免跨 .test 有状态）。
const FILE_REF_RE = new RegExp(
  '@[\\w\\-]*[./][\\w./\\-]+' +                              // @path / @file.ext
    '|(?:[\\w\\-]+/)+[\\w\\-.]*\\.' + _FILE_EXT_GROUP + '\\b' + // a/b/c.ext
    '|\\b[\\w\\-]+\\.' + _FILE_EXT_GROUP + '\\b',              // 裸 file.ext
  'i',
)

// 累加器：仅数值字段，全程不持有任何原文。
export interface PromptAcc {
  count: number
  len_sum: number
  structured: number
  file_ref: number
  constraint: number
  correction: number
}

export function newPromptAcc(): PromptAcc {
  return { count: 0, len_sum: 0, structured: 0, file_ref: 0, constraint: 0, correction: 0 }
}

export function promptAccUpdate(acc: PromptAcc, rawText: unknown): void {
  if (typeof rawText !== 'string') return
  const text = rawText.trim()
  if (!text) return
  acc.count += 1
  // 长度按 Unicode 码点计（对齐 Python len），用 [...text].length 而非 text.length。
  acc.len_sum += [...text].length
  const low = text.toLowerCase()
  if (text.includes('```') || LIST_RE.test(text)) {
    acc.structured += 1
  }
  if (FILE_REF_RE.test(text)) {
    acc.file_ref += 1
  }
  if (
    CONSTRAINT_WORDS_EN.some((w) => low.includes(w)) ||
    CONSTRAINT_WORDS_ZH.some((w) => text.includes(w))
  ) {
    acc.constraint += 1
  }
  if (
    CORRECTION_STARTS_EN.some((w) => low.startsWith(w)) ||
    CORRECTION_STARTS_ZH.some((w) => text.startsWith(w))
  ) {
    acc.correction += 1
  }
}

// 单条 prompt 的布尔信号（与全局聚合同一词表/谓词，单一真相源）。入参应为已 strip 的文本，
// 瞬时使用——只派生布尔/长度，绝不存储原文。
export interface PromptFlags {
  len: number
  structured: boolean
  file_ref: boolean
  constraint: boolean
  correction: boolean
}
export function promptFlags(text: string): PromptFlags {
  const low = text.toLowerCase()
  return {
    len: [...text].length,
    structured: text.includes('```') || LIST_RE.test(text),
    file_ref: FILE_REF_RE.test(text),
    constraint:
      CONSTRAINT_WORDS_EN.some((w) => low.includes(w)) || CONSTRAINT_WORDS_ZH.some((w) => text.includes(w)),
    correction:
      CORRECTION_STARTS_EN.some((w) => low.startsWith(w)) || CORRECTION_STARTS_ZH.some((w) => text.startsWith(w)),
  }
}

export function promptSignals(acc: PromptAcc): PromptSignals {
  const n = acc.count
  if (!n) {
    return {
      prompts: 0, avg_len: 0, structured_ratio: 0.0,
      file_ref_ratio: 0.0, constraint_ratio: 0.0, correction_rate: 0.0,
    }
  }
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4
  return {
    prompts: n,
    avg_len: Math.round((acc.len_sum / n) * 10) / 10,
    structured_ratio: r4(acc.structured / n),
    file_ref_ratio: r4(acc.file_ref / n),
    constraint_ratio: r4(acc.constraint / n),
    correction_rate: r4(acc.correction / n),
  }
}
