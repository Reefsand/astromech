import type { Screen, ScreenStatus } from '../types'
import { SCREEN_STYLE, screenSvg } from './screen'

const W = 300
const H = 240
const BOT_SCALE = 1.45
/** Where the screens end: the droid's dome overlaps their bottom edge. */
const SCREENS_BOTTOM = H - 4 - 71 * BOT_SCALE + 8
const MAX_SCREENS = 6
const STYLE = `
@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
@keyframes glow{0%,100%{opacity:.35}50%{opacity:.9}}
@keyframes wobble{0%{transform:rotate(-5deg) translateY(0)}50%{transform:rotate(0deg) translateY(-2px)}100%{transform:rotate(5deg) translateY(0)}}
@keyframes look{0%,15%{transform:rotate(-22deg)}45%,60%{transform:rotate(18deg)}85%,100%{transform:rotate(-22deg)}}
@keyframes tilt{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(-14deg)}}
@keyframes breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}
@keyframes hop{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes beep{0%{opacity:0;transform:translateY(0)}20%{opacity:1}100%{opacity:0;transform:translateY(-10px)}}
.cur{animation:blink 1s steps(1) infinite}
.mark{transform-box:fill-box;transform-origin:50% 50%;animation:pulse 1.2s ease-in-out infinite}
.glow{animation:glow 1.6s ease-in-out infinite}
.bot{transform-box:fill-box;transform-origin:50% 100%}
.bot.working{animation:wobble .28s ease-in-out infinite alternate}
.bot.question,.bot.action{animation:hop .9s ease-in-out infinite}
.bot.done{animation:hop .6s ease-in-out 3}
.bot.idle{animation:breathe 3s ease-in-out infinite}
.head{transform-box:fill-box;transform-origin:50% 100%}
.head.working{animation:look 1.4s ease-in-out infinite}
.head.question{animation:tilt 1.8s ease-in-out infinite}
.beep{animation:beep 1.1s ease-out infinite}
`

/** Grid of screens behind the robot, at most MAX_SCREENS, in rows of three. */
const screensSvg = (screens: Screen[]) => {
  const shown = screens.slice(0, MAX_SCREENS)
  const n = shown.length
  if (n === 0) return ''
  const cols = Math.min(n, 3)
  const rows = Math.ceil(n / cols)
  const gap = 8
  const rowGap = 14
  const areaH = SCREENS_BOTTOM - 6
  let sw = Math.min(n === 1 ? 150 : 130, (W - 12 - (cols - 1) * gap) / cols)
  let sh = sw * 0.62
  const maxSh = (areaH - (rows - 1) * rowGap) / rows - 6
  if (sh > maxSh) {
    sh = maxSh
    sw = Math.min(sw, sh / 0.55)
  }
  const top = SCREENS_BOTTOM - (rows * sh + (rows - 1) * rowGap)
  const out: string[] = []
  shown.forEach((s, i) => {
    const r = Math.floor(i / cols)
    const inRow = Math.min(cols, n - r * cols)
    const rowW = inRow * sw + (inRow - 1) * gap
    const x0 = (W - rowW) / 2
    const c = i - r * cols
    out.push(screenSvg(s, x0 + c * (sw + gap), top + r * (sh + rowGap), sw, sh, i))
  })
  if (screens.length > MAX_SCREENS) {
    out.push(`<text x="${W - 6}" y="${H - 6}" font-size="9" fill="#9ca3af" text-anchor="end">+${screens.length - MAX_SCREENS}</text>`)
  }
  return out.join('')
}

/** The droid: an original dome-headed barrel bot, in white and warm orange. */
const robotSvg = (mood: ScreenStatus) => {
  const cx = W / 2
  const base = H - 4
  const eye =
    mood === 'action' ? '#ff6b5e' : mood === 'question' ? '#f2cc60' : mood === 'done' ? '#4ade80' : '#ff8a3d'
  const beeps =
    mood === 'working'
      ? `<g fill="#3fb6ff"><circle class="beep" cx="${cx + 26}" cy="${base - 70}" r="1.6"/><circle class="beep" style="animation-delay:.4s" cx="${cx - 26}" cy="${base - 66}" r="1.3"/><circle class="beep" style="animation-delay:.75s" cx="${cx + 30}" cy="${base - 60}" r="1"/></g>`
      : ''
  return `<g transform="translate(${cx} ${base}) scale(${BOT_SCALE}) translate(${-cx} ${-base})"><g class="bot ${mood}">
<ellipse cx="${cx}" cy="${base}" rx="30" ry="3" fill="#000" opacity=".35"/>
<!-- legs -->
<path d="M${cx - 27} ${base - 42} l6 0 l3 36 l-12 0 z" fill="#d8dde6" stroke="#8b95a5" stroke-width=".8"/>
<path d="M${cx + 27} ${base - 42} l-6 0 l-3 36 l12 0 z" fill="#d8dde6" stroke="#8b95a5" stroke-width=".8"/>
<rect x="${cx - 32}" y="${base - 7}" width="15" height="6" rx="1.5" fill="#9aa4b2"/>
<rect x="${cx + 17}" y="${base - 7}" width="15" height="6" rx="1.5" fill="#9aa4b2"/>
<rect x="${cx - 6}" y="${base - 10}" width="12" height="9" rx="2" fill="#9aa4b2"/>
<!-- body -->
<rect x="${cx - 20}" y="${base - 48}" width="40" height="40" rx="5" fill="#f1f3f7" stroke="#8b95a5" stroke-width=".9"/>
<rect x="${cx - 14}" y="${base - 42}" width="10" height="16" rx="1.5" fill="#d97757"/>
<rect x="${cx + 2}" y="${base - 42}" width="12" height="5" rx="1" fill="#d97757"/>
<rect x="${cx + 2}" y="${base - 35}" width="12" height="2" rx="1" fill="#8b95a5"/>
<rect x="${cx + 2}" y="${base - 31}" width="12" height="2" rx="1" fill="#8b95a5"/>
<circle cx="${cx}" cy="${base - 18}" r="3" fill="#d97757"/>
<rect x="${cx - 14}" y="${base - 22}" width="8" height="8" rx="1.5" fill="none" stroke="#8b95a5" stroke-width=".8"/>
<!-- head -->
<g class="head ${mood}">
<path d="M${cx - 21} ${base - 48} a21 21 0 0 1 42 0 z" fill="#c9d1db" stroke="#8b95a5" stroke-width=".9"/>
<rect x="${cx - 21}" y="${base - 51}" width="42" height="3" fill="#d97757"/>
<circle cx="${cx - 4}" cy="${base - 60}" r="5.2" fill="#1b2230"/>
<circle class="glow" cx="${cx - 4}" cy="${base - 60}" r="2.6" fill="${eye}"/>
<circle cx="${cx - 5.4}" cy="${base - 61.4}" r=".9" fill="#fff" opacity=".8"/>
<rect x="${cx + 5}" y="${base - 63}" width="8" height="3.5" rx="1" fill="#d97757"/>
<circle class="${mood === 'idle' ? '' : 'cur'}" cx="${cx + 11}" cy="${base - 55}" r="1.5" fill="#3fb6ff"/>
<rect x="${cx - 1}" y="${base - 71}" width="2" height="4" fill="#8b95a5"/>
</g>
${beeps}
</g></g>`
}

/** The droid's mood: busy beats waiting, waiting beats done. */
export const moodOf = (screens: Screen[]): ScreenStatus => {
  const has = (st: ScreenStatus) => screens.some(s => s.status === st)
  if (has('working')) return 'working'
  if (has('action')) return 'action'
  if (has('question')) return 'question'
  if (has('done')) return 'done'
  return 'idle'
}

export const sceneSvg = (screens: Screen[]) => {
  const empty =
    screens.length === 0
      ? `<text x="${W / 2}" y="60" font-size="10" fill="#6b7280" text-anchor="middle">aucun sujet en cours</text>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><style>${SCREEN_STYLE}${STYLE}</style>${screensSvg(screens)}${empty}${robotSvg(moodOf(screens))}</svg>`
}

export const glyphOf: Record<ScreenStatus, string> = {
  working: '⌨',
  question: '?',
  action: '!',
  done: '✓',
  idle: '·',
  ended: '·',
}
