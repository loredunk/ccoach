// grounding.mjs — deep-insight 的 grounding gate。
// 只读 git：给定会话 [since, until] 窗口，取窗内提交，供 skill 把会话意图锚定到真实落地。
// 绝不臆造、绝不取窗外提交（窗口由 git --since/--until 强制）。
import { execFileSync } from 'node:child_process'

// 解析 `git log --pretty=%H%x09%cI%x09%s`（TAB 分隔）为 [{hash, ts, subject}]。纯函数，可测。
export function parseGitLog(raw) {
  const out = []
  for (const line of String(raw).split('\n')) {
    const t = line.replace(/\r$/, '')
    if (!t.trim()) continue
    const parts = t.split('\t')
    if (parts.length < 2) continue
    const [hash, iso, ...rest] = parts
    if (!hash || !iso) continue
    out.push({ hash: hash.slice(0, 8), ts: iso, subject: rest.join('\t') })
  }
  return out
}

// 取 [since, until]（ISO 时间）内的提交。只读；任何失败返回空数组。
export function commitsInWindow({ since, until, cwd = '.' }) {
  let raw = ''
  try {
    raw = execFileSync('git', ['-C', cwd, 'log', '--since', since, '--until', until, '--pretty=%H%x09%cI%x09%s'], {
      encoding: 'utf8',
    })
  } catch {
    return []
  }
  return parseGitLog(raw)
}

// CLI 用法：node grounding.mjs <since-ISO> <until-ISO> [cwd]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , since, until, cwd] = process.argv
  if (!since || !until) {
    process.stderr.write('usage: node grounding.mjs <since-ISO> <until-ISO> [cwd]\n')
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(commitsInWindow({ since, until, cwd: cwd || '.' }), null, 2) + '\n')
}
