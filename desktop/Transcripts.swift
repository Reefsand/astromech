// Reads a Claude Code session's state from its transcript
// (~/.claude/projects/<folder>/<session id>.jsonl), so the droid sees every
// session, the ones that have not loaded the mod included.

import Foundation

struct TranscriptState {
    let id: String
    let title: String?
    let status: String // working | question | action | done | idle
    let created: Double
    let modified: Double
}

enum Transcripts {
    static let root = (NSHomeDirectory() as NSString).appendingPathComponent(".claude/projects")
    static let lookBackMs = 3 * 3600_000.0 // a question waits this long on screen; older transcripts are skipped
    static let workingMs = 15 * 60_000.0 // a "working" transcript silent this long has stopped
    static let doneKeepMs = 10 * 60_000.0
    /// Parsed states by path, kept while the file's modification time is unchanged.
    nonisolated(unsafe) static var cache: [String: (modified: Double, state: TranscriptState?)] = [:]

    static func scan(now: Double) -> [TranscriptState] {
        let fm = FileManager.default
        var out: [TranscriptState] = []
        for folder in (try? fm.contentsOfDirectory(atPath: root)) ?? [] {
            let dir = (root as NSString).appendingPathComponent(folder)
            for name in (try? fm.contentsOfDirectory(atPath: dir)) ?? [] where name.hasSuffix(".jsonl") {
                let path = (dir as NSString).appendingPathComponent(name)
                guard let attrs = try? fm.attributesOfItem(atPath: path),
                    let mdate = attrs[.modificationDate] as? Date
                else { continue }
                let modified = mdate.timeIntervalSince1970 * 1000
                if now - modified > lookBackMs { continue }
                let created = ((attrs[.creationDate] as? Date) ?? mdate).timeIntervalSince1970 * 1000
                let state: TranscriptState?
                if let hit = cache[path], hit.modified == modified {
                    state = hit.state
                } else {
                    state = read(path: path, id: String(name.dropLast(6)), created: created, modified: modified)
                    cache[path] = (modified, state)
                }
                guard let state else { continue }
                let age = now - modified
                switch state.status {
                case "working": if age > workingMs { continue }
                case "done": if age > doneKeepMs { continue }
                case "question", "action": break
                default: continue
                }
                out.append(state)
            }
        }
        return out
    }

    /// Records of the last `bytes` of the file (the first, cut line dropped), or the first `bytes`.
    static func records(path: String, bytes: UInt64, fromEnd: Bool) -> [[String: Any]] {
        guard let h = FileHandle(forReadingAtPath: path) else { return [] }
        defer { try? h.close() }
        let size = (try? h.seekToEnd()) ?? 0
        let start = fromEnd && size > bytes ? size - bytes : 0
        try? h.seek(toOffset: start)
        guard let data = try? h.read(upToCount: Int(min(bytes, size))) else { return [] }
        var lines = data.split(separator: UInt8(ascii: "\n"), omittingEmptySubsequences: true)
        if start > 0, !lines.isEmpty { lines.removeFirst() }
        if !fromEnd, size > bytes, !lines.isEmpty { lines.removeLast() }
        return lines.compactMap { try? JSONSerialization.jsonObject(with: Data($0)) as? [String: Any] }
    }

    static func blocks(_ r: [String: Any]) -> [[String: Any]] {
        (r["message"] as? [String: Any])?["content"] as? [[String: Any]] ?? []
    }

    /// The words a person typed in a user record, nil for tool results and injected rows.
    static func typedText(_ r: [String: Any]) -> String? {
        guard r["type"] as? String == "user", r["isMeta"] as? Bool != true else { return nil }
        let content = (r["message"] as? [String: Any])?["content"]
        var text = ""
        if let s = content as? String {
            text = s
        } else if let list = content as? [[String: Any]] {
            if list.contains(where: { $0["type"] as? String == "tool_result" }) { return nil }
            text = list.compactMap { $0["type"] as? String == "text" ? $0["text"] as? String : nil }.joined(separator: "\n")
        }
        let cleaned = text.replacingOccurrences(
            of: "<([a-zA-Z][\\w-]*)[^>]*>[\\s\\S]*?</\\1>", with: " ", options: .regularExpression
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty || cleaned.hasPrefix("<") || cleaned.hasPrefix("[") { return nil }
        return cleaned
    }

    static func read(path: String, id: String, created: Double, modified: Double) -> TranscriptState? {
        let tail = records(path: path, bytes: 512 * 1024, fromEnd: true)
            .filter { $0["isSidechain"] as? Bool != true }
        var title = tail.last(where: { $0["type"] as? String == "custom-title" })?["customTitle"] as? String
        if title == nil {
            let head = records(path: path, bytes: 256 * 1024, fromEnd: false)
            title = head.last(where: { $0["type"] as? String == "custom-title" })?["customTitle"] as? String
                ?? head.lazy.compactMap(typedText).first.map { String($0.prefix(60)) }
        }

        let turn = tail.filter { ["user", "assistant"].contains($0["type"] as? String ?? "") }
        guard let last = turn.last else { return nil }
        var status: String

        if last["type"] as? String == "assistant" {
            let content = blocks(last)
            let stop = (last["message"] as? [String: Any])?["stop_reason"] as? String
            let pending = content.last(where: { $0["type"] as? String == "tool_use" })
            if stop == "tool_use" || (stop == nil && pending != nil) {
                let tool = pending?["name"] as? String ?? ""
                status = tool == "AskUserQuestion" ? "question" : tool == "ExitPlanMode" ? "action" : "working"
            } else {
                status = endOfTurn(turn: turn, answer: content)
            }
        } else {
            let text = blocks(last).compactMap { $0["text"] as? String }.joined()
                + ((last["message"] as? [String: Any])?["content"] as? String ?? "")
            status = text.contains("[Request interrupted by user") ? "idle" : "working"
        }
        return TranscriptState(id: id, title: title, status: status, created: created, modified: modified)
    }

    /// A user record that opens a turn: a prompt or an injected message, not a tool's result.
    static func startsTurn(_ r: [String: Any]) -> Bool {
        guard r["type"] as? String == "user", r["isMeta"] as? Bool != true else { return false }
        let content = (r["message"] as? [String: Any])?["content"]
        if content is String { return true }
        let list = content as? [[String: Any]] ?? []
        return !list.contains { $0["type"] as? String == "tool_result" }
    }

    /// A finished turn: the desktop app's end-of-turn box says whether something waits on the person.
    static func endOfTurn(turn: [[String: Any]], answer: [[String: Any]]) -> String {
        for r in turn.reversed() {
            if startsTurn(r) { break } // back at the prompt that started the turn
            guard r["type"] as? String == "assistant" else { continue }
            for b in blocks(r) where (b["name"] as? String ?? "").hasSuffix("__wrap_up") {
                let input = b["input"] as? [String: Any] ?? [:]
                if input["blocked"] as? Bool == true { return "action" }
                if let ask = input["ask"] as? String, !ask.isEmpty { return "question" }
                return "done"
            }
        }
        let text = answer.compactMap { $0["text"] as? String }.joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return text.range(of: "\\?\\s*[)*_`\"»]*$", options: .regularExpression) != nil ? "question" : "done"
    }
}
