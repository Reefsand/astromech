import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'astromech',
  component: 'Pane',
  requestId: 'astromech',
  props: {
    title: 'Astromech',
    isFocused: false,
    bodyColumns: 40,
    placement: 'widget',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('a session at work gets a screen with code, then a check mark', async ($, on) => {
  const files = new Map<string, string>()
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/home/me/projet' }))
  on('session.surface', () => ({ value: 'desktop' }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: '<task-notification>mods loaded</task-notification>', toolUses: [] },
      { role: 'user', text: '<system-reminder>contexte</system-reminder>\nRefactor du parser\nen détail', toolUses: [] },
    ],
  }))
  on('clock.every', () => {
    throw new Error('no timers in this test')
  })
  on('command.register', () => ({ value: { command: 'astromech' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.list', () => ({
    value: [...files.keys()].map(path => ({
      name: path.split('/').pop() ?? '',
      kind: 'file',
      size: 1,
      mtimeMs: Date.now(),
      isLink: false,
    })),
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/home/me/projet', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Refactor du parser', turnId: 't1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props.alt).toContain('Refactor du parser')
  expect(svg?.props.alt).toContain('⌨')
  await ui.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /Refactor/ }))?.text).toContain('⌨')
  await term.unmount()

  await $.turn.complete({ answer: 'Tu préfères quelle option ?', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const asked = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await asked.find({ type: 'Svg' }))?.props.alt).toContain('(?)')
  await asked.unmount()

  await $.turn.start({ text: '', turnId: 't2' })
  await $.turn.complete({ answer: 'C’est fait.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  const done = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await done.find({ type: 'Svg' }))?.props.alt).toContain('(✓)')
  await done.unmount()
})

test('/astromech muet cuts the floating droid sound through its link', async ($, on) => {
  const runs: string[][] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'sess-2' }))
  on('session.cwd', () => ({ value: '/home/me' }))
  on('session.surface', () => ({ value: 'terminal' }))
  on('session.messages', () => ({ value: [] }))
  on('clock.every', () => {
    throw new Error('no timers in this test')
  })
  on('command.register', () => ({ value: { command: 'astromech' } }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/home/me', surface: 'terminal', isInteractive: true })
  const muted = await $.command.run({ command: 'astromech', args: 'muet' })
  expect(muted.text).toBe('Son coupé.')
  expect(runs).toEqual([['open', '-g', 'astromech://mute']])
  const unknown = await $.command.run({ command: 'astromech', args: 'danse' })
  expect(unknown.text).toContain('cacher')
})
