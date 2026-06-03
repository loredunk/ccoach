// 把工具报错归类为固定白名单类别。隐私红线细化（见 ADR 0016）：只对错误文本做**瞬时**
// 模式匹配、只产出一个类别标签，绝不存储/外发原始 stderr/stdout/diff/文件内容/命令全行。
export type ErrorCategory =
  | 'not-read'
  | 'permission'
  | 'timeout'
  | 'network'
  | 'test'
  | 'git'
  | 'build'
  | 'other'

export const ERROR_CATEGORIES: ErrorCategory[] = [
  'not-read', 'permission', 'timeout', 'network', 'test', 'git', 'build', 'other',
]

// 顺序敏感：更具体/更外因的类别在前（如网络/超时优先于 build，避免把"装包时断网"归成 build）。
export function classifyError(errorText: string): ErrorCategory {
  const t = typeof errorText === 'string' ? errorText : ''
  if (/not been read|read it first before/i.test(t)) return 'not-read'
  if (/permission denied|EACCES|not permitted|operation not permitted/i.test(t)) return 'permission'
  if (/ETIMEDOUT|timed out|deadline exceeded/i.test(t)) return 'timeout'
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|fetch failed|network is unreachable/i.test(t)) return 'network'
  if (/\bFAIL\b|tests? failed|assertionerror|✗ /i.test(t)) return 'test'
  if (/fatal:|not a git repository|exit code 128/i.test(t)) return 'git'
  if (/npm (err|error)|cannot find module|\btsc\b|build failed|cargo |compil(e|ation)|\bgo: /i.test(t)) return 'build'
  return 'other'
}
