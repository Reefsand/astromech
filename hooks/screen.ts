// One session's screen, "tactical vector" look: a chamfered console with a phosphor
// display, a perspective grid and a targeting reticle. Blue while Claude works,
// yellow for a question, red for an action, green once done.

import type { Screen, ScreenStatus } from '../types'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)
const f = (n: number) => n.toFixed(1)

/** A small deterministic generator, so a screen's "code" stays the same between redraws. */
const seeded = (key: string) => {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

const WORDS = ['SYNC', 'NAV', 'CALC', 'LINK', 'SCAN', 'GRID', 'FLUX', 'CORE', 'DATA', 'LOAD', 'ROUTE', 'MAP', 'VECT', 'PWR']
const word = (r: () => number) => WORDS[Math.floor(r() * WORDS.length)]
const hex = (r: () => number) => Math.floor(r() * 0xffff).toString(16).toUpperCase().padStart(4, '0')
const codeText = (r: () => number) => {
  const k = Math.floor(r() * 4)
  if (k === 0) return `${hex(r)}:${hex(r)} ${word(r)}`
  if (k === 1) return `> ${word(r)}.${word(r)} ${Math.floor(r() * 99)}`
  if (k === 2) return `${word(r)} ${'█'.repeat(1 + Math.floor(r() * 5))}${'░'.repeat(1 + Math.floor(r() * 3))}`
  return `${hex(r)} ${hex(r)} ${hex(r)}`
}

const TONE: Record<ScreenStatus, string> = {
  working: '#4db8ff',
  question: '#ffd34d',
  action: '#ff4d4d',
  done: '#46ff8c',
  idle: '#6b7280',
  ended: '#6b7280',
}

export const SCREEN_STYLE = `
text{font-family:ui-monospace,Menlo,monospace}
@keyframes r-type{0%{clip-path:inset(0 100% 0 0)}55%,92%{clip-path:inset(0 0 0 0)}100%{clip-path:inset(0 100% 0 0)}}
@keyframes r-blink{0%,49%{opacity:1}50%,100%{opacity:.15}}
@keyframes r-sweep{0%{transform:translateY(0)}100%{transform:translateY(var(--sweep))}}
@keyframes r-spin{to{transform:rotate(360deg)}}
.r-type{animation:r-type 3.6s steps(14,end) infinite}
.r-blink{animation:r-blink 1s steps(1) infinite}
.r-sweep{animation:r-sweep 2.4s linear infinite}
.r-spin{transform-box:fill-box;transform-origin:50% 50%;animation:r-spin 6s linear infinite}
`

const glow = (id: string, color: string) =>
  `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".7" result="b"/><feFlood flood-color="${color}" flood-opacity=".9"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`

export const screenSvg = (s: Screen, x: number, y: number, w: number, h: number, i: number) => {
  const uid = `scr${i}`
  const tone = TONE[s.status]
  const c = Math.max(4, w * 0.06) // chamfered corners
  const pad = Math.max(3, w * 0.035)
  const g = { x: x + pad, y: y + pad + 1, w: w - pad * 2, h: h - pad * 2 - 1 }
  const fs = Math.max(5, Math.min(7.5, g.h / 8))

  // perspective grid towards a horizon at 42% of the height
  const hor = g.y + g.h * 0.42
  const vp = g.x + g.w / 2
  const grid: string[] = []
  for (let k = -5; k <= 5; k++) grid.push(`<line x1="${f(vp)}" y1="${f(hor)}" x2="${f(vp + k * g.w * 0.22)}" y2="${f(g.y + g.h)}"/>`)
  for (let k = 1; k <= 5; k++) {
    const yy = hor + (g.y + g.h - hor) * Math.pow(k / 5, 1.8)
    grid.push(`<line x1="${f(g.x)}" y1="${f(yy)}" x2="${f(g.x + g.w)}" y2="${f(yy)}"/>`)
  }
  const brackets = [
    [g.x + 2, g.y + 2, 1, 1],
    [g.x + g.w - 2, g.y + 2, -1, 1],
    [g.x + 2, g.y + g.h - 2, 1, -1],
    [g.x + g.w - 2, g.y + g.h - 2, -1, -1],
  ]
    .map(([bx, by, dx, dy]) => `<path d="M${f(bx)} ${f(by + dy * 5)} V${f(by)} H${f(bx + dx * 5)}" fill="none" stroke="${tone}" stroke-width=".9"/>`)
    .join('')

  let body: string
  if (s.status === 'working') {
    const r = seeded(s.id)
    const lines: string[] = []
    for (let k = 0; k < 3; k++) {
      const ly = g.y + fs * 2.5 + k * fs * 1.3
      lines.push(
        `<text class="r-type" style="animation-delay:${(-k * 0.6 - i * 0.9).toFixed(2)}s" x="${f(g.x + 4)}" y="${f(ly)}" font-size="${f(fs * 0.85)}" fill="${tone}">${esc(cut(codeText(r), Math.floor(g.w / (fs * 0.55))))}</text>`,
      )
    }
    body = `<g stroke="${tone}" stroke-width=".5" opacity=".45">${grid.join('')}</g>
${lines.join('')}
<rect class="r-sweep" style="--sweep:${f(g.h)}px" x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="1.4" fill="${tone}" opacity=".55"/>`
  } else {
    const R = Math.min(g.w, g.h) * 0.3
    const cx = g.x + g.w / 2
    const cy = g.y + g.h * 0.5
    const isDone = s.status === 'done'
    const glyph = s.status === 'question' ? '?' : s.status === 'action' ? '!' : '✓'
    const label = s.status === 'question' ? 'QUESTION' : s.status === 'action' ? 'ALERTE' : 'TERMINÉ'
    const ticks = [0, 90, 180, 270]
      .map(a => `<line x1="${f(cx)}" y1="${f(cy - R - 3)}" x2="${f(cx)}" y2="${f(cy - R + 3)}" transform="rotate(${a} ${f(cx)} ${f(cy)})"/>`)
      .join('')
    body = `<g stroke="${tone}" stroke-width=".5" opacity=".2">${grid.join('')}</g>
<g class="${isDone ? '' : 'r-spin'}" stroke="${tone}" stroke-width="1" fill="none"><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}" stroke-dasharray="${f(R * 0.9)} ${f(R * 0.35)}"/>${ticks}</g>
<text class="${isDone ? '' : 'r-blink'}" x="${f(cx)}" y="${f(cy)}" font-size="${f(R * 1.2)}" font-weight="700" fill="${tone}" text-anchor="middle" dominant-baseline="central">${glyph}</text>
<text x="${f(cx)}" y="${f(g.y + g.h - 4)}" font-size="${f(fs * 0.8)}" fill="${tone}" text-anchor="middle" letter-spacing="1.5">${label}</text>`
  }

  const poly = [
    [x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c],
    [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c],
  ].map(([px, py]) => `${f(px)},${f(py)}`).join(' ')
  const vents = [0, 1, 2]
    .map(k => {
      const vy = f(y + h * 0.4 + k * 3)
      return `<line x1="${f(x + 1.5)}" y1="${vy}" x2="${f(x + pad - 0.5)}" y2="${vy}"/><line x1="${f(x + w - pad + 0.5)}" y1="${vy}" x2="${f(x + w - 1.5)}" y2="${vy}"/>`
    })
    .join('')

  // A Codex thread (ChatGPT app) says so on the bezel's bottom edge.
  const badge = s.id.startsWith('codex:')
    ? `<text x="${f(x + w / 2)}" y="${f(y + h - 0.6)}" font-size="${f(Math.max(3.2, pad * 0.9))}" fill="#8a96a3" text-anchor="middle" letter-spacing="1">CODEX</text>`
    : ''

  return `<g data-id="${esc(s.id)}">
<defs>${glow(`${uid}g`, tone)}<clipPath id="${uid}c"><rect x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="${f(g.h)}"/></clipPath></defs>
<polygon points="${poly}" fill="#1a1f24" stroke="#3b444d" stroke-width="1"/>
<g stroke="#4a545e" stroke-width="1">${vents}</g>
<rect x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="${f(g.h)}" fill="#01060a"/>
<g clip-path="url(#${uid}c)" filter="url(#${uid}g)">
<text x="${f(g.x + 8)}" y="${f(g.y + fs * 1.3)}" font-size="${f(fs * 0.85)}" fill="${tone}" letter-spacing=".8">${esc(cut(s.topic.toUpperCase(), Math.floor((g.w - 16) / (fs * 0.85 * 0.62 + 0.8))))}</text>
${body}
${brackets}
</g>
${badge}
</g>`
}
