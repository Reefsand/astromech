// The droid's beeps, synthesized here (no sound files): short whistled glides,
// a rising "?" for a question, sharp beeps for an action, a happy trill once done.

import AppKit

enum Beeps {
    /// One whistled note: a glide from `from` to `to` Hz, then a silence of `gap` seconds.
    struct Note {
        let from: Double
        let to: Double
        let length: Double
        var gap = 0.03
        var warble = 0.0 // vibrato depth, as a share of the pitch
    }

    // Each one is a burble of quick chirps, then a shape of its own:
    // "?" ends on a long rising whistle, "!" alternates high and low like an alarm,
    // done climbs a cheerful arpeggio and ends on a happy wobble.
    static let sounds: [String: [Note]] = [
        "question": [
            Note(from: 1400, to: 1100, length: 0.04, gap: 0.015),
            Note(from: 1700, to: 1500, length: 0.035, gap: 0.015),
            Note(from: 1200, to: 1350, length: 0.04, gap: 0.06),
            Note(from: 700, to: 2000, length: 0.24, warble: 0.025),
        ],
        "action": [
            Note(from: 2300, to: 2300, length: 0.06, gap: 0.02, warble: 0.05),
            Note(from: 1500, to: 1500, length: 0.06, gap: 0.02, warble: 0.05),
            Note(from: 2300, to: 2300, length: 0.06, gap: 0.02, warble: 0.05),
            Note(from: 1500, to: 1500, length: 0.06, gap: 0.05, warble: 0.05),
            Note(from: 2600, to: 1800, length: 0.14, warble: 0.06),
        ],
        "done": [
            Note(from: 1100, to: 1250, length: 0.04, gap: 0.012),
            Note(from: 1400, to: 1550, length: 0.04, gap: 0.012),
            Note(from: 1750, to: 1900, length: 0.04, gap: 0.012),
            Note(from: 2100, to: 2350, length: 0.05, gap: 0.04),
            Note(from: 1600, to: 2200, length: 0.07, gap: 0.015),
            Note(from: 2200, to: 1900, length: 0.16, warble: 0.07),
        ],
        "hello": [
            Note(from: 1500, to: 2200, length: 0.05, gap: 0.02),
            Note(from: 2000, to: 1600, length: 0.07),
        ],
    ]

    nonisolated(unsafe) static var cache: [String: NSSound] = [:]
    nonisolated(unsafe) static var lastPlayed = Date.distantPast

    static func play(_ name: String) {
        guard Date().timeIntervalSince(lastPlayed) > 0.8 else { return } // never two on top of each other
        if cache[name] == nil, let notes = sounds[name] { cache[name] = NSSound(data: wav(notes)) }
        guard let sound = cache[name] else { return }
        lastPlayed = Date()
        sound.stop()
        sound.play()
    }

    /// 16-bit mono WAV: a sine with a little square in it (the droid's buzz), soft attack and release.
    static func wav(_ notes: [Note], rate: Double = 44_100, volume: Double = 0.32) -> Data {
        var samples: [Int16] = []
        var phase = 0.0
        for n in notes {
            let count = Int(n.length * rate)
            for i in 0..<count {
                let t = Double(i) / rate
                let k = Double(i) / Double(count)
                let freq = (n.from + (n.to - n.from) * k) * (1 + n.warble * sin(2 * .pi * 28 * t))
                phase += 2 * .pi * freq / rate
                let s = sin(phase)
                let tone = 0.8 * s + 0.2 * (s >= 0 ? 1 : -1)
                let env = min(1, t / 0.006) * min(1, (n.length - t) / 0.018)
                samples.append(Int16(max(-1, min(1, tone * env * volume)) * 32_767))
            }
            samples.append(contentsOf: repeatElement(0, count: Int(n.gap * rate)))
        }
        var data = Data()
        func put<T>(_ v: T) { withUnsafeBytes(of: v) { data.append(contentsOf: $0) } }
        let bytes = UInt32(samples.count * 2)
        data.append(contentsOf: Array("RIFF".utf8)); put(UInt32(36 + bytes).littleEndian)
        data.append(contentsOf: Array("WAVEfmt ".utf8)); put(UInt32(16).littleEndian)
        put(UInt16(1).littleEndian); put(UInt16(1).littleEndian) // PCM, mono
        put(UInt32(rate).littleEndian); put(UInt32(rate * 2).littleEndian)
        put(UInt16(2).littleEndian); put(UInt16(16).littleEndian)
        data.append(contentsOf: Array("data".utf8)); put(bytes.littleEndian)
        for s in samples { put(s.littleEndian) }
        return data
    }
}
