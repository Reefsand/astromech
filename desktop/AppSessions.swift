// The Claude app's own record of its Code sessions
// (~/Library/Application Support/Claude/claude-code-sessions/<account>/<org>/local_*.json):
// which conversation a transcript belongs to, its title in the sidebar, whether it is archived.

import AppKit
import Foundation

struct AppSession {
    let localId: String // "local_…", what claude://claude.ai/epitaxy/<id> opens
    let title: String?
    let isArchived: Bool
    let lastFocusedAt: Double // when the person last opened it in the app (ms)
    let lastTurnEdgeAt: Double // when its last turn started or ended (ms)
}

enum AppSessions {
    static let root = (NSHomeDirectory() as NSString)
        .appendingPathComponent("Library/Application Support/Claude/claude-code-sessions")
    nonisolated(unsafe) static var byTranscript: [String: AppSession] = [:]
    nonisolated(unsafe) static var cache: [String: (modified: Date, ids: [String], session: AppSession)] = [:]
    nonisolated(unsafe) static var lastScan = Date.distantPast

    /// Transcript (CLI session) id → the app's session; re-read at most every 5 seconds.
    static func map() -> [String: AppSession] {
        if Date().timeIntervalSince(lastScan) < 5 { return byTranscript }
        lastScan = Date()
        let fm = FileManager.default
        var out: [String: AppSession] = [:]
        guard let walker = fm.enumerator(atPath: root) else { return byTranscript }
        while let rel = walker.nextObject() as? String {
            guard rel.hasSuffix(".json"), (rel as NSString).lastPathComponent.hasPrefix("local_") else { continue }
            let path = (root as NSString).appendingPathComponent(rel)
            guard let modified = (try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date else { continue }
            let entry: (ids: [String], session: AppSession)
            if let hit = cache[path], hit.modified == modified {
                entry = (hit.ids, hit.session)
            } else {
                guard let data = fm.contents(atPath: path),
                    let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let localId = d["sessionId"] as? String
                else { continue }
                let ids = [d["cliSessionId"], d["lastAssistantCliSessionId"]].compactMap { $0 as? String }
                let session = AppSession(
                    localId: localId, title: d["title"] as? String,
                    isArchived: d["isArchived"] as? Bool ?? false,
                    lastFocusedAt: d["lastFocusedAt"] as? Double ?? 0,
                    lastTurnEdgeAt: d["lastTurnEdgeAt"] as? Double ?? 0)
                cache[path] = (modified, ids, session)
                entry = (ids, session)
            }
            for id in entry.ids { out[id] = entry.session }
        }
        byTranscript = out
        return out
    }

    /// The session the app shows now: the one focused last, while the Claude app is in front.
    static func viewedNow(_ map: [String: AppSession]) -> String? {
        let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        guard front == "com.anthropic.claudefordesktop" else { return nil }
        return map.values.filter { !$0.isArchived }.max { $0.lastFocusedAt < $1.lastFocusedAt }?.localId
    }

    static func url(for transcriptId: String) -> URL? {
        guard let s = map()[transcriptId] else { return nil }
        return URL(string: "claude://claude.ai/epitaxy/\(s.localId)")
    }
}
