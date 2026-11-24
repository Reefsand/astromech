// Draws the droid's little head for the tray and the app icon, with no image tool:
// a few shapes as distance functions, supersampled, then written as PNG and ICO.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const hexColor = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

// Shapes in a 1 x 1 box (y down); each returns a signed distance, < 0 inside.
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r
const box = (x0, y0, x1, y1, r = 0) => (x, y) => {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const dx = Math.abs(x - cx) - ((x1 - x0) / 2 - r)
  const dy = Math.abs(y - cy) - ((y1 - y0) / 2 - r)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r
}
const cutBelow = (sdf, yMax) => (x, y) => Math.max(sdf(x, y), y - yMax)
const union = (...fs) => (x, y) => Math.min(...fs.map(f => f(x, y)))
const grow = (sdf, d) => (x, y) => sdf(x, y) - d

const OUTLINE = '#3b4250'
const dome = cutBelow(circle(0.5, 0.47, 0.31), 0.47)
const body = box(0.24, 0.45, 0.76, 0.93, 0.07)
const silhouette = union(dome, body)

/** The layers, back to front; `badge` adds a coloured dot (the tray's "!" or "?"). */
const layers = badge => {
  const out = [
    [grow(silhouette, 0.045), OUTLINE],
    [body, '#f1f3f7'],
    [dome, '#c9d1db'],
    [box(0.2, 0.44, 0.8, 0.5), '#d97757'],
    [box(0.33, 0.58, 0.47, 0.8, 0.02), '#d97757'],
    [box(0.53, 0.58, 0.67, 0.64, 0.015), '#d97757'],
    [circle(0.43, 0.32, 0.085), '#1b2230'],
    [circle(0.43, 0.32, 0.042), '#ff8a3d'],
  ]
  if (badge) out.push([circle(0.79, 0.22, 0.2), '#ffffff'], [circle(0.79, 0.22, 0.15), badge])
  return out.map(([sdf, c]) => [sdf, hexColor(c)])
}

const render = (size, badge) => {
  const L = layers(badge)
  const ss = size <= 32 ? 8 : 4
  const px = Buffer.alloc(size * size * 4)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = (i + (si + 0.5) / ss) / size
          const y = (j + (sj + 0.5) / ss) / size
          for (let k = L.length - 1; k >= 0; k--) {
            if (L[k][0](x, y) < 0) {
              r += L[k][1][0]; g += L[k][1][1]; b += L[k][1][2]; a += 1
              break
            }
          }
        }
      }
      const o = (j * size + i) * 4
      if (a > 0) {
        px[o] = Math.round(r / a); px[o + 1] = Math.round(g / a); px[o + 2] = Math.round(b / a)
        px[o + 3] = Math.round((255 * a) / (ss * ss))
      }
    }
  }
  return png(size, px)
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buf => {
  let c = 0xffffffff
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const png = (size, rgba) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** An ICO whose images are PNGs (fine from Windows Vista on). */
const ico = images => {
  const head = Buffer.alloc(6 + images.length * 16)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(([size, data], n) => {
    const e = 6 + n * 16
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map(([, d]) => d)])
}

export const writeIcons = root => {
  const icons = path.join(root, 'app/icons')
  const build = path.join(root, 'build')
  fs.mkdirSync(icons, { recursive: true })
  fs.mkdirSync(build, { recursive: true })
  // Tray: plain, "!" (red dot) and "?" (yellow dot); the @2x files serve high-DPI screens.
  for (const [name, badge] of [['tray', null], ['tray-action', '#ff4d4d'], ['tray-question', '#ffd34d']]) {
    fs.writeFileSync(path.join(icons, `${name}.png`), render(16, badge))
    fs.writeFileSync(path.join(icons, `${name}@2x.png`), render(32, badge))
  }
  fs.writeFileSync(path.join(icons, 'icon.png'), render(256))
  fs.writeFileSync(path.join(build, 'icon.png'), render(256))
  fs.writeFileSync(path.join(build, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map(s => [s, render(s)])))
}
