// Reads the state of Codex threads (the ChatGPT app's Codex, or the codex CLI) from their
// session files (~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread id>.jsonl), read only:
// nothing in Codex is changed. Their screens carry the id "codex:<thread id>".

import Foundation

enum Codex {
    static let root = (NSHomeDirectory() as NSString).appendingPathComponent(".codex")
    static let prefix = "codex:"
    nonisolated(unsafe) static var cache: [String: (modified: Double, state: TranscriptState?)] = [:]
    nonisolated(unsafe) static var names: (modified: Double, byId: [String: String]) = (0, [:])

    static func scan(now: Double) -> [TranscriptState] {
        let fm = FileManager.default
        let sessions = (root as NSString).appendingPathComponent("sessions")
        var out: [TranscriptState] = []
        // Only the folders of the last two days can hold a file written in the last hours.
        let day = DateFormatter()
        day.dateFormat = "yyyy/MM/dd"
        let days = Set([0.0, -86_400].map { day.string(from: Date(timeIntervalSince1970: now / 1000 + $0)) })
        let titles = threadNames()
        for d in days {
            let dir = (sessions as NSString).appendingPathComponent(d)
            for name in (try? fm.contentsOfDirectory(atPath: dir)) ?? [] where name.hasSuffix(".jsonl") {
                let path = (dir as NSString).appendingPathComponent(name)
                guard let attrs = try? fm.attributesOfItem(atPath: path),
                    let mdate = attrs[.modificationDate] as? Date
                else { continue }
                let modified = mdate.timeIntervalSince1970 * 1000
                if now - modified > Transcripts.lookBackMs { continue }
                let created = ((attrs[.creationDate] as? Date) ?? mdate).timeIntervalSince1970 * 1000
                let state: TranscriptState?
                if let hit = cache[path], hit.modified == modified {
                    state = hit.state
                } else {
                    state = read(path: path, created: created, modified: modified)
                    cache[path] = (modified, state)
                }
                guard let s = state else { continue }
                let age = now - modified
                switch s.status {
                case "working": if age > Transcripts.workingMs { continue }
                case "done": if age > Transcripts.doneKeepMs { continue }
                case "question", "action": break
                default: continue
                }
                let thread = String(s.id.dropFirst(prefix.count))
                out.append(TranscriptState(
                    id: s.id, title: titles[thread] ?? s.title, status: s.status, created: s.created, modified: s.modified))
            }
        }
        return out
    }

    /// The titles the app gives its threads (session_index.jsonl, the last line per thread wins).
    static func threadNames() -> [String: String] {
        let path = (root as NSString).appendingPathComponent("session_index.jsonl")
        guard let m = (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date else { return [:] }
        let modified = m.timeIntervalSince1970
        if modified == names.modified { return names.byId }
        var byId: [String: String] = [:]
        for r in Transcripts.records(path: path, bytes: 1 << 20, fromEnd: true) {
            if let id = r["id"] as? String, let n = r["thread_name"] as? String, !n.isEmpty { byId[id] = n }
        }
        names = (modified, byId)
        return byId
    }

    static func read(path: String, created: Double, modified: Double) -> TranscriptState? {
        let head = Transcripts.records(path: path, bytes: 64 << 10, fromEnd: false)
        guard let meta = head.first(where: { $0["type"] as? String == "session_meta" })?["payload"] as? [String: Any],
            let thread = meta["id"] as? String
        else { return nil }
        var title: String?
        var status: String?
        var asked = false // the turn put a question to the person (request_user_input)
        for r in Transcripts.records(path: path, bytes: 512 << 10, fromEnd: true) {
            guard let p = r["payload"] as? [String: Any], let type = p["type"] as? String else { continue }
            if title == nil, type == "item_completed", let item = p["item"] as? [String: Any],
                item["type"] as? String == "UserMessage",
                let text = (item["content"] as? [[String: Any]])?.compactMap({ $0["text"] as? String }).joined(separator: " ")
            {
                title = text.split(separator: "\n").first.map { String($0.prefix(60)) }
            }
            switch type {
            case "task_started":
                status = "working"; asked = false
            case "function_call" where (p["name"] as? String)?.hasPrefix("request_user_input") == true:
                status = "question"; asked = true
            case _ where type.hasSuffix("approval_request"):
                status = "action"
            case "item_completed", "function_call_output", "custom_tool_call_output":
                if status == "action" { status = "working" } // the approval was answered
            case "task_complete":
                let last = ((p["last_agent_message"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                status = asked || last.hasSuffix("?") ? "question" : "done"
            case "turn_aborted":
                status = "idle"
            default: break
            }
        }
        guard let status else { return nil }
        return TranscriptState(id: prefix + thread, title: title, status: status, created: created, modified: modified)
    }

    static func url(for id: String) -> URL? {
        guard id.hasPrefix(prefix) else { return nil }
        return URL(string: "codex://threads/\(id.dropFirst(prefix.count))")
    }
}
