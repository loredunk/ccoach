// 端点/计费模式检测（ADR 0022 D2/D3/D4）：账户级**当前快照**，读本机 config 派生白名单标签。
//
// 隐私红线（与 ADR 0016/0017 一致）：只读、瞬时解析、**只留布尔/host 白名单/枚举标签**——
// 绝不存储或输出 key/token 原文、绝不回显完整 base_url URL（custom 端点只标 'custom'，不泄露中转域名）。
// 这是「现在这台机器怎么计费/是否走中转」的当前状态，与 billing 块（历史 token 拆分）正交、不混时间尺度。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type EndpointDetection } from './model.js'

// 官方域名白名单（公开、非敏感，可回显）。第三方/区域端点/自建网关一律归 custom，不回显其域名。
// 维护提示（ADR 0022 开放问题 1）：官方新增域名时在此补充。
const OFFICIAL_HOSTS = new Set<string>(['api.anthropic.com', 'api.openai.com', 'chatgpt.com'])

function readText(path: string): string | null {
  try { return readFileSync(path, 'utf8') } catch { return null }
}
function readJson(path: string): any | null {
  const t = readText(path)
  if (t == null) return null
  try { return JSON.parse(t) } catch { return null }
}

// 从 URL 抽 host（小写、去端口），失败返回空。绝不返回/保存完整 URL。
function hostOf(url: string): string {
  if (typeof url !== 'string' || !url.trim()) return ''
  let u = url.trim()
  if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u // 容忍裸 host
  try { return new URL(u).hostname.toLowerCase() } catch { return '' }
}

// 端点 host → 白名单标签：official(+公开域名) / custom（不回显域名）/ unknown。
function classifyHost(host: string): { endpoint: EndpointDetection['endpoint']; officialHost?: string } {
  if (!host) return { endpoint: 'unknown' }
  if (OFFICIAL_HOSTS.has(host)) return { endpoint: 'official', officialHost: host }
  return { endpoint: 'custom' }
}

// 轻量 TOML 提取：顶层 model_provider = "x"（不进任何 [section] 时的赋值）。
function tomlActiveProvider(toml: string): string | null {
  for (const raw of toml.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) break // 进入第一个 section 即停（只看顶层）
    const m = line.match(/^model_provider\s*=\s*["']([^"']+)["']/)
    if (m) return m[1]
  }
  return null
}
// 找 [model_providers.<name>] 段内首个 base_url = "..."（name 容忍带引号）。
function tomlProviderBaseUrl(toml: string, name: string): string | null {
  const lines = toml.split('\n')
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const header = new RegExp(`^\\[model_providers\\.(?:"?${esc}"?)\\]\\s*$`)
  let inSection = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('[')) { inSection = header.test(line); continue }
    if (inSection) {
      const m = line.match(/^base_url\s*=\s*["']([^"']+)["']/)
      if (m) return m[1]
    }
  }
  return null
}

// ── Codex 端点检测 ───────────────────────────────────────────────────────────
// home = $CODEX_HOME 或 ~/.codex。nonDefaultProviderInJsonl = D2a 历史信号（见 parsers/codex）。
export function detectCodexEndpoint(home: string, nonDefaultProviderInJsonl: boolean): EndpointDetection {
  const basis: string[] = []
  // auth.json → auth_mode（只取枚举标签，绝不读 token/OPENAI_API_KEY 原文）。
  let authMode: string | undefined
  const auth = readJson(join(home, 'auth.json'))
  if (auth && typeof auth === 'object') {
    if (typeof auth.auth_mode === 'string') authMode = auth.auth_mode === 'chatgpt' ? 'chatgpt' : auth.auth_mode === 'apikey' ? 'apikey' : 'other'
    else if (auth.OPENAI_API_KEY) authMode = 'apikey' // 有 key 无 auth_mode → API key 态
    if (authMode) basis.push(`auth_mode:${authMode}`)
  }
  // config.toml → 活跃 model_provider + 其 base_url host。
  let endpoint: EndpointDetection['endpoint'] = 'unknown'
  let officialHost: string | undefined
  const toml = readText(join(home, 'config.toml'))
  if (toml != null) {
    const active = tomlActiveProvider(toml)
    if (!active || active === 'openai') {
      endpoint = 'official'; officialHost = 'chatgpt.com'; basis.push('config:provider=openai')
    } else {
      const baseUrl = tomlProviderBaseUrl(toml, active)
      const host = baseUrl ? hostOf(baseUrl) : ''
      const c = classifyHost(host)
      endpoint = c.endpoint === 'unknown' ? 'custom' : c.endpoint // 自定义 provider 即便没解析出 host 也按 custom
      officialHost = c.officialHost
      basis.push(endpoint === 'official' ? `base_url:official(${officialHost})` : 'config:provider=custom')
    }
  } else {
    endpoint = 'official'; officialHost = 'chatgpt.com'; basis.push('config:default') // 无 config.toml → 官方默认
  }
  if (nonDefaultProviderInJsonl) basis.push('jsonl:non-default-provider')

  // D3 综合 billing_mode + 置信度。中转可伪造 plan_type，故端点非官方一律保守判 api_or_relay。
  let billingMode: EndpointDetection['billing_mode'] = 'unknown'
  let confidence: EndpointDetection['confidence'] = 'low'
  if (endpoint === 'custom') { billingMode = 'api_or_relay'; confidence = 'high' }
  else if (endpoint === 'official') {
    if (authMode === 'chatgpt') { billingMode = 'subscription'; confidence = nonDefaultProviderInJsonl ? 'medium' : 'high' }
    else if (authMode === 'apikey') { billingMode = 'api_or_relay'; confidence = 'high' }
    else { billingMode = 'unknown'; confidence = 'low' }
  }

  const out: EndpointDetection = { platform: 'codex', endpoint, relay_suspected: endpoint === 'custom', non_default_provider: nonDefaultProviderInJsonl, billing_mode: billingMode, confidence, basis }
  if (officialHost) out.official_host = officialHost
  if (authMode) out.auth_mode = authMode
  return out
}

// ── Claude Code 端点检测 ─────────────────────────────────────────────────────
// home = claude 配置目录（projects 的父目录，即 ~/.claude 或 $CLAUDE_CONFIG_DIR）。
export function detectClaudeEndpoint(home: string): EndpointDetection {
  const basis: string[] = []
  // settings.json / settings.local.json 的 env 块（持久信号；不读 process.env 以保证确定性）。
  const envOf = (file: string): Record<string, unknown> => {
    const j = readJson(join(home, file))
    const e = j && typeof j === 'object' ? j.env : null
    return e && typeof e === 'object' ? (e as Record<string, unknown>) : {}
  }
  const env = { ...envOf('settings.json'), ...envOf('settings.local.json') }
  const baseUrl = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : ''
  const hasAuthToken = !!env.ANTHROPIC_AUTH_TOKEN
  const hasApiKey = !!env.ANTHROPIC_API_KEY

  let endpoint: EndpointDetection['endpoint']
  let officialHost: string | undefined
  if (baseUrl) {
    const c = classifyHost(hostOf(baseUrl))
    endpoint = c.endpoint === 'unknown' ? 'custom' : c.endpoint
    officialHost = c.officialHost
    basis.push(endpoint === 'official' ? `base_url:official(${officialHost})` : 'settings:ANTHROPIC_BASE_URL=custom')
  } else {
    endpoint = 'official'; officialHost = 'api.anthropic.com'; basis.push('settings:default') // 无覆写 → 官方默认
  }

  // .credentials.json → claudeAiOauth.subscriptionType（D4 账户订阅档，只取标签）。绝不读 token。
  let subscriptionType: string | undefined
  const creds = readJson(join(home, '.credentials.json'))
  const oauth = creds && typeof creds === 'object' ? creds.claudeAiOauth : null
  if (oauth && typeof oauth === 'object' && typeof oauth.subscriptionType === 'string') subscriptionType = oauth.subscriptionType

  let authMode: string | undefined
  if (hasAuthToken) authMode = 'auth-token'
  else if (hasApiKey) authMode = 'api-key'
  else if (oauth) authMode = 'oauth-subscription'
  if (authMode) basis.push(`auth_mode:${authMode}`)
  if (subscriptionType) basis.push(`subscription:${subscriptionType}`)

  let billingMode: EndpointDetection['billing_mode'] = 'unknown'
  let confidence: EndpointDetection['confidence'] = 'low'
  if (endpoint === 'custom') { billingMode = 'api_or_relay'; confidence = 'high' }
  else if (authMode === 'oauth-subscription') { billingMode = 'subscription'; confidence = 'high' }
  else if (authMode === 'api-key' || authMode === 'auth-token') { billingMode = 'api_or_relay'; confidence = 'medium' }
  else { billingMode = 'unknown'; confidence = 'low' }

  const out: EndpointDetection = { platform: 'claude-code', endpoint, relay_suspected: endpoint === 'custom', billing_mode: billingMode, confidence, basis }
  if (officialHost) out.official_host = officialHost
  if (authMode) out.auth_mode = authMode
  if (subscriptionType) out.subscription_type = subscriptionType
  return out
}
