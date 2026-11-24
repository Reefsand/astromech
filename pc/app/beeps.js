// The droid's beeps, synthesized here (no sound files), note for note as in desktop/Sounds.swift:
// a rising "?" for a question, sharp beeps for an action, a happy trill once done.
;(() => {
  const N = (from, to, length, gap = 0.03, warble = 0) => ({ from, to, length, gap, warble })

  const SOUNDS = {
    question: [N(1400, 1100, 0.04, 0.015), N(1700, 1500, 0.035, 0.015), N(1200, 1350, 0.04, 0.06), N(700, 2000, 0.24, 0.03, 0.025)],
    action: [
      N(2300, 2300, 0.06, 0.02, 0.05),
      N(1500, 1500, 0.06, 0.02, 0.05),
      N(2300, 2300, 0.06, 0.02, 0.05),
      N(1500, 1500, 0.06, 0.05, 0.05),
      N(2600, 1800, 0.14, 0.03, 0.06),
    ],
    done: [
      N(1100, 1250, 0.04, 0.012),
      N(1400, 1550, 0.04, 0.012),
      N(1750, 1900, 0.04, 0.012),
      N(2100, 2350, 0.05, 0.04),
      N(1600, 2200, 0.07, 0.015),
      N(2200, 1900, 0.16, 0.03, 0.07),
    ],
    hello: [N(1500, 2200, 0.05, 0.02), N(2000, 1600, 0.07)],
  }

  /** 16-bit mono WAV: a sine with a little square in it (the droid's buzz), soft attack and release. */
  const wav = (notes, rate = 44100, volume = 0.32) => {
    const samples = []
    let phase = 0
    for (const n of notes) {
      const count = Math.floor(n.length * rate)
      for (let i = 0; i < count; i++) {
        const t = i / rate
        const k = i / count
        const freq = (n.from + (n.to - n.from) * k) * (1 + n.warble * Math.sin(2 * Math.PI * 28 * t))
        phase += (2 * Math.PI * freq) / rate
        const s = Math.sin(phase)
        const tone = 0.8 * s + 0.2 * (s >= 0 ? 1 : -1)
        const env = Math.min(1, t / 0.006) * Math.min(1, (n.length - t) / 0.018)
        samples.push(Math.round(Math.max(-1, Math.min(1, tone * env * volume)) * 32767))
      }
      for (let i = 0; i < Math.floor(n.gap * rate); i++) samples.push(0)
    }
    const buf = new ArrayBuffer(44 + samples.length * 2)
    const v = new DataView(buf)
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true)
    str(8, 'WAVEfmt '); v.setUint32(16, 16, true)
    v.setUint16(20, 1, true); v.setUint16(22, 1, true) // PCM, mono
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true)
    v.setUint16(32, 2, true); v.setUint16(34, 16, true)
    str(36, 'data'); v.setUint32(40, samples.length * 2, true)
    samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true))
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
  }

  const cache = {}
  let lastPlayed = 0

  window.playBeep = (name, force = false) => {
    if (!force && Date.now() - lastPlayed < 800) return // never two on top of each other
    if (!SOUNDS[name]) return
    cache[name] ??= new Audio(wav(SOUNDS[name]))
    lastPlayed = Date.now()
    const a = cache[name]
    a.pause()
    a.currentTime = 0
    a.play().catch(() => undefined)
  }
})()
