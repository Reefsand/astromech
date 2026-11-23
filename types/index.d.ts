export type ScreenStatus = 'working' | 'question' | 'action' | 'done' | 'idle' | 'ended'

/** One session's screen, as every session's mod writes it to the shared folder. */
export type Screen = {
  id: string
  topic: string
  status: ScreenStatus
  /** When the session first wrote its file (ms). */
  created: number
  /** When `status` last changed (ms). */
  since: number
  /** Last heartbeat (ms): a session silent for long is gone. */
  beat: number
}

declare module 'claude-code' {
  interface PluginState {
    astromech: { screens: Shaped<Screen[]> }
  }
}
