// test/human-prompt.test.ts — single source of truth for the ADR-0043 human-prompt gate.
import { describe, it, expect } from 'vitest'
import { isHumanPrompt } from '../src/human-prompt.js'

describe('isHumanPrompt — machine-injected user records are not real prompts (ADR 0043)', () => {
  it('rejects isMeta records (system reminders / caveats / command-output injection)', () => {
    expect(isHumanPrompt({ isMeta: true }, '<system-reminder>background</system-reminder>')).toBe(false)
  })
  it('rejects slash command stubs', () => {
    expect(isHumanPrompt({}, '<command-name>/clear</command-name><command-message>clear</command-message>')).toBe(false)
    expect(isHumanPrompt({}, '<local-command-stdout>some output</local-command-stdout>')).toBe(false)
  })
  it('rejects the interrupt sentinel', () => {
    expect(isHumanPrompt({}, '[Request interrupted by user]')).toBe(false)
  })
  it('rejects empty / whitespace-only text', () => {
    expect(isHumanPrompt({}, '   ')).toBe(false)
  })
  it('accepts a genuine human instruction', () => {
    expect(isHumanPrompt({}, 'please refactor src/parser.ts and must keep existing tests')).toBe(true)
  })
})
