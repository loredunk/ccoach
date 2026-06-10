// 特性采用信号（ADR 0056）：从 ~/.claude.json 只读**白名单键**派生「哪些原生特性还没被用上」。
// 隐私：只取下列白名单计数器/布尔与白名单 tip id 的数值水位；绝不读 projects/history 等其它键，
// 读不到/解析失败一律静默返回 null（该文件不存在是正常情况，如纯 Codex 机器）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { type FeatureAdoption, type FeatureAdoptionTip } from './model.js'

// 直接采用计数器白名单：~/.claude.json 顶层键 → 输出 snake_case 键。
// 这是主证据（零解释成本）；语义不明的键只透传计数、不参与 unadopted 判定。
const COUNTER_KEYS: Array<[src: string, dst: string]> = [
  ['promptQueueUseCount', 'prompt_queue_use_count'],
  ['memoryUsageCount', 'memory_usage_count'],
  ['btwUseCount', 'btw_use_count'],
  ['hasUsedBackgroundTask', 'has_used_background_task'],
]

// 采用条件型 tip 白名单（来自 CLI bundle 实证：isRelevant 以「未采用」为展示条件）。
// 无条件轮播的宣传型 tip（todo-list/theme-command 等 isRelevant 恒真）不在列——对画像零价值。
// 注意：该分类来自特定版本的 bundle，跨版本会漂移 → tips 只作旁证，绝不参与 unadopted 判定。
const CONDITIONAL_TIPS = [
  'prompt-queue',
  'memory-command',
  'git-worktrees',
  'custom-agents',
  'plan-mode-for-complex-tasks',
]
// tip 冷却周期（bundle 实证 cooldownSessions≈20）：水位距 numStartups 在一个周期内 = 近期仍在轮播。
const COOLDOWN_STARTUPS = 20

export function defaultClaudeJsonPath(): string {
  return join(homedir(), '.claude.json')
}

export function readFeatureAdoption(claudeJsonPath: string): FeatureAdoption | null {
  let raw: any
  try { raw = JSON.parse(readFileSync(claudeJsonPath, 'utf8')) } catch { return null }
  if (!raw || typeof raw !== 'object') return null

  const counters: Record<string, number | boolean> = {}
  for (const [src, dst] of COUNTER_KEYS) {
    const v = raw[src]
    if ((typeof v === 'number' && isFinite(v)) || typeof v === 'boolean') counters[dst] = v
  }
  const numStartups = typeof raw.numStartups === 'number' && isFinite(raw.numStartups) ? raw.numStartups : undefined

  // unadopted 仅由计数器判定（一级证据）；阈值取无歧义的 0/false，不照抄 tip 的版本相关阈值。
  const unadopted: string[] = []
  if (counters.memory_usage_count === 0) unadopted.push('memory')
  if (counters.prompt_queue_use_count === 0) unadopted.push('prompt-queue')
  if (counters.has_used_background_task === false) unadopted.push('background-tasks')

  let tips: FeatureAdoptionTip[] | undefined
  const th = raw.tipsHistory
  if (th && typeof th === 'object') {
    const out: FeatureAdoptionTip[] = []
    for (const id of CONDITIONAL_TIPS) {
      const v = (th as Record<string, unknown>)[id]
      if (typeof v === 'number' && isFinite(v)) {
        out.push({
          tip: id,
          last_shown_at_startup: v,
          still_showing: numStartups !== undefined && numStartups - v <= COOLDOWN_STARTUPS,
        })
      }
    }
    if (out.length) tips = out
  }

  if (!Object.keys(counters).length && !tips) return null
  const fa: FeatureAdoption = {
    counters,
    unadopted,
    caveats: [
      'tip-watermark-is-last-shown-startup-not-display-count',
      'tip-conditions-drift-by-cli-version-corroboration-only',
      'evidence-sources-use-different-definitions',
    ],
  }
  if (numStartups !== undefined) fa.num_startups = numStartups
  if (tips) fa.tips = tips
  return fa
}
