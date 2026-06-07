// render_deepinsight.mjs — standalone HTML for a ccoach-deepinsight semantic root-cause report.
//   node render_deepinsight.mjs --data <report.json> --output <out.html>
// Aesthetic: "diagnostic dossier" — dark editorial console. Instrument Serif display,
// Spectral body, JetBrains Mono for labels/signals/commit ledger. Findings are color-coded
// by root-cause category; metrics are deliberately DEMOTED to a faint "signal" margin line.
// Pure: renderDeepinsight(data) -> html string. CLI wrapper at the bottom. No network at render time.
import { readFileSync, writeFileSync } from 'node:fs'

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

const CAT = {
  cognitive_gap: { label: 'Cognitive Gap', v: '--c-cog' },
  prompt_issue: { label: 'Prompt', v: '--c-prompt' },
  code_structure: { label: 'Code Structure', v: '--c-code' },
  workflow: { label: 'Workflow', v: '--c-flow' },
  unknown_feature: { label: 'Unknown Feature', v: '--c-feat' },
  other: { label: 'Other', v: '--c-other' },
}
const cat = (k) => CAT[k] || CAT.other

const CONF = { high: 3, med: 2, medium: 2, low: 1 }
function confMeter(level) {
  const n = CONF[String(level || '').toLowerCase()] ?? 0
  const bars = [0, 1, 2].map((i) => `<i class='${i < n ? 'on' : ''}'></i>`).join('')
  return `<span class='conf' title='confidence: ${esc(level || 'n/a')}'><span class='conf-k'>conf</span><span class='conf-bars'>${bars}</span></span>`
}

function findingCard(f, i) {
  const c = cat(f.category)
  const feature = f.feature
    ? `<span class='feat'>${esc(f.feature)}</span>`
    : ''
  const fix = f.fix
    ? `<div class='fix'><span class='fix-k'>fix</span><div class='fix-b'>${esc(f.fix)} ${feature}</div></div>`
    : ''
  const signal = f.signal
    ? `<div class='signal'><span class='sig-k'>signal</span> ${esc(f.signal)}</div>`
    : ''
  return (
    `<article class='card' style='--cat: var(${c.v})' data-i='${i}'>` +
    `<header class='card-h'>` +
    `<span class='chip'>${esc(c.label)}</span>` +
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
    `<div class='ledger'><div class='ledger-k'>grounding · in-window commits (ground truth)</div>` +
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
  const stats = p.digest_stats ? `<div class='dstats'><span class='ds-k'>digest</span> ${esc(p.digest_stats)}</div>` : ''
  const cards = (p.findings || []).map((f, i) => findingCard(f, i)).join('')
  return (
    `<section class='pass' style='--d:${idx}'>` +
    head + verdict + headline + ledger + stats +
    `<div class='cards'>${cards}</div>` +
    `</section>`
  )
}

const GRAIN =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>"

export function renderDeepinsight(data) {
  const d = data || {}
  const passes = (d.passes || []).map((p, i) => passSection(p, i)).join('')
  const honesty =
    Array.isArray(d.honesty) && d.honesty.length
      ? `<section class='notes'><div class='notes-k'>instrument notes — tool limits, not your behavior</div><ul>${d.honesty
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
<html lang="en">
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
  --c-cog:#e9b949; --c-prompt:#5fc9d6; --c-code:#b98cff; --c-flow:#7bd88f; --c-feat:#6aa6ff; --c-other:#9aa0ab;
  --serif:"Spectral",Georgia,serif; --disp:"Instrument Serif",Georgia,serif; --mono:"JetBrains Mono",ui-monospace,monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
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

/* tldr */
.tldr{font-family:var(--disp);font-style:italic;font-size:clamp(24px,4.2vw,38px);line-height:1.28;margin:0 0 64px;color:var(--paper);max-width:30ch}
.tldr::first-letter{color:var(--accent)}

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
.card{position:relative;background:var(--panel);border:1px solid var(--rule);border-left:3px solid var(--cat);border-radius:4px;padding:20px 22px 18px;transition:transform .25s,border-color .25s,background .25s}
.card:hover{transform:translateX(3px);background:var(--panel2);border-color:color-mix(in srgb,var(--cat) 45%,var(--rule))}
.card-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:11px}
.chip{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--cat);border:1px solid color-mix(in srgb,var(--cat) 40%,transparent);background:color-mix(in srgb,var(--cat) 9%,transparent);padding:3px 9px;border-radius:100px}
.conf{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.conf-bars{display:inline-flex;gap:3px}
.conf-bars i{width:14px;height:4px;border-radius:2px;background:var(--rule)}
.conf-bars i.on{background:var(--cat)}
.card h3{font-family:var(--serif);font-weight:600;font-size:20px;line-height:1.25;margin:0 0 8px;letter-spacing:-.005em}
.cause{margin:0;color:#cfcabf}
.fix{display:flex;gap:11px;margin-top:14px;padding-top:13px;border-top:1px dotted var(--rule)}
.fix-k{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);padding-top:4px;flex:0 0 auto}
.fix-b{color:var(--paper)}
.feat{display:inline-block;font-family:var(--mono);font-size:11.5px;color:var(--ink);background:var(--accent);padding:1px 8px;border-radius:3px;font-weight:500;white-space:nowrap}
.signal{margin-top:12px;font-family:var(--mono);font-size:10.5px;color:var(--faint);letter-spacing:.02em;opacity:.78}
.signal .sig-k{text-transform:uppercase;letter-spacing:.16em;color:color-mix(in srgb,var(--cat) 55%,var(--faint));margin-right:7px}

/* notes + footer */
.notes{border:1px dashed var(--rule);border-radius:4px;padding:18px 22px;margin:0 0 40px;background:rgba(255,255,255,.012)}
.notes-k{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--c-other);margin-bottom:10px}
.notes ul{margin:0;padding-left:18px;color:var(--muted);font-size:15px}
.notes li{margin:5px 0}
.foot{border-top:1px solid var(--rule);padding-top:20px;font-family:var(--mono);font-size:11px;color:var(--faint);letter-spacing:.03em;line-height:1.7}
@keyframes rise{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.pass{animation:none;opacity:1;transform:none}}
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
    <p class="kicker">ccoach · semantic root-cause coach</p>
    <h1>Deep&nbsp;<em>Insight</em></h1>
    <div class="metastrip">${meta}</div>
    <span class="seal">read-only · local · desensitizable</span>
  </header>
  ${d.tldr ? `<p class="tldr">${esc(d.tldr)}</p>` : ''}
  ${passes}
  ${honesty}
  <footer class="foot">${esc(d.privacy || 'Local, read-only analysis. Metrics are supporting evidence only — the root cause and the fix are the product. Never reads thinking / system prompts / file contents as content; assistant/tool_result content is opt-in, redacted, token-bounded.')}</footer>
</div>
</body>
</html>`
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2))
  if (!a.data || !a.output) {
    process.stderr.write('usage: node render_deepinsight.mjs --data <report.json> --output <out.html>\n')
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(a.data, 'utf8'))
  writeFileSync(a.output, renderDeepinsight(data))
  process.stdout.write(`wrote ${a.output}\n`)
}
