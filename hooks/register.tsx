import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Screen, ScreenStatus } from '../types'
import { glyphOf, sceneSvg } from './svg'

const PANE = 'astromech'
/** What `/astromech <word>` sends to the floating droid, and what it answers. */
const DESKTOP_WORDS: Record<string, [string, string]> = {
  cacher: ['hide', 'Droïde caché.'],
  montrer: ['show', 'Droïde affiché.'],
  basculer: ['toggle', 'Droïde affiché ou caché.'],
  muet: ['mute', 'Son coupé.'],
  son: ['unmute', 'Son remis.'],
}
const TITLE = 'Astromech'
const BEAT_MS = 15_000 // heartbeat of this session's file
const STALE_MS = 60_000 // a file silent this long belongs to a closed session
const DONE_KEEP_MS = 10 * 60_000 // a finished screen stays this long
const POLL_MS = 1_500 // how often the widget re-reads every session's file

// Change the tag when Screen's fields change: it declines what an earlier version stored.
const screens = atom({ plugin: 'astromech', key: 'screens' } as const, [] as Screen[], {
  shape: 'screens-1',
})

type Engine = EngineInterface

// This session's own screen. Module variables start over on a reload:
// session.start reads the session's file back.
let me: Screen | undefined
let dir: string | undefined
let defaultTopic = ''
let pendingEnd: ScreenStatus | undefined

const fileOf = (id: string) => `${dir}/${id.replace(/[^\w.-]/g, '_')}.json`

const topicFrom = (text: string) => {
  const line = text
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0)
  return line ? line.replace(/\s+/g, ' ').slice(0, 60) : undefined
}

/** The first prompt the person typed in the session, skipping notices the engine injects. */
const firstPrompt = async ($: Engine) => {
  try {
    const messages = await $.session.messages()
    for (const m of messages) {
      if (m.role !== 'user') continue
      // Drop whole blocks the engine wraps around or ahead of a prompt
      // (<system-reminder>…</system-reminder>, a task notification): what is left was typed.
      const text = m.text.replace(/<([a-zA-Z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, ' ').trim()
      if (!text || text.startsWith('<') || text.startsWith('[')) continue
      const topic = topicFrom(text)
      if (topic) return topic
    }
  } catch {
    // no transcript yet
  }
  return undefined
}

const write = async ($: Engine) => {
  if (!me || !dir) return
  me = { ...me, beat: Date.now() }
  await $.fs.write(fileOf(me.id), JSON.stringify(me))
}

const sameView = (a: Screen[], b: Screen[]) =>
  a.length === b.length &&
  a.every((s, i) => s.id === b[i]?.id && s.status === b[i]?.status && s.topic === b[i]?.topic)

const poll = async ($: Engine) => {
  if (!dir) return
  const entries = await $.fs.list(dir).catch(() => [])
  const now = Date.now()
  const found: Screen[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    if (now - entry.mtimeMs > STALE_MS * 2) continue
    try {
      const s = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Screen
      if (now - s.beat > STALE_MS) continue
      if (s.status === 'idle' || s.status === 'ended') continue
      if (s.status === 'done' && now - s.since > DONE_KEEP_MS) continue
      found.push(s)
    } catch {
      // a file being written right now: next poll
    }
  }
  found.sort((a, b) => a.created - b.created)
  const current = await read($, screens)
  if (!sameView(current, found)) await update($, screens, () => found)
}

// Never throws: a hiccup of the droid must not get in the way of a tool call or a turn.
const setStatus = async ($: Engine, status: ScreenStatus) => {
  if (!me) return
  if (me.status !== status) me = { ...me, status, since: Date.now() }
  try {
    await write($)
    await poll($)
  } catch {
    // the next heartbeat or poll catches up
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? ''
    dir = `${home}/.claude/astromech/sessions`
    const id = await $.session.id()
    const cwd = await $.session.cwd()
    defaultTopic = cwd.split('/').filter(Boolean).pop() ?? 'session'
    const now = Date.now()
    try {
      me = JSON.parse(await $.fs.read(fileOf(id))) as Screen
    } catch {
      me = { id, topic: defaultTopic, status: 'idle', created: now, since: now, beat: now }
    }
    const typed = await firstPrompt($)
    if (typed) me = { ...me, topic: typed }
    await write($)

    $.clock.every(BEAT_MS, () => void write($))
    $.clock.every(POLL_MS, () => void poll($))

    await $.command.register({
      name: 'astromech',
      description: 'Ouvre le droïde ; « cacher », « montrer », « muet » ou « son » pour le droïde flottant',
    })
    if ((await $.session.surface()) === 'desktop') {
      void $.ui.open({ id: PANE, title: TITLE, placement: 'widget' })
    }
    void poll($)

    return next(e)
  })

  // `/astromech cacher`, `montrer`, `muet`, `son`… drive the floating droid (Astromech.app)
  // through its astromech:// links; with no word, the command opens the widget.
  on('command.run', { command: 'astromech' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (!word) {
      await $.ui.open({ id: PANE, title: TITLE, placement: 'widget' })
      return { text: 'Droïde ouvert.' }
    }
    const action = DESKTOP_WORDS[word]
    if (!action) return { text: `Mots compris : ${Object.keys(DESKTOP_WORDS).join(', ')}.` }
    const run = await $.process.run(['open', '-g', `astromech://${action[0]}`]).catch(() => undefined)
    if (!run || run.exitCode !== 0) return { text: "Le droïde flottant (Astromech.app) n'est pas installé sur ce Mac." }
    return { text: action[1] }
  })

  on('session.end', async ($, e, next) => {
    if (me) {
      me = { ...me, status: 'ended', since: Date.now() }
      await write($).catch(() => undefined)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined || !me) return next(e)
    pendingEnd = undefined
    await setStatus($, 'working')

    return next(e)
  })

  // The screen's title: the first prompt the person types, never an injected notice.
  on('prompt.submit', async ($, e, next) => {
    if (me && me.topic === defaultTopic && !e.isMeta && !e.command) {
      const topic = topicFrom(e.text)
      if (topic) me = { ...me, topic }
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const name = String(e.tool)
    const args = e as unknown as Record<string, unknown>

    if (name === 'AskUserQuestion' || name === 'ExitPlanMode') {
      await setStatus($, name === 'AskUserQuestion' ? 'question' : 'action')
      const ran = await next(e)
      await setStatus($, 'working')

      return ran
    }
    // The desktop app's end-of-turn box: a blocking ask is an action for the
    // person, a plain ask a question, none a finished job.
    if (name.endsWith('__wrap_up')) {
      const ask = typeof args.ask === 'string' && args.ask.length > 0
      pendingEnd = args.blocked === true ? 'action' : ask ? 'question' : 'done'

      return next(e)
    }
    const ran = await next(e)
    if (me?.status === 'action') await setStatus($, 'working')

    return ran
  })

  // A permission dialog actually shown to the person: "!". (tool.check also says
  // `ask` when auto mode's classifier decides, which needs nobody.)
  on('classic.PermissionRequest', async ($, e, next) => {
    await setStatus($, 'action')

    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt') await setStatus($, 'action')

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || !me) return done
    let end: ScreenStatus
    if (e.isAborted || e.reason === 'aborted') end = 'idle'
    else if (e.reason === 'error' || e.reason === 'refusal') end = 'action'
    else if (pendingEnd) end = pendingEnd
    else end = /\?\s*[)*_`"»]*\s*$/.test(e.answer.trim()) ? 'question' : 'done'
    pendingEnd = undefined
    await setStatus($, end)

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, screens)
    const alt =
      list.length === 0
        ? 'Droïde au repos, aucun sujet en cours'
        : `Droïde, ${list.length} écran(s) : ${list.map(s => `${s.topic} (${glyphOf[s.status]})`).join(', ')}`

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text>{list.some(s => s.status === 'working') ? '[◉] bip-bop… ' : '[◉] '}droïde</Text>
          {list.length === 0 && <Text dimColor>aucun sujet en cours</Text>}
          {list.map(s => (
            <Text>
              {glyphOf[s.status]} {s.topic}
            </Text>
          ))}
        </Box>
      )
    }

    const { Box, Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" alignItems="center">
        <Svg source={sceneSvg(list)} alt={alt} isInteractive />
      </Box>
    )
  })
}
