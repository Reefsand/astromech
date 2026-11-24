// The page's side of the PC droid: the window lets clicks through everywhere except over
// the droid and its screens; there, a drag moves it and a double click opens a conversation
// (the screen's own, or Claude on the droid).

/** The droid's box in the drawing (300 x 240, top-left origin), as in the Mac app. */
const DROID = { x: 98, y: 126, w: 104, h: 114 }

const hit = (x, y) => {
  const k = window.innerWidth / 300
  if (x >= DROID.x * k && x <= (DROID.x + DROID.w) * k && y >= DROID.y * k && y <= (DROID.y + DROID.h) * k) {
    return { droid: true }
  }
  for (const el of document.querySelectorAll('[data-id]')) {
    const r = el.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { id: el.dataset.id }
  }
  return null
}

let over = false
let dragging = false

const setOver = value => {
  if (value === over) return
  over = value
  window.astromech.grab(value)
  document.body.style.cursor = value ? 'grab' : ''
}

document.addEventListener('mousemove', e => {
  if (!dragging) setOver(Boolean(hit(e.clientX, e.clientY)))
})
document.addEventListener('mouseleave', () => {
  if (!dragging) setOver(false)
})
document.addEventListener('mousedown', e => {
  if (e.button !== 0 || !hit(e.clientX, e.clientY)) return
  e.preventDefault()
  dragging = true
  document.body.style.cursor = 'grabbing'
  window.astromech.dragStart()
})
const endDrag = e => {
  if (!dragging) return
  dragging = false
  window.astromech.dragEnd()
  setOver(Boolean(e && hit(e.clientX, e.clientY)))
  document.body.style.cursor = over ? 'grab' : ''
}
document.addEventListener('mouseup', endDrag)
window.addEventListener('blur', () => endDrag())
document.addEventListener('dblclick', e => {
  const h = hit(e.clientX, e.clientY)
  if (h) window.astromech.open(h.droid ? null : h.id)
})

window.astromech.onBeep(({ name, force }) => window.playBeep?.(name, force))
