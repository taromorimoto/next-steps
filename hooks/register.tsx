import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import type { Summary } from '../types'

const last = atom({ plugin: 'next-steps', key: 'last' } as const, null)
const selected = atom({ plugin: 'next-steps', key: 'selected' } as const, [])
const isHidden = atom({ plugin: 'next-steps', key: 'isHidden' } as const, true)
const durations = atom({ plugin: 'next-steps', key: 'durations' } as const, {})
const goal = atom({ plugin: 'next-steps', key: 'goal' } as const, null)

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
    goal: 'Goal',
    done: 'Done',
    took: 'took',
    loading: 'Getting next steps…',
    heading: 'Next steps (★ = recommended, pick one or more):',
    send: 'Send selected',
    close: 'Close',
    doTheseNext: 'Do these next:',
  },
  fi: {
    goal: 'Tavoite',
    done: 'Valmis',
    took: 'kesto',
    loading: 'Haetaan seuraavia askeleita…',
    heading: 'Seuraavat askeleet (★ = suositeltu, valitse yksi tai useampi):',
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

/** The interactive summary: duration, selectable next steps, send and close. */
const drawSummary = async ($: EngineInterface, ui: Elements, summary: Summary, withHotkeys: boolean, lang: Lang) => {
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

  return (
    <Box flexDirection="column">
      {sessionGoal !== null ? (
        <Box marginBottom={1}>
          <Text color="cyan">◎ </Text>
          <Text bold>{t.goal}: </Text>
          <Text>{sessionGoal}</Text>
        </Box>
      ) : null}
      <Box>
        <Text color="green">✓ </Text>
        <Text bold>{t.done}</Text>
        <Text dimColor> · {t.took} {formatDuration(summary.ms, lang)}</Text>
      </Box>
      {steps === null ? (
        <Text dimColor>{t.loading}</Text>
      ) : steps.length === 0 ? null : (
        <Box flexDirection="column" rowGap="sm">
          <Text dimColor>{t.heading}</Text>
          {steps.map((step, i) => {
            const box = picked.includes(i) ? '☑' : '☐'
            const text = `${recommended.includes(i) ? '★ ' : ''}${step}`
            return (
              <Button
                key={`step-${i}`}
                label={`${box} ${text}`}
                hotkey={withHotkeys ? String(i + 1) : undefined}
                plain
                onPress={() => toggle(i)}
              >
                {/* A larger checkbox where the surface sizes text; the label alone elsewhere. */}
                <Text size="heading">{box}</Text>
                <Text> {text}</Text>
              </Button>
            )
          })}
        </Box>
      )}
      <Box marginTop={1} columnGap={1}>
        {steps !== null && steps.length > 0 ? (
          <Button
            key="send"
            label={picked.length > 0 ? `${t.send} (${picked.length})` : t.send}
            variant="primary"
            onPress={send}
          />
        ) : null}
        <Button key="dismiss" label={t.close} onPress={() => update($, isHidden, () => true)} />
      </Box>
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
  let lastRequest = ''
  let locale: string | undefined
  /** The labels' language for a turn: the setting, or on "auto" what the request was written in. */
  const langFor = (summary: Summary | null): Lang =>
    setting !== 'auto' ? setting : (summary?.lang ?? detectLang(summary?.request ?? '', locale))

  on('prompt.submit', async ($, e, next) => {
    lastRequest = e.text
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
    const request = clip(lastRequest, 4000)
    const answer = clip(e.answer, 8000)
    const lang = setting !== 'auto' ? setting : detectLang(lastRequest, locale)
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
      return drawSummary($, ui, summary, false, langFor(summary))
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
    return drawSummary($, $.ui.resolve(e), summary, true, langFor(summary))
  })
}
