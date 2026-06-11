// render_deepinsight.mjs — standalone HTML for a ccoach-deepinsight semantic root-cause report.
//   node render_deepinsight.mjs --data <report.json> --output <out.html>
// Aesthetic: "diagnostic dossier" — dark editorial console. Instrument Serif display,
// Spectral body, JetBrains Mono for labels/signals/commit ledger. Findings are color-coded
// by root-cause category; metrics are deliberately DEMOTED to a faint "signal" margin line.
// Pure: renderDeepinsight(data) -> html string. CLI wrapper at the bottom. No network at render time.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--data') o.data = argv[++i]
    else if (a === '--output') o.output = argv[++i]
  }
  return o
}

function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

// ---- On-page glossary (回合 / 严重程度 / 原地打转) ----
// Plain-language defs for the jargon the report uses, so a general reader can follow it.
// Bilingual, keyed by locale; product language only — NO internal markers.
const GLOSSARY = {
  zh: {
    head: '术语',
    terms: [
      ['回合 episode', '你下的一条指令 → agent 为它做的整段工作；下一条指令开启下一个回合。'],
      ['原地打转 spiral', 'agent 卡住、在原地兜圈子的回合——反复改同几个文件、命令一直报错、却没往前推进，很费 token。'],
      ['严重程度 severity', '0–6，衡量一个回合「原地打转」的程度：反复改同一个文件、连着报错、没有新进展、耗时异常，加在一起打分；0=完全顺畅，越高越卡。'],
    ],
  },
  en: {
    head: 'Terms',
    terms: [
      ['episode', 'One instruction from you → all the work the agent did for it. The next instruction starts the next episode.'],
      ['spiral (going in circles)', 'An episode where the agent went in circles — same files edited over and over, same errors, no forward progress. Wastes tokens.'],
      ['severity', '0-6 — how badly an episode went in circles. Points add up for: editing the same file again and again, repeated errors, no new progress, taking unusually long. 0 = smooth.'],
    ],
  },
}

function glossarySection() {
  const g = GLOSSARY[LOC] ?? GLOSSARY.en
  const items = g.terms.map(([t, dfn]) => `<div><dt>${esc(t)}</dt><dd>${esc(dfn)}</dd></div>`).join('')
  return `<section class="terms"><div class="terms-k">${esc(g.head)}</div><dl>${items}</dl></section>`
}

// Fixed page chrome, localized (zh reports must not show English jargon chrome). Plain words only.
const CHROME = {
  zh: {
    kicker: 'ccoach · 讲人话的根因教练',
    seal: '只读 · 本地 · 分享前可脱敏',
    ledger: '依据 · 会话窗口内的提交（实锤）',
    notes: '工具自身的局限说明——不是你的行为问题',
    digest: '正文摘要',
    novel: '新类别',
    novelTitle: '从证据里新发现的类别，不在预设分类里',
    fixK: '改法',
    sigK: '信号',
    confK: '置信',
    legend: '分类含义',
    toc: '发现清单 · 点击跳转',
    health: '项目盲区',
    healthBeta: 'Beta',
    healthBetaTitle: '测试版——阶段判定和盲区口径还在校准',
    healthSub: '只指出盲区、布置作业——审计本身交给 agent 下个会话执行 · 本地报告，不进可分享产物',
    healthBasis: '依据',
    healthAttention: { never: '从未出现', touched: '零星出现过', practiced: '已是常规动作' },
    healthNA: '未核查',
    healthLocked: '此阶段未解锁',
    stageK: '阶段判定',
    healthDims: {
      security_data: '安全与数据',
      stability_resources: '稳定性与资源',
      verification_testing: '验证门与测试',
      architecture_layering: '架构分层',
    },
    magic: 'Magic Time',
    magicSub: '平台自己报的数 + 精确计数——不是估算拍脑袋',
    privacy: '本地只读分析。指标只是佐证——根因和改法才是产品。绝不读取思考过程 / 系统提示词 / 文件内容；正文摘要为显式开启、已脱敏、限额读取。',
  },
  en: {
    kicker: 'ccoach · plain-language root-cause coach',
    seal: 'read-only · local · maskable before sharing',
    ledger: 'evidence · commits inside the session window (ground truth)',
    notes: 'tool limits — about the tool, not your behavior',
    digest: 'content summary',
    novel: 'novel',
    novelTitle: 'a category discovered from the evidence, not predefined',
    fixK: 'fix',
    sigK: 'signal',
    confK: 'conf',
    legend: 'categories',
    toc: 'findings · click to jump',
    health: 'Project blind spots',
    healthBeta: 'Beta',
    healthBetaTitle: 'beta — the stage gate and blind-spot buckets are still being calibrated',
    healthSub: 'names blind spots and assigns homework — the audit itself runs in your agent next session · local report, never in anything shareable',
    healthBasis: 'basis',
    healthAttention: { never: 'never came up', touched: 'came up occasionally', practiced: 'a regular practice' },
    healthNA: 'not checked',
    healthLocked: 'not unlocked at this stage',
    stageK: 'stage',
    healthDims: {
      security_data: 'Security & data',
      stability_resources: 'Stability & resources',
      verification_testing: 'Verification gates & tests',
      architecture_layering: 'Architecture & layering',
    },
    magic: 'Magic Time',
    magicSub: 'platform-reported numbers + exact counts — no made-up estimates',
    privacy: 'Local, read-only analysis. Metrics are supporting evidence only — the root cause and the fix are the product. Never reads thinking / system prompts / file contents as content; assistant/tool_result content is opt-in, redacted, token-bounded.',
  },
}
let L = CHROME.en // set per render in renderDeepinsight (single render per process)
let LOC = 'en'

// Category badges are reader-facing and self-explanatory in the report language —
// e.g. unknown_feature renders as "Native feature available", an opportunity, never "Unknown Feature".
// `def` is the one-line plain-language definition for the legend near the top of the report.
const CAT = {
  cognitive_gap: {
    en: 'Knowledge gap', zh: '知识盲区', v: '--c-cog',
    def: { en: 'Something about the domain, code, or tool you did not know yet — it caused a detour.', zh: '对领域、代码或工具有一处还不知道的事，导致绕了路。' },
  },
  prompt_issue: {
    en: 'Prompt wording', zh: '提示词写法', v: '--c-prompt',
    def: { en: 'The way an instruction was phrased sent the agent the wrong way — a rewording avoids it.', zh: '指令的表达方式让 agent 理解偏了——换个说法就能避免。' },
  },
  code_structure: {
    en: 'Code structure', zh: '代码结构', v: '--c-code',
    def: { en: 'The code structure itself made the change hard — the code, not you.', zh: '代码本身的结构让改动变难——问题在代码，不在你。' },
  },
  workflow: {
    en: 'Workflow', zh: '工作流程', v: '--c-flow',
    def: { en: 'A change in the order or process of the work would make the same work cheaper.', zh: '做事的流程顺序可以调整，让同样的工作更省力。' },
  },
  unknown_feature: {
    en: 'Native feature available', zh: '有现成官方特性', v: '--c-feat',
    def: { en: "An official feature already solves this — you just haven't adopted it yet. An opportunity, not a bug.", zh: '平台已有一个现成的官方特性能解决这个问题——你还没用上。这是机会，不是故障。' },
  },
  other: {
    en: 'Other', zh: '其他', v: '--c-other',
    def: { en: 'Findings that fit none of the categories above.', zh: '不属于以上几类的发现。' },
  },
}
// Open taxonomy: an unknown category keeps its own label (neutral color) instead of collapsing to Other.
// Preference: known table (localized) → category_label supplied by the report → title-cased key.
// Object.hasOwn guards keep prototype keys ('constructor', 'toString'…) on the fallback path.
const knownCat = (k) => typeof k === 'string' && Object.hasOwn(CAT, k)
const cat = (k, categoryLabel) => {
  if (knownCat(k)) return { label: CAT[k][LOC] ?? CAT[k].en, v: CAT[k].v }
  if (categoryLabel) return { label: String(categoryLabel), v: '--c-other' }
  const label = String(k || '').trim().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return label ? { label, v: '--c-other' } : { label: CAT.other[LOC] ?? CAT.other.en, v: CAT.other.v }
}

// Legend: only the known categories that actually appear in this report, each with its plain definition.
function legendSection(passes) {
  const seen = new Set()
  for (const p of passes || []) for (const f of p.findings || []) if (f && knownCat(f.category)) seen.add(f.category)
  if (!seen.size) return ''
  const rows = Object.keys(CAT)
    .filter((k) => seen.has(k))
    .map((k) => {
      const c = CAT[k]
      return `<div class='lg-row' style='--cat: var(${c.v})'><span class='chip'>${esc(c[LOC] ?? c.en)}</span><span class='lg-d'>${esc(c.def[LOC] ?? c.def.en)}</span></div>`
    })
    .join('')
  return `<section class='legend'><div class='legend-k'>${esc(L.legend)}</div>${rows}</section>`
}

const CONF = { high: 3, med: 2, medium: 2, low: 1 }
function confMeter(level) {
  const n = CONF[String(level || '').toLowerCase()] ?? 0
  const bars = [0, 1, 2].map((i) => `<i class='${i < n ? 'on' : ''}'></i>`).join('')
  return `<span class='conf' title='${esc(L.confK)}: ${esc(level || 'n/a')}'><span class='conf-k'>${esc(L.confK)}</span><span class='conf-bars'>${bars}</span></span>`
}

// Project blind spots (Beta) — coach, not auditor. Stage-gated: only dimensions the project's
// stage warrants are assessed; the rest render as quiet locked rows. Each unlocked dimension is a
// verifiable behavior/presence statement ("this never came up in your sessions"), never an audit
// verdict; homework hands the actual audit to the agent. Omitted attention = not checked, never zero.
const ATTENTION = {
  never: { fill: '0%', tone: '--c-risk' },
  touched: { fill: '50%', tone: '--accent' },
  practiced: { fill: '100%', tone: '--c-flow' },
}

function healthDimensions(h) {
  if (!h || !Array.isArray(h.dimensions)) return []
  return h.dimensions.filter((d) => d && typeof d === 'object')
}

function healthSection(h) {
  const dims = healthDimensions(h)
  if (!dims.length) return ''
  const stage = h.stage && (h.stage.label || h.stage.basis)
    ? `<div class='stage'><span class='stage-k'>${esc(L.stageK)}</span><b>${esc(h.stage.label ?? '')}</b>` +
      (h.stage.basis ? `<span class='stage-b'>${esc(h.stage.basis)}</span>` : '') +
      (h.stage.note ? `<div class='stage-n'>${esc(h.stage.note)}</div>` : '') +
      `</div>`
    : ''
  const rows = dims
    .map((dim) => {
      const label = Object.hasOwn(L.healthDims, dim.id)
        ? L.healthDims[dim.id]
        : dim.label
          ? String(dim.label)
          : String(dim.id || '')
      if (dim.locked) {
        return (
          `<div class='hd hd-locked'>` +
          `<div class='hd-h'><span class='hd-l'>${esc(label)}</span><span class='hd-track hd-off'></span><span class='hd-lv'>${esc(L.healthLocked)}</span></div>` +
          (dim.statement ? `<p class='cause'>${esc(dim.statement)}</p>` : '') +
          `</div>`
        )
      }
      const att = typeof dim.attention === 'string' && Object.hasOwn(ATTENTION, dim.attention) ? dim.attention : null
      const word = att
        ? `<span class='hd-lv' style='color:var(${ATTENTION[att].tone})'>${esc(L.healthAttention[att])}</span>`
        : `<span class='hd-lv'>${esc(L.healthNA)}</span>`
      const track = att
        ? `<span class='hd-track' style='--hf:${ATTENTION[att].fill};--hb:var(${ATTENTION[att].tone})'><i></i></span>`
        : `<span class='hd-track hd-off'></span>`
      const feature = dim.feature ? ` <span class='feat'>${esc(dim.feature)}</span>` : ''
      const homework = dim.homework ? fixBlock(`${esc(dim.homework)}${feature}`) : ''
      const basis = dim.basis
        ? `<div class='hd-ev'><span class='hd-ev-k'>${esc(L.healthBasis)}</span> ${esc(dim.basis)}</div>`
        : ''
      return (
        `<div class='hd${att ? '' : ' hd-unassessed'}'>` +
        `<div class='hd-h'><span class='hd-l'>${esc(label)}</span>${track}${word}</div>` +
        (dim.statement ? `<p class='cause'>${esc(dim.statement)}</p>` : '') +
        homework + basis +
        `</div>`
      )
    })
    .join('')
  return (
    `<section class='health' id='project-health'>` +
    `<div class='health-h'><span class='health-k'>${esc(L.health)}</span><span class='chip chip-beta' title='${esc(L.healthBetaTitle)}'>${esc(L.healthBeta)}</span></div>` +
    `<div class='health-sub'>${esc(L.healthSub)}</div>` +
    stage +
    (h.summary ? `<p class='headline'>${esc(h.summary)}</p>` : '') +
    `<div class='hds'>${rows}</div>` +
    `</section>`
  )
}

// Findings table of contents — generated by the renderer from the findings themselves
// (the report JSON never carries a TOC). Pure anchor links, no JS. hasHealth is derived from
// the already-rendered health section, so the link and its target cannot disagree.
function tocSection(passes, hasHealth) {
  const entries = (passes || []).map((p, pi) => [p, pi]).filter(([p]) => (p.findings || []).length)
  if (!entries.length && !hasHealth) return ''
  const grouped = entries.length > 1
  const groups = entries
    .map(([p, pi]) => {
      const rows = (p.findings || [])
        .map((f, i) => {
          const c = cat(f.category, f.category_label)
          return `<li><a href='#f-${pi}-${i}'><span class='chip' style='--cat: var(${c.v})'>${esc(c.label)}</span><span class='toc-t'>${esc(f.title)}</span></a></li>`
        })
        .join('')
      const head = grouped ? `<div class='toc-g'>${esc([p.kind, p.title].filter(Boolean).join(' · '))}</div>` : ''
      return `${head}<ol class='toc-l'>${rows}</ol>`
    })
    .join('')
  const healthRow = hasHealth
    ? `<ol class='toc-l toc-x'><li><a href='#project-health'><span class='chip' style='--cat: var(--accent2)'>${esc(L.healthBeta)}</span><span class='toc-t'>${esc(L.health)}</span></a></li></ol>`
    : ''
  return `<nav class='toc'><div class='toc-k'>${esc(L.toc)}</div>${groups}${healthRow}</nav>`
}

// Shared "fix" highlight block — used by finding cards and blind-spot homework rows.
function fixBlock(bodyHtml) {
  return `<div class='fix'><span class='fix-k'>${esc(L.fixK)}</span><div class='fix-b'>${bodyHtml}</div></div>`
}

function findingCard(f, i, passIdx) {
  const c = cat(f.category, f.category_label)
  const feature = f.feature
    ? `<span class='feat'>${esc(f.feature)}</span>`
    : ''
  const fix = f.fix ? fixBlock(`${esc(f.fix)} ${feature}`) : ''
  const signal = f.signal
    ? `<div class='signal'><span class='sig-k'>${esc(L.sigK)}</span> ${esc(f.signal)}</div>`
    : ''
  const novel = f.novel_category === true
    ? `<span class='chip chip-novel' title='${esc(L.novelTitle)}'>${esc(L.novel)}</span>`
    : ''
  return (
    `<article class='card' id='f-${Number(passIdx) || 0}-${i}' style='--cat: var(${c.v})' data-i='${i}'>` +
    `<header class='card-h'>` +
    `<span class='chips'><span class='chip'>${esc(c.label)}</span>${novel}</span>` +
    confMeter(f.confidence) +
    `</header>` +
    `<h3>${esc(f.title)}</h3>` +
    (f.root_cause ? `<p class='cause'>${esc(f.root_cause)}</p>` : '') +
    fix +
    signal +
    `</article>`
  )
}

function groundingLedger(rows) {
  if (!Array.isArray(rows) || !rows.length) return ''
  const items = rows
    .map(
      (r) =>
        `<li><code class='h'>${esc(r.hash)}</code><span class='t'>${esc(r.ts)}</span><span class='s'>${esc(r.subject)}</span></li>`,
    )
    .join('')
  return (
    `<div class='ledger'><div class='ledger-k'>${esc(L.ledger)}</div>` +
    `<ol class='ledger-l'>${items}</ol></div>`
  )
}

function verdictBanner(v) {
  if (!v || !v.label) return ''
  const tone = ['healthy', 'churn', 'mixed'].includes(v.tone) ? v.tone : 'mixed'
  return `<div class='verdict ${tone}'><span class='v-dot'></span><b>${esc(v.label)}</b>${v.note ? `<span class='v-note'>${esc(v.note)}</span>` : ''}</div>`
}

function passSection(p, idx) {
  const meta = p.meta ? `<span class='pass-meta'>${esc(p.meta)}</span>` : ''
  const head =
    `<div class='pass-h'>` +
    `<span class='pass-n'>${esc(p.id || String(idx + 1).padStart(2, '0'))}</span>` +
    `<div><div class='pass-kind'>${esc(p.kind || 'PASS')}</div><h2>${esc(p.title || '')}</h2>${meta}</div>` +
    `</div>`
  const verdict = verdictBanner(p.verdict)
  const headline = p.headline ? `<p class='headline'>${esc(p.headline)}</p>` : ''
  const ledger = groundingLedger(p.grounding)
  const stats = p.digest_stats ? `<div class='dstats'><span class='ds-k'>${esc(L.digest)}</span> ${esc(p.digest_stats)}</div>` : ''
  const cards = (p.findings || []).map((f, i) => findingCard(f, i, idx)).join('')
  return (
    `<section class='pass' id='pass-${idx}' style='--d:${idx}'>` +
    head + verdict + headline + ledger + stats +
    `<div class='cards'>${cards}</div>` +
    `</section>`
  )
}

// Magic Time — Codex-flavored highlight strip: big numbers the PLATFORM ITSELF reported
// (e.g. fast-mode time saved) or exact counts (accepted approval rules, subagents spawned).
// Each item: { value, unit?, label, basis, tone? win|loss|neutral }. basis is mandatory by
// schema discipline — a magic number with no provenance line is not rendered as magic, it is noise.
function magicSection(items) {
  if (!Array.isArray(items) || !items.length) return ''
  const cards = items
    .map((m) => {
      const tone = m.tone === 'win' ? 'mt-win' : m.tone === 'loss' ? 'mt-loss' : 'mt-neutral'
      const unit = m.unit ? `<span class='mt-unit'>${esc(m.unit)}</span>` : ''
      return (
        `<div class='mt-card ${tone}'>` +
        `<div class='mt-v'>${esc(m.value ?? '')}${unit}</div>` +
        `<div class='mt-l'>${esc(m.label ?? '')}</div>` +
        (m.basis ? `<div class='mt-b'>${esc(m.basis)}</div>` : '') +
        `</div>`
      )
    })
    .join('')
  return (
    `<section class='magic'>` +
    `<div class='magic-h'><span class='magic-k'>${esc(L.magic)}</span><span class='magic-sub'>${esc(L.magicSub)}</span></div>` +
    `<div class='mt-grid'>${cards}</div>` +
    `</section>`
  )
}

const GRAIN =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>"

export function renderDeepinsight(data) {
  const d = data || {}
  const loc = String(d.lang ?? '').startsWith('zh') ? 'zh' : 'en'
  L = CHROME[loc] ?? CHROME.en
  LOC = loc
  const passes = (d.passes || []).map((p, i) => passSection(p, i)).join('')
  const health = healthSection(d.project_health)
  const honesty =
    Array.isArray(d.honesty) && d.honesty.length
      ? `<section class='notes'><div class='notes-k'>${esc(L.notes)}</div><ul>${d.honesty
          .map((h) => `<li>${esc(h)}</li>`)
          .join('')}</ul></section>`
      : ''
  const meta = [
    d.project ? `project · ${esc(d.project)}` : '',
    d.platform ? `platform · ${esc(d.platform)}` : '',
    d.window ? `window · ${esc(d.window)}` : '',
    d.generated_at ? `generated · ${esc(d.generated_at)}` : '',
  ]
    .filter(Boolean)
    .map((m) => `<span>${m}</span>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="${esc(loc === 'zh' ? 'zh-CN' : 'en')}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>deep insight · ${esc(d.project || 'report')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{
  --ink:#0b0c0f; --ink2:#101319; --panel:#14171e; --panel2:#181c25;
  --paper:#ece6da; --muted:#8b8f99; --faint:#5b606b; --rule:#262b34;
  --accent:#e9b949; --accent2:#f4d488;
  --c-cog:#e9b949; --c-prompt:#5fc9d6; --c-code:#b98cff; --c-flow:#7bd88f; --c-feat:#6aa6ff; --c-other:#9aa0ab; --c-risk:#e0705f;
  --serif:"Spectral",Georgia,serif; --disp:"Instrument Serif",Georgia,serif; --mono:"JetBrains Mono",ui-monospace,monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{
  margin:0; background:var(--ink); color:var(--paper);
  font-family:var(--serif); font-size:17px; line-height:1.6; letter-spacing:.005em;
  background-image:
    linear-gradient(var(--rule) 1px,transparent 1px),
    linear-gradient(90deg,var(--rule) 1px,transparent 1px);
  background-size:64px 64px,64px 64px; background-position:-1px -1px;
}
body::before{content:"";position:fixed;inset:0;background:radial-gradient(1200px 700px at 78% -8%,rgba(233,185,73,.10),transparent 60%),radial-gradient(900px 600px at -5% 20%,rgba(106,166,255,.06),transparent 55%);pointer-events:none;z-index:0}
body::after{content:"";position:fixed;inset:0;background-image:url("${GRAIN}");opacity:.035;mix-blend-mode:overlay;pointer-events:none;z-index:0}
.wrap{position:relative;z-index:1;max-width:920px;margin:0 auto;padding:clamp(28px,5vw,72px) clamp(20px,5vw,56px) 96px}

/* masthead */
.mast{border-bottom:1px solid var(--rule);padding-bottom:28px;margin-bottom:44px}
.kicker{font-family:var(--mono);font-size:11.5px;letter-spacing:.32em;text-transform:uppercase;color:var(--accent);margin:0 0 10px}
.mast h1{font-family:var(--disp);font-weight:400;font-size:clamp(56px,12vw,128px);line-height:.86;margin:0;letter-spacing:-.01em}
.mast h1 em{font-style:italic;color:var(--accent2)}
.metastrip{display:flex;flex-wrap:wrap;gap:6px 22px;margin-top:22px;font-family:var(--mono);font-size:11.5px;color:var(--muted);letter-spacing:.04em}
.seal{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--rule);border-radius:100px;padding:5px 12px;font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-top:18px}
.seal::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--c-flow);box-shadow:0 0 9px var(--c-flow)}

/* tldr — readable lead paragraph (not a display-size column) */
.tldr{font-family:var(--serif);font-size:clamp(18px,2.1vw,22px);line-height:1.62;margin:0 0 30px;color:var(--paper);max-width:62ch;border-left:2px solid var(--accent);padding-left:20px}
.tldr::first-letter{color:var(--accent)}

/* findings toc — renderer-generated anchor list */
.toc{border:1px solid var(--rule);border-radius:4px;background:var(--ink2);padding:18px 22px 14px;margin:0 0 44px}
.toc-k{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin-bottom:12px}
.toc-g{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:14px 0 6px}
.toc-l{list-style:decimal-leading-zero;margin:0;padding-left:36px}
.toc-l li{margin:8px 0;font-family:var(--mono);font-size:12px;color:var(--faint)}
.toc-l a{display:inline-flex;gap:10px;align-items:baseline;color:var(--paper);text-decoration:none}
.toc-l .chip{flex:0 0 auto}
.toc-t{font-family:var(--serif);font-size:15.5px;line-height:1.4;border-bottom:1px dotted var(--rule)}
.toc-l a:hover .toc-t{color:var(--accent2);border-bottom-color:var(--accent2)}

/* glossary / 术语 strip */
.terms{border:1px dashed var(--rule);border-radius:4px;padding:16px 22px;margin:0 0 44px;background:rgba(255,255,255,.012)}
.terms-k{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--c-prompt);margin-bottom:11px}
.terms dl{margin:0}
.terms dl>div{margin:9px 0}
.terms dt{font-family:var(--mono);font-size:13px;color:var(--accent2);font-weight:500;letter-spacing:.02em}
.terms dd{margin:4px 0 0;font-size:14.5px;line-height:1.55;color:var(--muted)}

/* category legend */
.legend{border:1px dashed var(--rule);border-radius:4px;padding:16px 22px;margin:-28px 0 44px;background:rgba(255,255,255,.012)}
.legend-k{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--c-feat);margin-bottom:11px}
.lg-row{display:flex;gap:12px;align-items:baseline;margin:8px 0}
.lg-row .chip{flex:0 0 auto}
.lg-d{font-size:14.5px;line-height:1.55;color:var(--muted)}

/* pass */
.pass{margin:0 0 70px;opacity:0;transform:translateY(16px);animation:rise .7s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:calc(var(--d,0)*.12s + .1s)}
.pass-h{display:flex;gap:20px;align-items:baseline;border-top:1px solid var(--rule);padding-top:20px;margin-bottom:26px}
.pass-n{font-family:var(--disp);font-size:clamp(40px,7vw,72px);line-height:.8;color:var(--faint)}
.pass-kind{font-family:var(--mono);font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:var(--accent)}
.pass-h h2{font-family:var(--disp);font-weight:400;font-size:clamp(28px,5vw,44px);margin:2px 0 0;letter-spacing:-.01em}
.pass-meta{display:block;font-family:var(--mono);font-size:11.5px;color:var(--muted);margin-top:7px;letter-spacing:.03em}

/* verdict */
.verdict{display:flex;align-items:center;gap:11px;flex-wrap:wrap;border:1px solid var(--rule);border-left:3px solid var(--c-flow);background:linear-gradient(90deg,rgba(123,216,143,.07),transparent);padding:13px 16px;border-radius:3px;margin:0 0 18px;font-family:var(--mono);font-size:12.5px;letter-spacing:.04em}
.verdict.churn{border-left-color:var(--c-prompt);background:linear-gradient(90deg,rgba(95,201,214,.07),transparent)}
.verdict.mixed{border-left-color:var(--accent);background:linear-gradient(90deg,rgba(233,185,73,.07),transparent)}
.verdict b{color:var(--paper);text-transform:uppercase;letter-spacing:.1em}
.verdict .v-dot{width:8px;height:8px;border-radius:50%;background:var(--c-flow)}
.verdict.churn .v-dot{background:var(--c-prompt)} .verdict.mixed .v-dot{background:var(--accent)}
.verdict .v-note{color:var(--muted);font-family:var(--serif);font-size:14px}
.headline{font-family:var(--serif);font-size:18px;color:var(--paper);border-left:1px solid var(--rule);padding-left:16px;margin:0 0 22px;max-width:60ch}

/* grounding ledger */
.ledger{border:1px solid var(--rule);border-radius:3px;background:var(--ink2);padding:14px 16px;margin:0 0 22px}
.ledger-k{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);margin-bottom:10px}
.ledger-l{list-style:none;margin:0;padding:0;font-family:var(--mono);font-size:12px}
.ledger-l li{display:grid;grid-template-columns:78px 168px 1fr;gap:12px;padding:5px 0;border-top:1px dotted var(--rule);align-items:baseline}
.ledger-l li:first-child{border-top:0}
.ledger-l .h{color:var(--accent)} .ledger-l .t{color:var(--faint)} .ledger-l .s{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dstats{font-family:var(--mono);font-size:11.5px;color:var(--muted);margin:-8px 0 22px}
.dstats .ds-k{color:var(--c-feat);letter-spacing:.14em;text-transform:uppercase;margin-right:8px}

/* cards */
.cards{display:flex;flex-direction:column;gap:16px}
.card{position:relative;background:var(--panel);border:1px solid var(--rule);border-left:3px solid var(--cat);border-radius:4px;padding:20px 22px 18px;transition:transform .25s,border-color .25s,background .25s;scroll-margin-top:24px}
.card:hover{transform:translateX(3px);background:var(--panel2);border-color:color-mix(in srgb,var(--cat) 45%,var(--rule))}
.card-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:11px}
.chips{display:inline-flex;gap:6px;align-items:center}
.chip{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--cat);border:1px solid color-mix(in srgb,var(--cat) 40%,transparent);background:color-mix(in srgb,var(--cat) 9%,transparent);padding:3px 9px;border-radius:100px}
.chip-novel,.chip-beta{color:var(--accent2);border-color:color-mix(in srgb,var(--accent2) 40%,transparent);background:color-mix(in srgb,var(--accent2) 9%,transparent);border-style:dashed}
.conf{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.conf-bars{display:inline-flex;gap:3px}
.conf-bars i{width:14px;height:4px;border-radius:2px;background:var(--rule)}
.conf-bars i.on{background:var(--cat)}
.card h3{font-family:var(--serif);font-weight:600;font-size:20px;line-height:1.25;margin:0 0 8px;letter-spacing:-.005em}
.cause{margin:0;color:#cfcabf}
.fix{display:flex;gap:12px;margin-top:16px;padding:13px 16px;background:linear-gradient(90deg,rgba(233,185,73,.10),rgba(233,185,73,.03));border-left:3px solid var(--accent);border-radius:4px}
.fix-k{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink);background:var(--accent);padding:3px 8px;border-radius:3px;font-weight:700;align-self:flex-start;flex:0 0 auto;margin-top:3px}
.fix-b{color:var(--paper);font-size:16px}
.feat{display:inline-block;font-family:var(--mono);font-size:11.5px;color:var(--ink);background:var(--accent);padding:1px 8px;border-radius:3px;font-weight:500;white-space:nowrap}
.signal{margin-top:12px;font-family:var(--mono);font-size:10.5px;color:var(--faint);letter-spacing:.02em;opacity:.78}
.signal .sig-k{text-transform:uppercase;letter-spacing:.16em;color:color-mix(in srgb,var(--cat) 55%,var(--faint));margin-right:7px}

/* project blind spots (beta) */
.health{border:1px solid var(--rule);border-radius:4px;background:var(--ink2);padding:22px 24px 20px;margin:0 0 56px;scroll-margin-top:24px}
.health-h{display:flex;align-items:center;gap:10px}
.health-k{font-family:var(--mono);font-size:11.5px;letter-spacing:.28em;text-transform:uppercase;color:var(--accent)}
.health-sub{font-family:var(--mono);font-size:10.5px;color:var(--faint);margin:8px 0 18px;letter-spacing:.04em}
.stage{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;border:1px solid var(--rule);border-left:3px solid var(--c-prompt);background:linear-gradient(90deg,rgba(95,201,214,.06),transparent);border-radius:3px;padding:11px 14px;margin:0 0 16px;font-family:var(--mono);font-size:11.5px;letter-spacing:.04em}
.stage-k{text-transform:uppercase;letter-spacing:.16em;color:var(--c-prompt)}
.stage b{color:var(--paper);letter-spacing:.08em}
.stage-b{color:var(--muted)}
.stage-n{flex-basis:100%;font-family:var(--serif);font-size:13.5px;color:var(--faint)}
.hds{display:flex;flex-direction:column;gap:18px}
.hd{border-top:1px dotted var(--rule);padding-top:16px}
.hd-h{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px}
.hd-l{font-family:var(--serif);font-weight:600;font-size:17px;color:var(--paper)}
.hd-track{position:relative;flex:0 0 130px;height:6px;border-radius:3px;background:var(--rule);overflow:hidden}
.hd-track i{position:absolute;left:0;top:0;bottom:0;width:var(--hf,0%);background:var(--hb,var(--accent));border-radius:3px}
.hd-off{background:transparent;border:1px dashed var(--rule)}
.hd-lv{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.hd-unassessed .hd-lv,.hd-locked .hd-lv{color:var(--faint)}
.hd-locked .hd-l{color:var(--muted);font-weight:500}
.hd-ev{margin-top:10px;font-family:var(--mono);font-size:10.5px;color:var(--faint);opacity:.78}
.hd-ev-k{text-transform:uppercase;letter-spacing:.16em;margin-right:7px}

/* notes + footer */
.notes{border:1px dashed var(--rule);border-radius:4px;padding:18px 22px;margin:0 0 40px;background:rgba(255,255,255,.012)}
.notes-k{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--c-other);margin-bottom:10px}
.notes ul{margin:0;padding-left:18px;color:var(--muted);font-size:15px}
.notes li{margin:5px 0}
/* magic time — highlight strip (platform-reported numbers + exact counts) */
.magic{margin:0 0 44px}
.magic-h{display:flex;align-items:baseline;gap:14px;margin-bottom:14px}
.magic-k{font-family:var(--mono);font-size:11.5px;letter-spacing:.32em;text-transform:uppercase;color:var(--accent)}
.magic-sub{font-family:var(--mono);font-size:10.5px;color:var(--faint);letter-spacing:.04em}
.mt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.mt-card{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:16px 16px 13px;position:relative;overflow:hidden}
.mt-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--c-other)}
.mt-win::before{background:var(--c-flow)}
.mt-loss::before{background:var(--c-cog)}
.mt-v{font-family:var(--disp);font-size:clamp(30px,4.4vw,44px);line-height:1;letter-spacing:-.01em}
.mt-unit{font-size:.45em;color:var(--muted);margin-left:5px;letter-spacing:.02em}
.mt-l{font-size:13.5px;line-height:1.45;color:var(--paper);margin-top:8px}
.mt-b{font-family:var(--mono);font-size:10px;color:var(--faint);margin-top:7px;letter-spacing:.02em;line-height:1.5}
.foot{border-top:1px solid var(--rule);padding-top:20px;font-family:var(--mono);font-size:11px;color:var(--faint);letter-spacing:.03em;line-height:1.7}
@keyframes rise{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.pass{animation:none;opacity:1;transform:none}}
@media (max-width:680px){
  body{background-size:44px 44px,44px 44px}
  .ledger-l li{grid-template-columns:1fr;gap:1px}
  .pass-h{flex-direction:column;gap:6px}
}
</style>
</head>
<body>
<div class="wrap">
  <header class="mast">
    <p class="kicker">${esc(L.kicker)}</p>
    <h1>Deep&nbsp;<em>Insight</em></h1>
    <div class="metastrip">${meta}</div>
    <span class="seal">${esc(L.seal)}</span>
  </header>
  ${d.tldr ? `<p class="tldr">${esc(d.tldr)}</p>` : ''}
  ${tocSection(d.passes, Boolean(health))}
  ${glossarySection()}
  ${legendSection(d.passes)}
  ${magicSection(d.magic_time)}
  ${passes}
  ${health}
  ${honesty}
  <footer class="foot">${esc(d.privacy || L.privacy)}</footer>
</div>
</body>
</html>`
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2))
  if (!a.data || !a.output) {
    process.stderr.write('usage: node render_deepinsight.mjs --data <report.json> --output <out.html>\n')
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(a.data, 'utf8'))
  writeFileSync(a.output, renderDeepinsight(data))
  process.stdout.write(`wrote ${a.output}\n`)
}
