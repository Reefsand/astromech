// Astromech: the droid of the "astromech" mod, floating above every window.
// One screen per Claude Code session: read from the files the mod writes to
// ~/.claude/astromech/sessions/ and, for every session, from its transcript.

import Carbon
import Cocoa
import ServiceManagement
import WebKit

struct Screen: Codable {
    let id: String
    let topic: String
    let status: String
    let created: Double
    let since: Double
    let beat: Double
}

let staleMs = 60_000.0 // a mod file silent this long belongs to a closed session
let doneKeepMs = 600_000.0 // a finished screen stays 10 minutes
let baseSize = NSSize(width: 300, height: 240)
/// The droid's box in the drawing (300 x 240, top-left origin): grabbing it moves the window.
let droidBox = NSRect(x: 98, y: 126, width: 104, height: 114)

/// Lies over the whole drawing but answers only over the droid and the screens:
/// a drag moves the window, a double click opens a screen's conversation (or Claude, on the droid).
final class Handle: NSView {
    var droid = NSRect.zero
    var screens: [(id: String, rect: NSRect)] = []
    var onOpen: (String?) -> Void = { _ in }
    override var isFlipped: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    func isGrabbable(_ p: NSPoint) -> Bool { droid.contains(p) || screens.contains { $0.rect.contains(p) } }
    override func hitTest(_ point: NSPoint) -> NSView? {
        isGrabbable(convert(point, from: superview)) ? self : nil
    }
    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        if event.clickCount == 2 {
            onOpen(droid.contains(p) ? nil : screens.first { $0.rect.contains(p) }?.id)
        } else {
            window?.performDrag(with: event)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var panel: NSPanel!
    var web: WKWebView!
    var handle: Handle!
    var statusItem: NSStatusItem!
    var pollTimer: Timer?
    var hoverTimer: Timer?
    var isReady = false
    var isOverGrab = false
    var lastStatus: [String: String]? // nil until the first look: what is there at launch makes no sound
    var hotKeys: [EventHotKeyRef?] = []
    var opened: [String: Double] = [:] // finished screens double-clicked: their conversation was opened
    var pending: [String] = [] // commands from links that arrived while the app was still starting
    let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".claude/astromech/sessions")
    let defaults = UserDefaults.standard

    var scale: CGFloat {
        let s = defaults.double(forKey: "scale")
        return s == 0 ? 1.0 : CGFloat(s)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildPanel()
        buildMenu()
        pending.forEach(run(command:))
        pending = []
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            self?.poll()
        }
        hoverTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            self?.trackHover()
        }
        registerHotKeys()
    }

    // MARK: commands (astromech://… links, keyboard shortcuts, menu)

    /// `open -g astromech://hide` (or show, toggle, mute, unmute, sound): what the /astromech command sends.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "astromech" {
            run(command: url.host ?? url.path.replacingOccurrences(of: "/", with: ""))
        }
    }

    func run(command: String) {
        // A link that launches the app arrives before the window and the menu exist: keep it for later.
        guard panel != nil, statusItem != nil else { pending.append(command); return }
        switch command.lowercased() {
        case "show": setHidden(false)
        case "hide": setHidden(true)
        case "toggle": setHidden(!defaults.bool(forKey: "hidden"))
        case "mute": setMuted(true)
        case "unmute": setMuted(false)
        case "sound": setMuted(!defaults.bool(forKey: "muted"))
        default: break
        }
    }

    func setHidden(_ hide: Bool) {
        defaults.set(hide, forKey: "hidden")
        if hide { panel.orderOut(nil) } else { panel.orderFrontRegardless() }
        refreshMenu()
    }

    func setMuted(_ mute: Bool) {
        defaults.set(mute, forKey: "muted")
        if !mute { Beeps.lastPlayed = .distantPast; Beeps.play("hello") } // a little chirp says the sound is back
        refreshMenu()
    }

    /// Control-Option-R shows or hides the droid, Control-Option-M cuts or brings back its sound, from any app.
    func registerHotKeys() {
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var id = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            DispatchQueue.main.async { delegate.run(command: id.id == 1 ? "toggle" : "sound") }
            return noErr
        }, 1, &type, nil, nil)
        for (n, key) in [(UInt32(1), kVK_ANSI_R), (UInt32(2), kVK_ANSI_M)] {
            var ref: EventHotKeyRef?
            RegisterEventHotKey(UInt32(key), UInt32(controlKey | optionKey),
                EventHotKeyID(signature: OSType(0x4153_544D), id: n), GetApplicationEventTarget(), 0, &ref)
            hotKeys.append(ref)
        }
    }

    // MARK: window

    func buildPanel() {
        let size = NSSize(width: baseSize.width * scale, height: baseSize.height * scale)
        let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let origin = NSPoint(x: visible.maxX - size.width - 24, y: visible.minY + 24)
        panel = NSPanel(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = true // clicks pass through, except over the droid itself
        panel.setFrameAutosaveName("AstromechPanel")
        panel.setFrame(NSRect(origin: panel.frame.origin, size: size), display: false)
        // Saved on a screen that is no longer plugged in: back to the bottom-right of the main screen.
        if !NSScreen.screens.contains(where: { $0.visibleFrame.intersects(panel.frame.insetBy(dx: 40, dy: 40)) }) {
            panel.setFrameOrigin(origin)
        }

        let container = NSView(frame: NSRect(origin: .zero, size: size))
        container.autoresizingMask = [.width, .height]

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "screens")
        web = WKWebView(frame: container.bounds, configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        container.addSubview(web)

        handle = Handle(frame: container.bounds)
        handle.autoresizingMask = [.width, .height]
        handle.droid = droidFrame(for: size)
        handle.onOpen = { [weak self] id in self?.open(session: id) }
        container.addSubview(handle)

        panel.contentView = container
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        if !defaults.bool(forKey: "hidden") { panel.orderFrontRegardless() }
    }

    /// The droid's box in the window's own coordinates (bottom-left origin).
    func droidFrame(for size: NSSize) -> NSRect {
        let k = size.width / baseSize.width
        return NSRect(
            x: droidBox.minX * k, y: (baseSize.height - droidBox.maxY) * k,
            width: droidBox.width * k, height: droidBox.height * k)
    }

    /// Takes the mouse only while the pointer is over the droid or a screen, so the rest stays click-through.
    func trackHover() {
        guard panel.isVisible else { return }
        let inWindow = panel.convertPoint(fromScreen: NSEvent.mouseLocation)
        let over = handle.isGrabbable(handle.convert(inWindow, from: nil))
        let isDragging = NSEvent.pressedMouseButtons & 1 == 1 && isOverGrab
        if over == isOverGrab || isDragging { return }
        isOverGrab = over
        panel.ignoresMouseEvents = !over
        if over { NSCursor.openHand.set() } else { NSCursor.arrow.set() }
    }

    /// Where the page drew each screen (CSS pixels, top-left origin) → the handle's coordinates.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "screens", let list = message.body as? [[String: Any]] else { return }
        let h = web.bounds.height
        handle.screens = list.compactMap { r in
            guard let id = r["id"] as? String, let x = r["x"] as? Double, let y = r["y"] as? Double,
                let w = r["w"] as? Double, let ht = r["h"] as? Double
            else { return nil }
            return (id, NSRect(x: x, y: Double(h) - y - ht, width: w, height: ht))
        }
    }

    /// Opens the conversation a screen belongs to in the Claude app; Claude itself without one.
    func open(session id: String?) {
        if let id { opened[id] = Date().timeIntervalSince1970 * 1000 }
        if let id, let url = Codex.url(for: id) ?? AppSessions.url(for: id) {
            NSWorkspace.shared.open(url)
        } else {
            openClaude()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isReady = true
        poll()
        // `--snapshot <file.png>`: writes what the droid draws, then quits (a check that needs no screen capture).
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--snapshot"), i + 1 < args.count {
            let out = URL(fileURLWithPath: args[i + 1])
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                webView.takeSnapshot(with: nil) { image, _ in
                    if let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                        let png = rep.representation(using: .png, properties: [:])
                    {
                        try? png.write(to: out)
                    }
                    NSApp.terminate(nil)
                }
            }
        }
    }

    // MARK: sessions

    /// What the mod reported, by session: event-precise (permissions included) while it is fresh.
    func modScreens(now: Double) -> [String: Screen] {
        let fm = FileManager.default
        var out: [String: Screen] = [:]
        for name in (try? fm.contentsOfDirectory(atPath: dir)) ?? [] where name.hasSuffix(".json") {
            let path = (dir as NSString).appendingPathComponent(name)
            guard let data = fm.contents(atPath: path),
                let s = try? JSONDecoder().decode(Screen.self, from: data),
                now - s.beat <= staleMs
            else { continue }
            out[s.id] = s
        }
        return out
    }

    func poll() {
        let now = Date().timeIntervalSince1970 * 1000
        let mod = modScreens(now: now)
        let transcripts = Dictionary(
            (Transcripts.scan(now: now) + Codex.scan(now: now)).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let app = AppSessions.map()
        let viewed = AppSessions.viewedNow(app)
        var list: [Screen] = []
        for id in Set(mod.keys).union(transcripts.keys) {
            if app[id]?.isArchived == true { continue } // archived in the Claude app: off the screens
            let m = mod[id]
            let t = transcripts[id]
            let title = app[id]?.title ?? t?.title ?? m?.topic ?? "session"
            let created = min(m?.created ?? .infinity, t?.created ?? .infinity)
            if let m {
                if m.status == "idle" || m.status == "ended" { continue }
                if m.status == "done" && now - m.since > doneKeepMs { continue }
                list.append(Screen(id: id, topic: title, status: m.status, created: created, since: m.since, beat: m.beat))
            } else if let t {
                list.append(Screen(id: id, topic: title, status: t.status, created: created, since: t.modified, beat: t.modified))
            }
        }
        // Busy first, then what waits on the person, then finished; oldest first within each.
        let rank = ["working": 0, "action": 1, "question": 2, "done": 3]
        // A finished screen goes once its conversation has been opened since it finished
        // (or is on show now, after a short moment so the check mark is seen).
        list.removeAll { s in
            guard s.status == "done" else { return false }
            if let at = opened[s.id], at > s.since { return true } // opened from its screen since it finished
            guard let a = app[s.id] else { return false }
            let finished = max(a.lastTurnEdgeAt, 0) > 0 ? a.lastTurnEdgeAt : s.since
            return a.lastFocusedAt > finished || (a.localId == viewed && now - finished > 8_000)
        }
        list.sort { (rank[$0.status] ?? 4, $0.created) < (rank[$1.status] ?? 4, $1.created) }
        beep(for: list, now: now)
        updateStatusTitle(list)
        guard isReady, let data = try? JSONEncoder().encode(list),
            let json = String(data: data, encoding: .utf8)
        else { return }
        web.evaluateJavaScript("update(\(json))", completionHandler: nil)
    }

    /// One beep when a screen has just turned to "?", "!" or done: the most urgent if several did at once.
    func beep(for list: [Screen], now: Double) {
        let previous = lastStatus
        lastStatus = Dictionary(list.map { ($0.id, $0.status) }, uniquingKeysWith: { a, _ in a })
        guard let previous, !defaults.bool(forKey: "muted") else { return }
        let fresh = Set(list.filter { previous[$0.id] != $0.status && now - $0.since < 20_000 }.map(\.status))
        if let sound = ["action", "question", "done"].first(where: fresh.contains) { Beeps.play(sound) }
    }

    func updateStatusTitle(_ list: [Screen]) {
        let mark =
            list.contains { $0.status == "action" } ? " !"
            : list.contains { $0.status == "question" } ? " ?" : ""
        statusItem.button?.title = mark
    }

    // MARK: menu bar

    func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "cpu", accessibilityDescription: "Astromech")
            button.imagePosition = .imageLeft
        }
        statusItem.menu = makeMenu()
    }

    func makeMenu() -> NSMenu {
        let menu = NSMenu()
        let show = NSMenuItem(title: "Afficher le droïde", action: #selector(toggleShown), keyEquivalent: "r")
        show.keyEquivalentModifierMask = [.control, .option]
        show.state = defaults.bool(forKey: "hidden") ? .off : .on
        menu.addItem(show)
        let sound = NSMenuItem(title: "Sons", action: #selector(toggleSound), keyEquivalent: "m")
        sound.keyEquivalentModifierMask = [.control, .option]
        sound.state = defaults.bool(forKey: "muted") ? .off : .on
        menu.addItem(sound)

        let sizes = NSMenu()
        for (title, value) in [("Petit", 0.7), ("Moyen", 1.0), ("Grand", 1.4)] {
            let item = NSMenuItem(title: title, action: #selector(setSize(_:)), keyEquivalent: "")
            item.representedObject = value
            item.state = abs(Double(scale) - value) < 0.01 ? .on : .off
            item.target = self
            sizes.addItem(item)
        }
        let sizeItem = NSMenuItem(title: "Taille", action: nil, keyEquivalent: "")
        sizeItem.submenu = sizes
        menu.addItem(sizeItem)

        let tip = NSMenuItem(title: "Glisse le droïde pour le déplacer, double-clic pour ouvrir Claude", action: nil, keyEquivalent: "")
        tip.isEnabled = false
        menu.addItem(tip)

        menu.addItem(.separator())
        let login = NSMenuItem(title: "Ouvrir au démarrage du Mac", action: #selector(toggleLogin), keyEquivalent: "")
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(NSMenuItem(title: "Ouvrir Claude", action: #selector(openClaude), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quitter Astromech", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        for item in menu.items where item.action != nil && item.action != #selector(NSApplication.terminate(_:)) {
            item.target = self
        }
        return menu
    }

    func refreshMenu() { statusItem.menu = makeMenu() }

    @objc func toggleShown() { run(command: "toggle") }
    @objc func toggleSound() { run(command: "sound") }

    @objc func setSize(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? Double else { return }
        defaults.set(value, forKey: "scale")
        let old = panel.frame
        let size = NSSize(width: baseSize.width * value, height: baseSize.height * value)
        // keep the bottom-right corner where it is
        let frame = NSRect(x: old.maxX - size.width, y: old.minY, width: size.width, height: size.height)
        panel.setFrame(frame, display: true, animate: true)
        handle.droid = droidFrame(for: size)
        refreshMenu()
    }

    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Impossible de changer l'ouverture au démarrage"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
        refreshMenu()
    }

    @objc func openClaude() {
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.anthropic.claudefordesktop") {
            NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
