// test/version.test.ts
// 锁定 CLI 自报版本 == package.json.version，防止 release bump 后 `--version` 漂移（曾写死 0.1.0）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { VERSION } from '../src/index.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('VERSION', () => {
  it('matches package.json version (no drift on release)', () => {
    expect(VERSION).toBe(pkg.version)
  })
})
