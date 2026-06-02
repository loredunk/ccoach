// 隐私安全：把原始命令/路径降维成安全的派生 token，绝不回传原文。
// 口径严格移植自 Python collect_claude_behavior.py（comma 移植自 Go report.go）。

// git 子命令白名单——隐私词汇表；不在表内一律不泄露（返回 null）。
export const GIT_SUBCMDS: Set<string> = new Set([
  'add', 'commit', 'push', 'pull', 'fetch', 'diff', 'status', 'log',
  'checkout', 'branch', 'merge', 'rebase', 'stash', 'show', 'reset',
  'clone', 'switch', 'restore', 'tag', 'cherry-pick', 'revert',
  'rev-parse', 'remote', 'init', 'blame',
])

// 取可执行名：跳过 UPPERCASE 的 VAR=val 环境前缀，返回 basename。
export function firstToken(cmd: string): string {
  if (typeof cmd !== 'string') return ''
  cmd = cmd.trim()
  for (const part of cmd.split(/\s+/).filter(Boolean)) {
    if (part.includes('=') && !/^[-/.]/.test(part)) {
      const name = part.split('=', 1)[0]
      // Python name.replace("_","").isalnum()：去下划线后非空且全为 [A-Za-z0-9]。
      const stripped = name.replace(/_/g, '')
      if (stripped && /^[A-Za-z0-9]+$/.test(stripped) && name === name.toUpperCase()) {
        continue
      }
    }
    return part.split('/').pop() as string
  }
  return ''
}

// git 子命令：白名单门控；命中 git 后第一个非 flag token 决定结果，未知即 null、不再前看。
export function gitSubcommand(cmd: string): string | null {
  if (typeof cmd !== 'string') return null
  const toks = cmd.trim().split(/\s+/).filter(Boolean)
  let seenGit = false
  for (const t of toks) {
    const base = t.split('/').pop() as string
    if (!seenGit) {
      if (base === 'git') seenGit = true
      continue
    }
    if (t.startsWith('-')) continue
    const sub = base.toLowerCase()
    if (GIT_SUBCMDS.has(sub)) return sub
    return null // 未知子命令：不泄露
  }
  return null
}

// 文件扩展名：只取 basename 的最后一段扩展名，无扩展名返回 ''。
export function extOf(filePath: string): string {
  if (typeof filePath !== 'string' || !filePath) return ''
  const base = filePath.split('/').pop() as string
  if (!base.includes('.')) return ''
  return (base.split('.').pop() as string).toLowerCase()
}

// 仓库名：只取 cwd 的 basename，剥尾部斜杠；空/无名返回 '(unknown)'。
export function repoName(cwd: string): string {
  if (typeof cwd !== 'string' || !cwd) return '(unknown)'
  const name = cwd.replace(/\/+$/, '').split('/').pop() as string
  return name || '(unknown)'
}

// 千分位（移植 Go comma，处理负数，仅对整数部分分组）。
export function comma(n: number): string {
  const neg = n < 0
  let s = String(Math.abs(Math.trunc(n)))
  const parts: string[] = []
  while (s.length > 3) {
    parts.unshift(s.slice(s.length - 3))
    s = s.slice(0, s.length - 3)
  }
  parts.unshift(s)
  const out = parts.join(',')
  return neg ? '-' + out : out
}
