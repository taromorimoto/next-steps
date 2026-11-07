import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import type { Summary } from '../types'

const last = atom({ plugin: 'next-steps', key: 'last' } as const, null)
const selected = atom({ plugin: 'next-steps', key: 'selected' } as const, [])
const isHidden = atom({ plugin: 'next-steps', key: 'isHidden' } as const, true)
const durations = atom({ plugin: 'next-steps', key: 'durations' } as const, {})
const goal = atom({ plugin: 'next-steps', key: 'goal' } as const, null)
const lastRequest = atom({ plugin: 'next-steps', key: 'lastRequest' } as const, '')

const MAX_ROWS = 200
const MAX_STEPS = 5

export type Lang = 'en' | 'fi'

/** "45s", "3m 12s", "1h 4m" in English; "45 s", "3 min 12 s", "1 h 4 min" in Finnish. */
export const formatDuration = (ms: number, lang: Lang = 'en'): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (lang === 'fi') {
    if (h > 0) return `${h} h ${m} min`
    if (m > 0) return `${m} min ${s} s`
    return `${s} s`
  }
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const STRINGS = {
  en: {
    done: 'Done',
    took: 'took',
    loading: 'Getting next steps…',
    send: 'Send selected',
    close: 'Close',
    doTheseNext: 'Do these next:',
  },
  fi: {
    done: 'Valmis',
    took: 'kesto',
    loading: 'Haetaan seuraavia askeleita…',
    send: 'Lähetä valitut',
    close: 'Sulje',
    doTheseNext: 'Tee seuraavaksi nämä:',
  },
} as const

type Strings = (typeof STRINGS)[Lang]

export type LangSetting = Lang | 'auto'

/** The `language` option: "en", "fi", or "auto" (the default, also for anything unknown). */
export const langOf = (options: Readonly<Record<string, unknown>>): LangSetting =>
  options.language === 'en' || options.language === 'fi' ? options.language : 'auto'

const FINNISH_WORDS = new Set([
  'ja', 'on', 'ei', 'se', 'että', 'kun', 'jos', 'eli', 'myös', 'niin', 'nyt', 'vielä', 'kanssa', 'tämä', 'tässä',
  'tee', 'tehdä', 'voitko', 'voisitko', 'pystytkö', 'onko', 'mitä', 'miten', 'miksi', 'missä', 'mikä', 'ole',
  'lisää', 'poista', 'tarkista', 'korjaa', 'muuta', 'kiitos', 'hei', 'joka', 'jotta', 'sitten', 'vain', 'koska',
])

/**
 * Guesses the language of a prompt: Finnish on ä/ö or two common Finnish words,
 * English on three or more other words, else the system locale (LC_ALL / LANG).
 */
export const detectLang = (text: string, locale?: string): Lang => {
  const words = text.toLowerCase().match(/[a-zåäö]+/g) ?? []
  if (/[äö]/i.test(text)) return 'fi'
  if (words.filter(w => FINNISH_WORDS.has(w)).length >= 2) return 'fi'
  if (words.length >= 3) return 'en'
  return locale !== undefined && locale.toLowerCase().startsWith('fi') ? 'fi' : 'en'
}

export type ParsedSteps = { steps: string[]; recommended: number[] }

/**
 * Pulls the steps out of a model reply, tolerating code fences and prose around the JSON.
 * Takes `[{ "step": "...", "recommended": true }, ...]`, or plain strings (none recommended).
 */
export const parseSteps = (text: string): ParsedSteps => {
  const none: ParsedSteps = { steps: [], recommended: [] }
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return none
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed)) return none
    const items = parsed
      .map(item => {
        if (typeof item === 'string') return { step: item.trim(), recommended: false }
        if (item !== null && typeof item === 'object' && typeof (item as { step?: unknown }).step === 'string') {
          const o = item as { step: string; recommended?: unknown }
          return { step: o.step.trim(), recommended: o.recommended === true }
        }
        return null
      })
      .filter((x): x is { step: string; recommended: boolean } => x !== null && x.step.length > 0)
      .slice(0, MAX_STEPS)
    return {
      steps: items.map(x => x.step),
      recommended: items.flatMap((x, i) => (x.recommended ? [i] : [])),
    }
  } catch {
    return none
  }
}

export type Suggestion = ParsedSteps & { goal: string | null }

/**
 * Pulls `{ "goal": "...", "steps": [...] }` out of a model reply; a bare steps
 * array (no goal) is taken too.
 */
export const parseSuggestion = (text: string): Suggestion => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start && (text.indexOf('[') < 0 || start < text.indexOf('['))) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1))
      if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { steps?: unknown }).steps)) {
        const o = parsed as { goal?: unknown; steps: unknown[] }
        const goalText = typeof o.goal === 'string' && o.goal.trim().length > 0 ? o.goal.trim() : null
        return { goal: goalText, ...parseSteps(JSON.stringify(o.steps)) }
      }
    } catch {
      // Fall through to a bare array.
    }
  }
  return { goal: null, ...parseSteps(text) }
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max / 2)}\n…\n${text.slice(-max / 2)}`

const goalLine = (previousGoal: string | null) =>
  previousGoal === null
    ? ''
    : `The goal noted so far: "${previousGoal}". Keep it, word for word, unless the conversation has clearly moved on to something else.`

const ASK = `Mark as recommended the steps you would advise doing next (at least one, usually one to three); leave optional or speculative ones unmarked.

Reply with only JSON: {"goal": "...", "steps": [{"step": "...", "recommended": true}, ...]}`

/** Asked of a fork of the session's own transcript: it knows the whole conversation. */
const forkPrompt = (previousGoal: string | null) => `Step outside the conversation for a moment: do not continue the work, call no tools, and do not address the user.

1. In one short sentence (max ~15 words), state the overall goal of this whole session: what the user is ultimately trying to achieve, not just their last message. ${goalLine(previousGoal)}
2. Suggest 3 to ${MAX_STEPS} concrete next steps the user might want the assistant to do next, each one short imperative sentence (max ~12 words), each one moving toward that goal. Do not suggest what is already done.

Write the goal and the steps in the language the user writes in.

${ASK}`

/** The fallback when there is no transcript to fork: the last request and answer alone. */
const stepsPrompt = (request: string, answer: string, previousGoal: string | null) => `A coding assistant just finished a task.

<request>
${clip(request, 4000)}
</request>

<final_answer>
${clip(answer, 8000)}
</final_answer>

1. In one short sentence (max ~15 words), state the overall goal the user is working toward. ${goalLine(previousGoal)}
2. Suggest 3 to ${MAX_STEPS} concrete next steps the user might want the assistant to do next, each one short imperative sentence (max ~12 words), each one moving toward that goal. Do not suggest things the answer says are already done.

Write the goal and the steps in the same language as the request.

${ASK}`

type Elements = Pick<ElementTable, 'Box' | 'Button' | 'Text'>

/** Below this many columns the buttons go on a row of their own, above the goal. */
const NARROW_COLUMNS = 80
/** About how many columns the checkbox button and star take before a step's text. */
const STEP_INDENT = 9
/** The row's background under the pointer: a light wash that reads on light and dark themes. */
const HOVER_BACKGROUND = 'rgba(127, 127, 127, 0.14)'

/** Splits text into lines of at most `width` characters at spaces; a longer word gets a line of its own. */
export const wrapWords = (text: string, width: number): string[] => {
  if (!Number.isFinite(width) || text.length <= width) return [text]
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(w => w.length > 0)) {
    if (line.length === 0) line = word
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line.length > 0) lines.push(line)
  return lines.length > 0 ? lines : [text]
}


/** The interactive summary: duration, selectable next steps, send and close. */
const drawSummary = async (
  $: EngineInterface,
  ui: Elements,
  summary: Summary,
  withHotkeys: boolean,
  hasPointer: boolean,
  lang: Lang,
  columns?: number,
) => {
  const t: Strings = STRINGS[lang]
  const { Box, Button, Text } = ui
  const picked = await read($, selected)
  const steps = summary.steps
  const recommended = summary.recommended ?? []

  const toggle = (i: number) =>
    update($, selected, cur => (cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i].sort((a, b) => a - b)))

  const send = async () => {
    if (steps === null || picked.length === 0) return
    const chosen = picked.map(i => steps[i]).filter((s): s is string => s !== undefined)
    const text =
      chosen.length === 1
        ? chosen[0]!
        : `${t.doTheseNext}\n${chosen.map((s, n) => `${n + 1}. ${s}`).join('\n')}`
    await update($, isHidden, () => true)
    await $.prompt.submit({ text, asUser: true })
  }

  const sessionGoal = summary.goal ?? (await read($, goal))
  const stepList = steps ?? []

  // Lay out for the width at hand: beside the goal when there is room for the
  // buttons, else the buttons on a row of their own above it, so the goal gets
  // the full width instead of a narrow column.
  const cols = columns ?? 120
  const isNarrow = cols < NARROW_COLUMNS
  // What is left for a step's text beside its checkbox and star, with a margin
  // for the surface's proportional font.
  const textColumns = columns === undefined ? Infinity : Math.max(20, Math.floor((cols - STEP_INDENT) * 0.92))

  const buttons = (
    <Box flexDirection="row" columnGap={1} flexShrink={0} justifyContent="flex-end">
      {stepList.length > 0 ? (
        <Button
          key="send"
          label={picked.length > 0 ? `${t.send} (${picked.length})` : t.send}
          variant="primary"
          onPress={send}
        />
      ) : null}
      <Button key="dismiss" label={t.close} onPress={() => update($, isHidden, () => true)} />
    </Box>
  )
  const goalText =
    sessionGoal !== null ? (
      <Text weight="semibold" wrap="wrap">
        <Text color="suggestion">◎ </Text>
        {sessionGoal}
      </Text>
    ) : null

  return (
    <Box flexDirection="column">
      {isNarrow ? (
        <Box flexDirection="column" rowGap="xs">
          {buttons}
          {goalText}
        </Box>
      ) : (
        <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" columnGap={3}>
          <Box flexDirection="column" flexShrink={1}>
            {goalText}
          </Box>
          {buttons}
        </Box>
      )}
      {steps === null ? (
        <Text dimColor>{t.loading}</Text>
      ) : stepList.length === 0 ? null : (
        // The checkbox buttons stand taller than a line of text: the rows always
        // keep room between them, so neighbouring buttons never overlap.
        <Box flexDirection="column" rowGap="sm" marginTop="sm">
          {stepList.map((step, i) => {
            const isPicked = picked.includes(i)
            const isRecommended = recommended.includes(i)
            // A button's label never wraps, so the step is split into lines by
            // hand, each a chrome-less button that toggles the step: the whole
            // text is a click target, and none of it is cut short.
            const lines = wrapWords(step, textColumns)
            return (
              <Box
                key={`row-${i}`}
                flexDirection="row"
                alignItems="flex-start"
                columnGap={1}
                hover={hasPointer ? { backgroundColor: HOVER_BACKGROUND } : undefined}
              >
                <Button
                  key={`step-${i}`}
                  label="✓"
                  variant={isPicked ? 'primary' : 'secondary'}
                  dimColor={!isPicked}
                  hotkey={withHotkeys ? String(i + 1) : undefined}
                  onPress={() => toggle(i)}
                />
                {isRecommended ? <Text color="warning">★</Text> : null}
                <Box flexDirection="column" flexShrink={1}>
                  {lines.map((line, n) => (
                    <Button
                      key={`text-${i}-${n}`}
                      label={line}
                      plain
                      dimColor={!isPicked}
                      onPress={() => toggle(i)}
                    />
                  ))}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

const STEPS_TIMEOUT_MS = 90_000

const NONE: Suggestion = { goal: null, steps: [], recommended: [] }

/**
 * Finds the session's goal and goal-aligned steps for one turn and stores them:
 * first from a fork of the whole conversation, else from the last request and
 * answer. Never leaves the summary stuck loading.
 */
const generateSteps = async ($: EngineInterface, turnId: string, request: string, answer: string) => {
  const previousGoal = await read($, goal).catch(() => null)
  let parsed: Suggestion = NONE

  try {
    const timedOut = $.clock.sleep(STEPS_TIMEOUT_MS).then(() => null)
    const forked = await Promise.race([$.model.fork({ prompt: forkPrompt(previousGoal) }), timedOut])
    if (forked !== null && forked.isAnswered) parsed = parseSuggestion(forked.text)
  } catch {
    // No fork: fall back below.
  }

  if (parsed.steps.length === 0) {
    try {
      const reply = await $.model.complete({
        model: 'opus',
        prompt: stepsPrompt(request, answer, previousGoal),
        effort: 'low',
        maxTokens: 1024,
        timeoutMs: STEPS_TIMEOUT_MS,
      })
      if (reply.isAnswered) parsed = parseSuggestion(reply.text)
    } catch {
      // A refused call shows the duration alone.
    }
  }

  const current = await read($, last)
  if (current === null || current.turnId !== turnId) return
  if (parsed.goal !== null) await update($, goal, () => parsed.goal)
  await update($, last, cur =>
    cur !== null && cur.turnId === turnId
      ? { ...cur, steps: parsed.steps, recommended: parsed.recommended, goal: parsed.goal ?? cur.goal }
      : cur,
  )
  // The recommended steps start checked, unless the person already picked some.
  await update($, selected, cur => (cur.length > 0 ? cur : parsed.recommended))
}

export const register: Register = (on, options) => {
  const setting = langOf(options)
  let locale: string | undefined
  /** The labels' language for a turn: the setting, or on "auto" what the request was written in. */
  const langFor = (summary: Summary | null): Lang =>
    setting !== 'auto' ? setting : (summary?.lang ?? detectLang(summary?.request ?? '', locale))

  on('prompt.submit', async ($, e, next) => {
    // Kept in state, not a module variable, so a reload mid-turn does not lose it.
    void update($, lastRequest, () => e.text).catch(() => {})
    // Never let hiding the summary hold up the person's prompt.
    void update($, isHidden, () => true).catch(() => {})
    return next(e)
  })

  // A reload drops a generation still under way: pick it up again.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    locale = (await $.env.get('LC_ALL').catch(() => undefined)) || (await $.env.get('LANG').catch(() => undefined))
    const summary = await read($, last).catch(() => null)
    if (summary !== null && summary.steps === null) {
      if (summary.answer !== undefined) {
        void generateSteps($, summary.turnId, summary.request ?? '', summary.answer)
      } else {
        await update($, last, cur => (cur !== null && cur.turnId === summary.turnId ? { ...cur, steps: [] } : cur))
      }
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    // Main conversation only, and only turns that actually finished.
    if (e.agentId !== undefined || e.isAborted || e.reason !== 'answer') {
      return result
    }

    const turnId = e.turnId
    const requestText = await read($, lastRequest).catch(() => '')
    const request = clip(requestText, 4000)
    const answer = clip(e.answer, 8000)
    const lang = setting !== 'auto' ? setting : detectLang(requestText, locale)
    await update($, last, () => ({ turnId, ms: e.durationMs, steps: null, isPlaced: false, request, answer, lang }))
    await update($, selected, () => [])
    await update($, isHidden, () => false)
    await update($, durations, cur => {
      const entries = Object.entries(cur).slice(-(MAX_ROWS - 1))
      return { ...Object.fromEntries(entries), [turnId]: e.durationMs }
    })

    // Preferred: a row in the transcript right under the answer, outside the prompt box.
    // Where no attached surface draws placed rows (the desktop app today), the band
    // above the prompt shows the summary instead.
    const placed = await $.ui.place({ id: turnId }).catch(() => ({ isPlaced: false }) as const)
    if (placed.isPlaced) {
      await update($, last, cur => (cur !== null && cur.turnId === turnId ? { ...cur, isPlaced: true } : cur))
    }

    void generateSteps($, turnId, request, answer)

    return result
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'next-steps') {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const rowId = e.props.id
    const summary = await read($, last)
    const isCurrent = summary !== null && summary.turnId === rowId && !(await read($, isHidden))

    if (isCurrent) {
      return drawSummary($, ui, summary, false, e.surface !== 'terminal', langFor(summary))
    }

    // An older row, or the latest once dealt with: the duration alone.
    const ms = summary !== null && summary.turnId === rowId ? summary.ms : (await read($, durations))[rowId]
    if (ms === undefined) return next(e)
    return (
      <ui.Box>
        <ui.Text dimColor>✓ {STRINGS[langFor(summary)].done} · {STRINGS[langFor(summary)].took} {formatDuration(ms, langFor(summary))}</ui.Text>
      </ui.Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const summary = await read($, last)
    if (
      e.props.hasSurvey ||
      e.props.isWorking ||
      summary === null ||
      summary.isPlaced ||
      (await read($, isHidden))
    ) {
      return next(e)
    }
    // With no steps and no goal (the suggestion call failed) there is nothing to show.
    if (summary.steps !== null && summary.steps.length === 0 && (summary.goal ?? (await read($, goal))) === null) {
      return next(e)
    }
    return drawSummary($, $.ui.resolve(e), summary, e.surface === 'terminal', e.surface !== 'terminal', langFor(summary), e.props.bodyColumns)
  })
}
