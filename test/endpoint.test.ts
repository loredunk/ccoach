// test/endpoint.test.ts — 端点/计费模式检测（ADR 0022 D2/D3/D4）
import { describe, it, expect } from 'vitest'
import { detectCodexEndpoint, detectClaudeEndpoint } from '../src/endpoint.js'

const FX = 'test/fixtures/endpoint'
// fixture 里故意塞入的假密钥/中转域名——断言绝不出现在检测输出里。
const SECRETS = ['FAKE_OAUTH', 'FAKE_RELAY', 'FAKE_REFRESH', 'FAKE_ACCESS', 'sk-FAKE', 'cr_FAKE', 'SECRET-HOST', 'https://', 'http://']

describe('detectCodexEndpoint（ADR 0022 D2/D3）', () => {
  it('官方直连：auth_mode=chatgpt + 无 provider 覆写 → official / subscription / high', () => {
    const e = detectCodexEndpoint(`${FX}/codex-official`, false)
    expect(e.endpoint).toBe('official')
    expect(e.official_host).toBe('chatgpt.com')
    expect(e.relay_suspected).toBe(false)
    expect(e.auth_mode).toBe('chatgpt')
    expect(e.billing_mode).toBe('subscription')
    expect(e.confidence).toBe('high')
    expect(e.non_default_provider).toBe(false)
  })

  it('中转：自定义 model_provider + base_url 指向中转域名 → custom / api_or_relay / relay_suspected', () => {
    const e = detectCodexEndpoint(`${FX}/codex-relay`, false)
    expect(e.endpoint).toBe('custom')
    expect(e.relay_suspected).toBe(true)
    expect(e.official_host).toBeUndefined() // 绝不回显中转域名
    expect(e.auth_mode).toBe('apikey') // 有 OPENAI_API_KEY、无 auth_mode → API key 态
    expect(e.billing_mode).toBe('api_or_relay')
    expect(e.confidence).toBe('high')
  })

  it('D2a：历史 JSONL 见过非默认 provider → 即便当前 config 官方，置信降为 medium', () => {
    const e = detectCodexEndpoint(`${FX}/codex-official`, true)
    expect(e.endpoint).toBe('official')
    expect(e.non_default_provider).toBe(true)
    expect(e.billing_mode).toBe('subscription')
    expect(e.confidence).toBe('medium') // 当前官方但历史用过自定义 provider → 降置信
  })
})

describe('detectClaudeEndpoint（ADR 0022 D2/D3/D4）', () => {
  it('官方订阅：无 BASE_URL 覆写 + oauth 凭据 → official / subscription / max', () => {
    const e = detectClaudeEndpoint(`${FX}/claude-official`)
    expect(e.endpoint).toBe('official')
    expect(e.official_host).toBe('api.anthropic.com')
    expect(e.relay_suspected).toBe(false)
    expect(e.auth_mode).toBe('oauth-subscription')
    expect(e.subscription_type).toBe('max') // D4 账户订阅档
    expect(e.billing_mode).toBe('subscription')
    expect(e.confidence).toBe('high')
  })

  it('中转：ANTHROPIC_BASE_URL 非官方 + AUTH_TOKEN → custom / api_or_relay / relay_suspected', () => {
    const e = detectClaudeEndpoint(`${FX}/claude-relay`)
    expect(e.endpoint).toBe('custom')
    expect(e.relay_suspected).toBe(true)
    expect(e.official_host).toBeUndefined()
    expect(e.auth_mode).toBe('auth-token')
    expect(e.subscription_type).toBeUndefined() // 无 oauth 凭据
    expect(e.billing_mode).toBe('api_or_relay')
    expect(e.confidence).toBe('high')
  })

  it('缺所有 config → unknown，不崩', () => {
    const e = detectClaudeEndpoint(`${FX}/does-not-exist`)
    expect(e.endpoint).toBe('official') // 无覆写即默认官方
    expect(e.billing_mode).toBe('unknown') // 但无凭据/auth → 无法判
    expect(e.confidence).toBe('low')
  })
})

describe('端点检测隐私红线：绝不泄露 key/token/完整 URL/中转域名', () => {
  it('所有 fixture 的检测输出都不含任何密钥/域名 sentinel', () => {
    const dirs = ['codex-official', 'codex-relay', 'claude-official', 'claude-relay']
    const detectors = [
      detectCodexEndpoint(`${FX}/codex-official`, true),
      detectCodexEndpoint(`${FX}/codex-relay`, false),
      detectClaudeEndpoint(`${FX}/claude-official`),
      detectClaudeEndpoint(`${FX}/claude-relay`),
    ]
    const blob = JSON.stringify(detectors)
    for (const s of SECRETS) expect(blob).not.toContain(s)
    expect(dirs.length).toBe(detectors.length)
  })
})
