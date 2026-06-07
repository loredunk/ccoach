#!/usr/bin/env node
// Docs lint: ADR numbering/status sanity + relative-link resolution.
// Run: node tools/check_adrs.mjs   (exit 0 = ok, 1 = problems found)
//
// Pure Node ≥18 (ESM, no external deps).
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DOCS = path.join(ROOT, 'docs')
const ADR = path.join(DOCS, 'adr')
const LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g
const STATUS_RE = /状态[:：]/

function walkMd(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkMd(fp))
    else if (e.name.endsWith('.md')) out.push(fp)
  }
  return out
}

function checkAdrs(errors) {
  const seen = new Map()
  const files = readdirSync(ADR)
    .filter((n) => n.endsWith('.md'))
    .sort()
  for (const name of files) {
    const m = name.match(/^(\d{4})-.*\.md$/)
    if (!m) {
      errors.push(`ADR filename not NNNN-*.md: ${name}`)
      continue
    }
    const num = m[1]
    if (seen.has(num)) errors.push(`duplicate ADR number ${num}: ${name} & ${seen.get(num)}`)
    seen.set(num, name)
    const text = readFileSync(path.join(ADR, name), 'utf8')
    if (!STATUS_RE.test(text)) errors.push(`${name}: missing 状态 field`)
  }
  if (seen.size === 0) errors.push('no ADR files found')
}

/** Strip fenced code blocks so example links inside ``` aren't checked. */
function stripFencedBlocks(text) {
  return text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '')
}

function checkLinks(errors) {
  for (const fp of walkMd(DOCS).sort()) {
    const text = stripFencedBlocks(readFileSync(fp, 'utf8'))
    for (const match of text.matchAll(LINK_RE)) {
      const target = match[1].trim()
      if (/^(https?:\/\/|#|mailto:)/.test(target)) continue
      const t = target.split('#')[0].split('?')[0]
      if (!t) continue
      if (!existsSync(path.resolve(path.dirname(fp), t))) {
        errors.push(`${path.relative(ROOT, fp)}: broken link -> ${target}`)
      }
    }
  }
}

const errors = []
checkAdrs(errors)
checkLinks(errors)
if (errors.length) {
  console.log('docs lint FAILED:')
  for (const e of errors) console.log('  -', e)
  process.exit(1)
}
console.log('docs lint OK: ADR numbering/status valid, all relative links resolve.')
