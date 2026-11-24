// Reads, without changing anything, what the droid shows (port of the Mac app's Swift):
// - the files the mod writes (~/.claude/astromech/sessions/<id>.json);
// - Claude Code transcripts (~/.claude/projects/<folder>/<session id>.jsonl);
// - Codex threads (~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread id>.jsonl);
// - the Claude app's record of its Code sessions (%APPDATA%\Claude\claude-code-sessions).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const HOME = os.homedir()
const MOD_DIR = path.join(HOME, '.claude', 'astromech', 'sessions')
const PROJECTS = path.join(HOME, '.claude', 'projects')
const CODEX = path.join(HOME, '.codex')
const CODEX_PREFIX = 'codex:'

const STALE_MS = 60_000 // a mod file silent this long belongs to a closed session
const LOOK_BACK_MS = 3 * 3600_000 // a question waits this long on screen; older transcripts are skipped
const WORKING_MS = 15 * 60_000 // a "working" transcript silent this long has stopped
const DONE_KEEP_MS = 10 * 60_000 // a finished screen stays 10 minutes

const list = dir => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}
const stat = file => {
  try {
    return fs.statSync(file)
  } catch {
    return undefined
  }
}
const created = st => (st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs)

/** Records of the last `bytes` of the file (the first, cut line dropped), or the first `bytes`. */
function records(file, bytes, fromEnd) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return []
  }
  try {
    const size = fs.fstatSync(fd).size
    const start = fromEnd && size > bytes ? size - bytes : 0
    const len = Math.min(bytes, size)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, start)
    const lines = buf.toString('utf8').split('\n').filter(l => l.trim().length > 0)
    if (start > 0 && lines.length) lines.shift()
    if (!fromEnd && size > bytes && lines.length) lines.pop()
    const out = []
    for (const line of lines) {
      try {
        const r = JSON.parse(line)
        if (r && typeof r === 'object' && !Array.isArray(r)) out.push(r)
      } catch {
        // a line being written right now
      }
    }
    return out
  } catch {
    return []
  } finally {
    fs.closeSync(fd)
  }
}

/** Keeps a transcript on screen only while its state is still worth showing. */
const fresh = (state, now) => {
  const age = now - state.modified
  switch (state.status) {
    case 'working':
      return age <= WORKING_MS
    case 'done':
      return age <= DONE_KEEP_MS
    case 'question':
    case 'action':
      return true
    default:
      return false
  }
}

// MARK: the mod's files

function modScreens(now) {
  const out = new Map()
  for (const name of list(MOD_DIR)) {
    if (!name.endsWith('.json')) continue
    try {
      const s = JSON.parse(fs.readFileSync(path.join(MOD_DIR, name), 'utf8'))
      if (typeof s.id !== 'string' || typeof s.beat !== 'number' || now - s.beat > STALE_MS) continue
      out.set(s.id, s)
    } catch {
      // a file being written right now: next poll
    }
  }
  return out
}

// MARK: Claude Code transcripts

const transcriptCache = new Map() // path → { modified, state }

const blocks = r => (Array.isArray(r.message?.content) ? r.message.content : [])
const TAG_BLOCK = /<([a-zA-Z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g

/** The words a person typed in a user record, undefined for tool results and injected rows. */
function typedText(r) {
  if (r.type !== 'user' || r.isMeta === true) return undefined
  const content = r.message?.content
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    if (content.some(b => b?.type === 'tool_result')) return undefined
    text = content
      .filter(b => b?.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n')
  }
  const cleaned = text.replace(TAG_BLOCK, ' ').trim()
  if (!cleaned || cleaned.startsWith('<') || cleaned.startsWith('[')) return undefined
  return cleaned
}

/** A user record that opens a turn: a prompt or an injected message, not a tool's result. */
function startsTurn(r) {
  if (r.type !== 'user' || r.isMeta === true) return false
  const content = r.message?.content
  if (typeof content === 'string') return true
  return !(Array.isArray(content) ? content : []).some(b => b?.type === 'tool_result')
}

/** A finished turn: the desktop app's end-of-turn box says whether something waits on the person. */
function endOfTurn(turn, answer) {
  for (let i = turn.length - 1; i >= 0; i--) {
    const r = turn[i]
    if (startsTurn(r)) break // back at the prompt that started the turn
    if (r.type !== 'assistant') continue
    for (const b of blocks(r)) {
      if (!String(b?.name ?? '').endsWith('__wrap_up')) continue
      const input = b.input ?? {}
      if (input.blocked === true) return 'action'
      if (typeof input.ask === 'string' && input.ask.length > 0) return 'question'
      return 'done'
    }
  }
  const text = answer
    .map(b => (typeof b?.text === 'string' ? b.text : ''))
    .join('')
    .trim()
  return /\?\s*[)*_`"»]*$/.test(text) ? 'question' : 'done'
}

function readTranscript(file, id, createdAt, modified) {
  const tail = records(file, 512 * 1024, true).filter(r => r.isSidechain !== true)
  let title = tail.findLast(r => r.type === 'custom-title')?.customTitle
  if (typeof title !== 'string') {
    const head = records(file, 256 * 1024, false)
    title = head.findLast(r => r.type === 'custom-title')?.customTitle
    if (typeof title !== 'string') {
      for (const r of head) {
        const t = typedText(r)
        if (t) {
          title = t.slice(0, 60)
          break
        }
      }
    }
  }

  const turn = tail.filter(r => r.type === 'user' || r.type === 'assistant')
  const last = turn[turn.length - 1]
  if (!last) return undefined
  let status
  if (last.type === 'assistant') {
    const content = blocks(last)
    const stop = last.message?.stop_reason
    const pending = content.findLast(b => b?.type === 'tool_use')
    if (stop === 'tool_use' || (stop == null && pending)) {
      const tool = pending?.name ?? ''
      status = tool === 'AskUserQuestion' ? 'question' : tool === 'ExitPlanMode' ? 'action' : 'working'
    } else {
      status = endOfTurn(turn, content)
    }
  } else {
    const content = last.message?.content
    const text =
      blocks(last)
        .map(b => (typeof b?.text === 'string' ? b.text : ''))
        .join('') + (typeof content === 'string' ? content : '')
    status = text.includes('[Request interrupted by user') ? 'idle' : 'working'
  }
  return { id, title: typeof title === 'string' ? title : undefined, status, created: createdAt, modified }
}

function scanTranscripts(now) {
  const out = []
  for (const folder of list(PROJECTS)) {
    const dir = path.join(PROJECTS, folder)
    for (const name of list(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const file = path.join(dir, name)
      const st = stat(file)
      if (!st || !st.isFile()) continue
      const modified = st.mtimeMs
      if (now - modified > LOOK_BACK_MS) continue
      let state
      const hit = transcriptCache.get(file)
      if (hit && hit.modified === modified) {
        state = hit.state
      } else {
        state = readTranscript(file, name.slice(0, -6), created(st), modified)
        transcriptCache.set(file, { modified, state })
      }
      if (state && fresh(state, now)) out.push(state)
    }
  }
  return out
}

// MARK: Codex threads

const codexCache = new Map()
let codexNames = { modified: 0, byId: {} }

/** The titles the app gives its threads (session_index.jsonl, the last line per thread wins). */
function threadNames() {
  const file = path.join(CODEX, 'session_index.jsonl')
  const st = stat(file)
  if (!st) return {}
  if (st.mtimeMs === codexNames.modified) return codexNames.byId
  const byId = {}
  for (const r of records(file, 1 << 20, true)) {
    if (typeof r.id === 'string' && typeof r.thread_name === 'string' && r.thread_name) byId[r.id] = r.thread_name
  }
  codexNames = { modified: st.mtimeMs, byId }
  return byId
}

function readCodex(file, createdAt, modified) {
  const head = records(file, 64 << 10, false)
  const meta = head.find(r => r.type === 'session_meta')?.payload
  const thread = meta?.id
  if (typeof thread !== 'string') return undefined
  let title
  let status
  let asked = false // the turn put a question to the person (request_user_input)
  for (const r of records(file, 512 << 10, true)) {
    const p = r.payload
    const type = p?.type
    if (typeof type !== 'string') continue
    if (title === undefined && type === 'item_completed' && p.item?.type === 'UserMessage' && Array.isArray(p.item.content)) {
      const text = p.item.content
        .filter(c => typeof c?.text === 'string')
        .map(c => c.text)
        .join(' ')
      title = text.split('\n')[0].slice(0, 60)
    }
    if (type === 'task_started') {
      status = 'working'
      asked = false
    } else if (type === 'function_call' && String(p.name ?? '').startsWith('request_user_input')) {
      status = 'question'
      asked = true
    } else if (type.endsWith('approval_request')) {
      status = 'action'
    } else if (type === 'item_completed' || type === 'function_call_output' || type === 'custom_tool_call_output') {
      if (status === 'action') status = 'working' // the approval was answered
    } else if (type === 'task_complete') {
      const last = String(p.last_agent_message ?? '').trim()
      status = asked || last.endsWith('?') ? 'question' : 'done'
    } else if (type === 'turn_aborted') {
      status = 'idle'
    }
  }
  if (!status) return undefined
  return { id: CODEX_PREFIX + thread, title, status, created: createdAt, modified }
}

const dayFolder = ms => {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return [String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())]
}

function scanCodex(now) {
  const out = []
  const titles = threadNames()
  // Only the folders of the last two days can hold a file written in the last hours.
  const days = new Set([now, now - 86_400_000].map(ms => dayFolder(ms).join('/')))
  for (const day of days) {
    const dir = path.join(CODEX, 'sessions', ...day.split('/'))
    for (const name of list(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const file = path.join(dir, name)
      const st = stat(file)
      if (!st || !st.isFile()) continue
      const modified = st.mtimeMs
      if (now - modified > LOOK_BACK_MS) continue
      let state
      const hit = codexCache.get(file)
      if (hit && hit.modified === modified) {
        state = hit.state
      } else {
        state = readCodex(file, created(st), modified)
        codexCache.set(file, { modified, state })
      }
      if (!state || !fresh(state, now)) continue
      const thread = state.id.slice(CODEX_PREFIX.length)
      out.push({ ...state, title: titles[thread] ?? state.title })
    }
  }
  return out
}

// MARK: the Claude app's sessions

/** Where the Claude desktop app keeps its data: %APPDATA%\Claude on Windows. */
const appDataDir = () => {
  if (process.platform === 'win32') return process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming')
  if (process.platform === 'darwin') return path.join(HOME, 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME ?? path.join(HOME, '.config')
}
const APP_SESSIONS = path.join(appDataDir(), 'Claude', 'claude-code-sessions')

const appCache = new Map() // path → { modified, ids, session }
let byTranscript = new Map()
let lastAppScan = 0

function* walk(dir, depth = 0) {
  if (depth > 4) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p, depth + 1)
    else if (e.isFile()) yield p
  }
}

/** Transcript (CLI session) id → the app's session; re-read at most every 5 seconds. */
function appSessions() {
  if (Date.now() - lastAppScan < 5000) return byTranscript
  lastAppScan = Date.now()
  const out = new Map()
  for (const file of walk(APP_SESSIONS)) {
    const base = path.basename(file)
    if (!base.startsWith('local_') || !base.endsWith('.json')) continue
    const st = stat(file)
    if (!st) continue
    let entry = appCache.get(file)
    if (!entry || entry.modified !== st.mtimeMs) {
      try {
        const d = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (typeof d.sessionId !== 'string') continue
        entry = {
          modified: st.mtimeMs,
          ids: [d.cliSessionId, d.lastAssistantCliSessionId].filter(x => typeof x === 'string'),
          session: {
            localId: d.sessionId,
            title: typeof d.title === 'string' ? d.title : undefined,
            isArchived: d.isArchived === true,
            lastFocusedAt: typeof d.lastFocusedAt === 'number' ? d.lastFocusedAt : 0,
            lastTurnEdgeAt: typeof d.lastTurnEdgeAt === 'number' ? d.lastTurnEdgeAt : 0,
          },
        }
        appCache.set(file, entry)
      } catch {
        continue
      }
    }
    for (const id of entry.ids) out.set(id, entry.session)
  }
  byTranscript = out
  return out
}

/** The link that opens a screen's conversation: in ChatGPT for Codex, in Claude otherwise. */
function urlFor(id) {
  if (id.startsWith(CODEX_PREFIX)) return `codex://threads/${id.slice(CODEX_PREFIX.length)}`
  const s = appSessions().get(id)
  return s ? `claude://claude.ai/epitaxy/${s.localId}` : undefined
}

module.exports = { modScreens, scanTranscripts, scanCodex, appSessions, urlFor, DONE_KEEP_MS }
