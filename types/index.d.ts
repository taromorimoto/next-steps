export type Summary = {
  /** The turn this summary belongs to; also the id of its placed transcript row. */
  turnId: string
  /** Wall-clock length of the turn in milliseconds. */
  ms: number
  /** Suggested next steps; null while they are still being generated. */
  steps: readonly string[] | null
  /** Indexes into `steps` the model recommends; drawn with a star and checked at first. */
  recommended?: readonly number[]
  /** Indexes into `steps` that Claude itself proposed or recommended in the conversation; drawn with the Claude icon and checked at first. */
  byClaude?: readonly number[]
  /** Indexes into `steps` that are higher-level milestones toward the goal, for Claude to drive on its own; drawn with ◎. */
  milestones?: readonly number[]
  /** True when a surface draws its transcript row; false shows it in the band above the prompt instead. */
  isPlaced: boolean
  /** What the steps are generated from (clipped), kept so a reload can finish an interrupted generation. */
  request?: string
  /** The labels' language for this turn, as set or detected from the request. */
  lang?: 'en' | 'fi'
  /** The session's goal as found for this turn. */
  goal?: string | null
  /** The question the assistant ended its turn with, if it did; the steps are then replies to it. */
  question?: string | null
  answer?: string
}

declare module 'claude-code' {
  interface PluginState {
    'next-steps': {
      /** The latest finished turn: its row is the interactive one. */
      last: Summary | null
      selected: readonly number[]
      /** True once the latest row's steps were sent, closed, or a new prompt went in. */
      isHidden: boolean
      /** What the person typed in the band's own field, sent with the picked steps. */
      note: string
      /** Duration of every turn that placed a row, by turn id, so older rows keep theirs. */
      durations: Readonly<Record<string, number>>
      /** The session's goal as last found; kept from turn to turn so it stays stable. */
      goal: string | null
      /** The prompt that started the latest turn, kept across reloads. */
      lastRequest: string
    }
  }
}
