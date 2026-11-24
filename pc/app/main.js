// Astromech for Windows: the droid of the "astromech" mod, floating above every window.
// One screen per Claude Code (or Codex) session, read from the mod's files and the transcripts.
// A port of the Mac app (desktop/*.swift): same drawing, same rules, same commands.

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, shell } = require('electron')

const sessions = require('./sessions')

const BASE = { width: 300, height: 240 }
const POLL_MS = 1500
const RANK = { working: 0, action: 1, question: 2, done: 3 }
const SIZES = [
  ['Petit', 0.7],
  ['Moyen', 1.0],
  ['Grand', 1.4],
]

const args = process.argv
const snapshotAt = args.indexOf('--snapshot')
const snapshotFile = snapshotAt >= 0 ? path.resolve(args[snapshotAt + 1] ?? 'astromech.png') : undefined

/** `astromech://hide` (or show, toggle, mute, unmute, sound) found among command-line arguments. */
const commandsIn = argv =>
  argv
    .filter(a => /^astromech:/i.test(a))
    .map(a => {
      try {
        const u = new URL(a)
        return (u.hostname || u.pathname.replace(/\//g, '')).toLowerCase()
      } catch {
        return ''
      }
    })
    .filter(Boolean)

// MARK: settings (a small JSON file next to Electron's own data)

let settingsFile
let settings = { hidden: false, muted: false, scale: 1 }
const loadSettings = () => {
  settingsFile = path.join(app.getPath('userData'), 'settings.json')
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }
  } catch {
    // first launch
  }
}
const saveSettings = () => {
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
  } catch {
    // not worth bothering anyone over
  }
}

// MARK: state

let win
let tray
let isReady = false
let lastStatus = null // null until the first look: what is there at launch makes no sound
let lastMark = ''
const opened = new Map() // finished screens double-clicked: their conversation was opened
const pending = [] // commands from links that arrived while the app was still starting

const sizeFor = scale => ({ width: Math.round(BASE.width * scale), height: Math.round(BASE.height * scale) })

/** Bottom-right of the main screen, clear of the taskbar. */
const homeBounds = size => {
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - size.width - 24, y: area.y + area.height - size.height - 24, ...size }
}

const isOnSomeScreen = b =>
  screen.getAllDisplays().some(d => {
    const a = d.workArea
    return b.x + b.width - 40 > a.x && b.x + 40 < a.x + a.width && b.y + b.height - 40 > a.y && b.y + 40 < a.y + a.height
  })

// MARK: window

function buildWindow() {
  const size = sizeFor(settings.scale)
  let bounds = typeof settings.x === 'number' && typeof settings.y === 'number' ? { x: settings.x, y: settings.y, ...size } : homeBounds(size)
  // Saved on a screen that is no longer plugged in: back to the bottom-right of the main screen.
  if (!isOnSomeScreen(bounds)) bounds = homeBounds(size)

  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false, // never takes the keyboard from the app in use
    show: false,
    title: 'Astromech',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Clicks pass through, except over the droid and its screens (the page says when: see pc.js).
  win.setIgnoreMouseEvents(true, { forward: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.webContents.on('console-message', e => {
    if (e.level === 'error' || snapshotFile) console.log(`[page] ${e.message}`)
  })

  win.webContents.on('did-finish-load', () => {
    isReady = true
    poll()
    if (snapshotFile) {
      // `--snapshot <file.png>`: writes what the droid draws, then quits (a check that needs no screen capture).
      setTimeout(async () => {
        const check = await win.webContents.executeJavaScript(
          `({ beeps: typeof window.playBeep, bridge: typeof window.astromech?.grab, screens: document.querySelectorAll('[data-id]').length })`,
        )
        console.log('check', JSON.stringify(check))
        const image = await win.webContents.capturePage()
        fs.writeFileSync(snapshotFile, image.toPNG())
        console.log(snapshotFile)
        app.exit(0)
      }, 2500)
    }
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  if (snapshotFile || !settings.hidden) win.showInactive()
}

ipcMain.on('grab', (e, over) => {
  if (!win || e.sender !== win.webContents) return
  win.setIgnoreMouseEvents(!over, { forward: true })
})

// A drag follows the pointer until the page reports the button released.
let drag
ipcMain.on('drag-start', e => {
  if (!win || e.sender !== win.webContents) return
  const start = screen.getCursorScreenPoint()
  const from = win.getBounds()
  clearInterval(drag)
  drag = setInterval(() => {
    const p = screen.getCursorScreenPoint()
    win.setBounds({ x: from.x + p.x - start.x, y: from.y + p.y - start.y, width: from.width, height: from.height })
  }, 16)
})
ipcMain.on('drag-end', e => {
  if (!win || e.sender !== win.webContents) return
  clearInterval(drag)
  drag = undefined
  const b = win.getBounds()
  settings.x = b.x
  settings.y = b.y
  saveSettings()
})

ipcMain.on('open', (e, id) => {
  if (!win || e.sender !== win.webContents) return
  openSession(typeof id === 'string' ? id : null)
})

/** Opens the conversation a screen belongs to (in Claude, or ChatGPT for Codex); Claude itself without one. */
function openSession(id) {
  if (id) opened.set(id, Date.now())
  const url = id ? sessions.urlFor(id) : undefined
  shell.openExternal(url ?? 'claude://').catch(() => undefined)
}

// MARK: commands (astromech://… links, keyboard shortcuts, tray menu)

function run(command) {
  // A link that launches the app arrives before the window and the menu exist: keep it for later.
  if (!win || !tray) {
    pending.push(command)
    return
  }
  switch (command) {
    case 'show':
      return setHidden(false)
    case 'hide':
      return setHidden(true)
    case 'toggle':
      return setHidden(!settings.hidden)
    case 'mute':
      return setMuted(true)
    case 'unmute':
      return setMuted(false)
    case 'sound':
      return setMuted(!settings.muted)
  }
}

function setHidden(hide) {
  settings.hidden = hide
  saveSettings()
  if (hide) win.hide()
  else win.showInactive()
  refreshMenu()
}

function setMuted(mute) {
  settings.muted = mute
  saveSettings()
  if (!mute) beep('hello', true) // a little chirp says the sound is back
  refreshMenu()
}

function setScale(scale) {
  settings.scale = scale
  const old = win.getBounds()
  const size = sizeFor(scale)
  // keep the bottom-right corner where it is
  win.setBounds({ x: old.x + old.width - size.width, y: old.y + old.height - size.height, ...size })
  const b = win.getBounds()
  settings.x = b.x
  settings.y = b.y
  saveSettings()
  refreshMenu()
}

/** Control+Alt+R shows or hides the droid, Control+Alt+M cuts or brings back its sound, from any app. */
function registerShortcuts() {
  globalShortcut.register('Control+Alt+R', () => run('toggle'))
  globalShortcut.register('Control+Alt+M', () => run('sound'))
}

// MARK: tray

const icon = name => nativeImage.createFromPath(path.join(__dirname, 'icons', `${name}.png`))

function buildTray() {
  tray = new Tray(icon('tray'))
  tray.setToolTip('Astromech')
  tray.on('click', () => run('toggle'))
  refreshMenu()
}

function refreshMenu() {
  if (!tray) return
  const login = app.getLoginItemSettings().openAtLogin
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Afficher le droïde', type: 'checkbox', checked: !settings.hidden, accelerator: 'Control+Alt+R', registerAccelerator: false, click: () => run('toggle') },
      { label: 'Sons', type: 'checkbox', checked: !settings.muted, accelerator: 'Control+Alt+M', registerAccelerator: false, click: () => run('sound') },
      {
        label: 'Taille',
        submenu: SIZES.map(([label, value]) => ({
          label,
          type: 'radio',
          checked: Math.abs(settings.scale - value) < 0.01,
          click: () => setScale(value),
        })),
      },
      { label: 'Glisse le droïde pour le déplacer, double-clic pour ouvrir Claude', enabled: false },
      { type: 'separator' },
      {
        label: "Ouvrir au démarrage de l'ordinateur",
        type: 'checkbox',
        checked: login,
        click: () => {
          app.setLoginItemSettings({ openAtLogin: !login })
          refreshMenu()
        },
      },
      { label: 'Ouvrir Claude', click: () => openSession(null) },
      { label: 'Remettre en bas à droite', click: () => {
          win.setBounds(homeBounds(sizeFor(settings.scale)))
          delete settings.x
          delete settings.y
          saveSettings()
        } },
      { type: 'separator' },
      { label: 'Quitter Astromech', click: () => app.quit() },
    ]),
  )
}

/** "!" or "?" on the tray icon while something waits on the person. */
function updateTray(list) {
  if (!tray) return
  const mark = list.some(s => s.status === 'action') ? '!' : list.some(s => s.status === 'question') ? '?' : ''
  if (mark === lastMark) return
  lastMark = mark
  tray.setImage(icon(mark === '!' ? 'tray-action' : mark === '?' ? 'tray-question' : 'tray'))
  tray.setToolTip(mark === '!' ? 'Astromech : une action t’attend' : mark === '?' ? 'Astromech : une question t’attend' : 'Astromech')
  if (process.platform === 'darwin') tray.setTitle(mark ? ` ${mark}` : '')
}

// MARK: sessions

function poll() {
  const now = Date.now()
  const mod = sessions.modScreens(now)
  const transcripts = new Map()
  for (const t of [...sessions.scanTranscripts(now), ...sessions.scanCodex(now)]) if (!transcripts.has(t.id)) transcripts.set(t.id, t)
  const appMap = sessions.appSessions()
  let list = []
  for (const id of new Set([...mod.keys(), ...transcripts.keys()])) {
    const a = appMap.get(id)
    if (a?.isArchived) continue // archived in the Claude app: off the screens
    const m = mod.get(id)
    const t = transcripts.get(id)
    const topic = a?.title ?? t?.title ?? m?.topic ?? 'session'
    const created = Math.min(m?.created ?? Infinity, t?.created ?? Infinity)
    if (m) {
      if (m.status === 'idle' || m.status === 'ended') continue
      if (m.status === 'done' && now - m.since > sessions.DONE_KEEP_MS) continue
      list.push({ id, topic, status: m.status, created, since: m.since, beat: m.beat })
    } else if (t) {
      list.push({ id, topic, status: t.status, created, since: t.modified, beat: t.modified })
    }
  }
  // A finished screen goes once its conversation has been opened since it finished.
  list = list.filter(s => {
    if (s.status !== 'done') return true
    const at = opened.get(s.id)
    if (at && at > s.since) return false // opened from its screen since it finished
    const a = appMap.get(s.id)
    if (!a) return true
    const finished = a.lastTurnEdgeAt > 0 ? a.lastTurnEdgeAt : s.since
    return !(a.lastFocusedAt > finished)
  })
  // Busy first, then what waits on the person, then finished; oldest first within each.
  list.sort((x, y) => (RANK[x.status] ?? 4) - (RANK[y.status] ?? 4) || x.created - y.created)
  beepFor(list, now)
  updateTray(list)
  if (isReady && win && !win.isDestroyed()) {
    win.webContents.executeJavaScript(`update(${JSON.stringify(list)})`).catch(() => undefined)
  }
}

// MARK: beeps (synthesized by the page: see beeps.js)

function beep(name, force = false) {
  if (win && !win.isDestroyed()) win.webContents.send('beep', { name, force })
}

/** One beep when a screen has just turned to "?", "!" or done: the most urgent if several did at once. */
function beepFor(list, now) {
  const previous = lastStatus
  lastStatus = new Map(list.map(s => [s.id, s.status]))
  if (!previous || settings.muted) return
  const fresh = new Set(list.filter(s => previous.get(s.id) !== s.status && now - s.since < 20_000).map(s => s.status))
  const sound = ['action', 'question', 'done'].find(s => fresh.has(s))
  if (sound) beep(sound)
}

// MARK: launch

if (!snapshotFile && !app.requestSingleInstanceLock()) {
  // Already running: the first one receives this launch's arguments (an astromech:// link).
  app.quit()
} else {
  if (process.platform === 'win32') app.setAppUserModelId('local.astromech.droid')
  app.on('second-instance', (_e, argv) => commandsIn(argv).forEach(run))
  app.on('open-url', (e, url) => {
    e.preventDefault()
    commandsIn([url]).forEach(run)
  })
  app.on('window-all-closed', () => {}) // the tray keeps it alive
  app.on('will-quit', () => globalShortcut.unregisterAll())

  app.whenReady().then(() => {
    loadSettings()
    if (process.platform === 'darwin') app.dock?.hide()
    // The installer registers astromech:// links; a copy run from the zip registers itself here.
    if (app.isPackaged && process.platform === 'win32') app.setAsDefaultProtocolClient('astromech')
    buildWindow()
    if (!snapshotFile) {
      buildTray()
      registerShortcuts()
      commandsIn(args).forEach(run)
      pending.splice(0).forEach(run)
    }
    setInterval(poll, POLL_MS)
    screen.on('display-removed', () => {
      if (win && !isOnSomeScreen(win.getBounds())) win.setBounds(homeBounds(sizeFor(settings.scale)))
    })
  })
}
