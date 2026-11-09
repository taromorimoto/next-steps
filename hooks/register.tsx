import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import type { Summary } from '../types'

const last = atom({ plugin: 'next-steps', key: 'last' } as const, null)
const selected = atom({ plugin: 'next-steps', key: 'selected' } as const, [])
const isHidden = atom({ plugin: 'next-steps', key: 'isHidden' } as const, true)
const durations = atom({ plugin: 'next-steps', key: 'durations' } as const, {})
const goal = atom({ plugin: 'next-steps', key: 'goal' } as const, null)
const lastRequest = atom({ plugin: 'next-steps', key: 'lastRequest' } as const, '')
/**
 * The text field's words, kept here and not in state: a state write on every
 * keystroke redrew the band and wrote the text back into the field, losing
 * letters typed meanwhile and moving the cursor. The band redraws only when the
 * field turns empty or not (`isNotePicked`).
 */
let noteText = ''
const isNotePicked = atom({ plugin: 'next-steps', key: 'isNotePicked' } as const, false)

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
    byClaude: 'Claude recommends this',
    notePlaceholder: 'Add your own words…',
  },
  fi: {
    done: 'Valmis',
    took: 'kesto',
    loading: 'Haetaan seuraavia askeleita…',
    send: 'Lähetä valitut',
    close: 'Sulje',
    doTheseNext: 'Tee seuraavaksi nämä:',
    byClaude: 'Clauden suositus',
    notePlaceholder: 'Lisää omin sanoin…',
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

const ENGLISH_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'it', 'this', 'that', 'these',
  'do', 'does', 'can', 'could', 'would', 'please', 'add', 'fix', 'run', 'check', 'make', 'update', 'remove', 'test',
  'next', 'from', 'so', 'if', 'not', 'what', 'how', 'why', 'when', 'into', 'then', 'also', 'now', 'be',
])

/** A Finnish word by its look: a double vowel or a common case or derivation ending. */
const looksFinnish = (word: string): boolean =>
  /(aa|ii|uu|yy|ää|öö)/.test(word) || /(ssa|ssä|sta|stä|lla|llä|lta|ltä|lle|ksi|nen|ista|istä|ttaa|ttää)$/.test(word)

/**
 * Guesses the language of a text, or undefined when it cannot tell:
 * Finnish on ä/ö, else whichever of common Finnish and English words wins.
 */
export const guessLang = (text: string): Lang | undefined => {
  if (/[äö]/i.test(text)) return 'fi'
  const words = text.toLowerCase().match(/[a-zå]+/g) ?? []
  const fi = words.filter(w => FINNISH_WORDS.has(w) || (!ENGLISH_WORDS.has(w) && looksFinnish(w))).length
  const en = words.filter(w => ENGLISH_WORDS.has(w)).length
  if (fi > en) return 'fi'
  if (en > fi) return 'en'
  return undefined
}

/** The language of a prompt: guessed from its words, else the system locale (LC_ALL / LANG). */
export const detectLang = (text: string, locale?: string): Lang =>
  guessLang(text) ?? (locale !== undefined && locale.toLowerCase().startsWith('fi') ? 'fi' : 'en')

export type ParsedSteps = { steps: string[]; recommended: number[]; byClaude: number[]; milestones: number[] }

/**
 * Pulls the steps out of a model reply, tolerating code fences and prose around the JSON.
 * Takes `[{ "step": "...", "recommended": true }, ...]`, or plain strings (none recommended).
 */
export const parseSteps = (text: string): ParsedSteps => {
  const none: ParsedSteps = { steps: [], recommended: [], byClaude: [], milestones: [] }
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return none
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed)) return none
    const items = parsed
      .map(item => {
        if (typeof item === 'string') return { step: item.trim(), recommended: false, byClaude: false, milestone: false }
        if (item !== null && typeof item === 'object' && typeof (item as { step?: unknown }).step === 'string') {
          const o = item as { step: string; recommended?: unknown; claude?: unknown; milestone?: unknown }
          return {
            step: o.step.trim(),
            recommended: o.recommended === true,
            byClaude: o.claude === true,
            milestone: o.milestone === true,
          }
        }
        return null
      })
      .filter((x): x is { step: string; recommended: boolean; byClaude: boolean; milestone: boolean } => x !== null && x.step.length > 0)
      .slice(0, MAX_STEPS)
    return {
      steps: items.map(x => x.step),
      recommended: items.flatMap((x, i) => (x.recommended ? [i] : [])),
      byClaude: items.flatMap((x, i) => (x.byClaude ? [i] : [])),
      milestones: items.flatMap((x, i) => (x.milestone ? [i] : [])),
    }
  } catch {
    return none
  }
}

export type Suggestion = ParsedSteps & { goal: string | null; question: string | null }

/**
 * A question's replies mostly exclude each other: one may carry Claude's mark
 * and one the star, Claude's pick first, so only one reply starts checked.
 */
const oneAnswer = (steps: ParsedSteps): ParsedSteps => {
  const byClaude = steps.byClaude.slice(0, 1)
  const recommended = byClaude.length > 0 ? [] : steps.recommended.slice(0, 1)
  return { ...steps, byClaude, recommended }
}

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

/**
 * Pulls `{ "goal": "...", "question": "..." | null, "steps": [...] }` out of a
 * model reply; a bare steps array (no goal, no question) is taken too.
 */
export const parseSuggestion = (text: string): Suggestion => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start && (text.indexOf('[') < 0 || start < text.indexOf('['))) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1))
      if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { steps?: unknown }).steps)) {
        const o = parsed as { goal?: unknown; question?: unknown; steps: unknown[] }
        const question = textOrNull(o.question)
        const steps = parseSteps(JSON.stringify(o.steps))
        return { goal: textOrNull(o.goal), question, ...(question === null ? steps : oneAnswer(steps)) }
      }
    } catch {
      // Fall through to a bare array.
    }
  }
  return { goal: null, question: null, ...parseSteps(text) }
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max / 2)}\n…\n${text.slice(-max / 2)}`

const goalLine = (previousGoal: string | null) =>
  previousGoal === null
    ? ''
    : `The goal noted so far: "${previousGoal}". Keep it, word for word, unless the conversation has clearly moved on to something else.`

/** When the assistant ended on a question, the steps are its answers. */
const QUESTION = `If the assistant's last turn ended by asking the user something (a question, a choice between options, a request for a go-ahead or approval, whether in its text or in a question put to the user through a tool, such as a question box with answer buttons), set "question" to that question, short (max ~15 words). The steps are then the replies the user could send: first the options the assistant itself offered, in its own words, shortened; then at most two other sensible replies. Each reply is short and says what to do, so it reads well sent alone (e.g. "Yes, fix it here" or "Use option B: a pane"). Otherwise set "question" to null.`

/** Without a question, a step or two hands Claude a larger piece of the goal to drive on its own. */
const MILESTONES = `When the turn did not end on a question, make one or two of the steps higher-level, listed last and marked "milestone": true: a bigger outcome toward the goal that the assistant could drive on its own across several tasks, choosing the smaller steps itself and stopping only for decisions that are the user's (e.g. "Take the login flow to done: tests, docs and a release"). Keep the other steps concrete.`

const ASK = `Mark as recommended the steps you would advise doing next (at least one, usually one to three); leave optional or speculative ones unmarked. For a question, mark the reply the assistant recommended (or the one you would pick), and only one when the options exclude each other.

Set "claude": true on a step only when the assistant itself, in the conversation, recommended that very step: said it recommends or prefers it, or offered to do it next. Merely listing an option is not recommending it. For a question, set it on one reply at most: the one the assistant said it recommends (or its primary answer button), never on several replies. Leave it out for steps only you thought of.

Reply with only JSON: {"goal": "...", "question": "..." or null, "steps": [{"step": "...", "recommended": true, "claude": true, "milestone": true}, ...]} (leave out "claude" and "milestone" where they do not apply)`

/** Asked of a fork of the session's own transcript: it knows the whole conversation. */
const forkPrompt = (previousGoal: string | null) => `Step outside the conversation for a moment: do not continue the work, call no tools, and do not address the user.

1. In one short sentence (max ~15 words), state the overall goal of this whole session: what the user is ultimately trying to achieve, not just their last message. ${goalLine(previousGoal)}
2. Suggest 3 to ${MAX_STEPS} concrete next steps the user might want the assistant to do next, each one short imperative sentence (max ~12 words), each one moving toward that goal (or, when the turn ended on a question, 2 to ${MAX_STEPS} replies to it, as below). Do not suggest what is already done.

${QUESTION}

${MILESTONES}

Write the goal, the question and the steps in the language the user writes in.

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
2. Suggest 3 to ${MAX_STEPS} concrete next steps the user might want the assistant to do next, each one short imperative sentence (max ~12 words), each one moving toward that goal (or, when the turn ended on a question, 2 to ${MAX_STEPS} replies to it, as below). Do not suggest things the answer says are already done.

${QUESTION}

${MILESTONES}

Write the goal, the question and the steps in the same language as the request.

${ASK}`

type Elements = Pick<ElementTable, 'Box' | 'Button' | 'Text'> & {
  Svg?: ElementTable<'desktop'>['Svg']
  Input?: ElementTable<'desktop'>['Input']
}

/** Below this many columns the buttons go on a row of their own, above the goal. */
const NARROW_COLUMNS = 80
/** About how many columns the checkbox button and star take before a step's text. */
const STEP_INDENT = 9
/** The row's background under the pointer: a light wash that reads on light and dark themes. */
const HOVER_BACKGROUND = 'rgba(127, 127, 127, 0.16)'

const svgDoc = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`

/** Claude's mark: a spark of rounded rays of uneven length, in Claude's orange. */
const CLAUDE_ICON = svgDoc(
  `<g stroke="#D97757" stroke-width="2.6" stroke-linecap="round">${[10, 7.4, 9.2, 7, 10, 7.8, 9.4, 7.2, 10, 7.6, 9, 8]
    .map((length, k) => {
      const a = (k * Math.PI) / 6 - Math.PI / 2
      const at = (r: number) => `${(12 + r * Math.cos(a)).toFixed(2)}`
      const atY = (r: number) => `${(12 + r * Math.sin(a)).toFixed(2)}`
      return `<line x1="${at(0.6)}" y1="${atY(0.6)}" x2="${at(length)}" y2="${atY(length)}"/>`
    })
    .join('')}</g>`,
)
/** The band's own recommendation: a star. */
const STAR_ICON = svgDoc(
  '<polygon fill="#E8A33D" points="12,2.5 14.8,8.7 21.5,9.3 16.4,13.7 18,20.3 12,16.8 6,20.3 7.6,13.7 2.5,9.3 9.2,8.7"/>',
)
/** Keeps the marker's column on a row with none. */
const NO_ICON = svgDoc('<rect width="24" height="24" fill="none"/>')
const ICON_SIZE = 14

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
  const { Box, Button, Text, Svg, Input } = ui
  const picked = await read($, selected)
  const steps = summary.steps
  const recommended = summary.recommended ?? []
  const byClaude = summary.byClaude ?? []
  const milestones = summary.milestones ?? []

  const toggle = (i: number) =>
    update($, selected, cur => (cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i].sort((a, b) => a - b)))

  const typed = noteText
  const isTypedPicked = (await read($, isNotePicked)) && typed.trim().length > 0
  const pickedCount = picked.length + (isTypedPicked ? 1 : 0)

  /** `written`: the field's text as Enter sent it, newer than this drawing's. */
  const send = async (written?: string) => {
    const chosen = picked.map(i => steps?.[i]).filter((s): s is string => s !== undefined)
    const own = written !== undefined ? written.trim() : isTypedPicked ? typed.trim() : ''
    if (chosen.length === 0 && own.length === 0) return
    const list =
      chosen.length === 0
        ? ''
        : chosen.length === 1
          ? chosen[0]!
          : `${t.doTheseNext}\n${chosen.map((s, n) => `${n + 1}. ${s}`).join('\n')}`
    // The person's own words go last, after the picked steps.
    const text = [list, own].filter(part => part.length > 0).join('\n\n')
    await update($, isHidden, () => true)
    noteText = ''
    await update($, isNotePicked, () => false)
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
      {stepList.length > 0 || typed.trim().length > 0 ? (
        <Button
          key="send"
          label={pickedCount > 0 ? `${t.send} (${pickedCount})` : t.send}
          variant="primary"
          onPress={() => send()}
        />
      ) : null}
      <Button key="dismiss" label={t.close} onPress={() => update($, isHidden, () => true)} />
    </Box>
  )
  const questionText =
    summary.question != null && summary.question.length > 0 ? (
      <Text wrap="wrap">
        <Text color="warning" weight="semibold">? </Text>
        {summary.question}
      </Text>
    ) : null
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
      {/* Claude ended on a question: the steps below are the replies it offered. */}
      {steps !== null && stepList.length > 0 && questionText !== null ? <Box marginTop="sm">{questionText}</Box> : null}
      {steps === null ? (
        <Text dimColor>{t.loading}</Text>
      ) : stepList.length === 0 ? null : (
        // The checkbox buttons stand taller than a line of text: the rows always
        // keep room between them, so neighbouring buttons never overlap.
        <Box flexDirection="column" rowGap={hasPointer ? 'xs' : 'sm'} marginTop="sm">
          {stepList.map((step, i) => {
            const isPicked = picked.includes(i)
            const isRecommended = recommended.includes(i)
            const isClaudes = byClaude.includes(i)
            // A button's label never wraps, so the step is split into lines by
            // hand, each a chrome-less button that toggles the step: the whole
            // text is a click target, and none of it is cut short.
            // A milestone, a larger piece of the goal for Claude to drive, leads with the goal's mark.
            const lines = wrapWords(milestones.includes(i) ? `◎ ${step}` : step, textColumns)
            return (
              <Box
                key={`row-${i}`}
                flexDirection="row"
                alignItems="center"
                columnGap={1}
                // Padded so the wash under the pointer covers the whole row,
                // the taller checkbox included, not a strip behind the text.
                paddingY={hasPointer ? 'xs' : 0}
                paddingX={hasPointer ? 'xs' : 0}
                hover={hasPointer ? { backgroundColor: HOVER_BACKGROUND } : undefined}
              >
                <Button
                  key={`step-${i}`}
                  // Numbered, a filled button a picked one; the terminal shows its number as the hotkey.
                  label={withHotkeys ? '✓' : String(i + 1)}
                  variant={isPicked ? 'primary' : 'secondary'}
                  dimColor={!isPicked}
                  hotkey={withHotkeys ? String(i + 1) : undefined}
                  onPress={() => toggle(i)}
                />
                {/* Claude's own pick wears its mark, the band's a star. The marker's
                    place is kept on every row, so all the steps' text starts in one column. */}
                {hasPointer && Svg !== undefined ? (
                  <Svg
                    key={`mark-${i}`}
                    source={isClaudes ? CLAUDE_ICON : isRecommended ? STAR_ICON : NO_ICON}
                    alt={isClaudes ? t.byClaude : isRecommended ? '★' : ' '}
                    width={ICON_SIZE}
                    height={ICON_SIZE}
                  />
                ) : isClaudes ? (
                  <Text color="claude">✻</Text>
                ) : (
                  <Text color="warning">{isRecommended ? '★' : ' '}</Text>
                )}
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
      {/* The person's own words: a row like a step's, its checkbox checked by
          typing; they go out after the picked steps with Send, or on Enter. */}
      {Input !== undefined ? (
        <Box
          key="note-row"
          flexDirection="row"
          alignItems="center"
          columnGap={1}
          marginTop={stepList.length > 0 ? 'xs' : 'sm'}
          paddingX={hasPointer ? 'xs' : 0}
        >
          <Button
            key="note-pick"
            label={withHotkeys ? '✓' : String(stepList.length + 1)}
            variant={isTypedPicked ? 'primary' : 'secondary'}
            dimColor={!isTypedPicked}
            onPress={() => update($, isNotePicked, cur => !cur)}
          />
          {hasPointer && Svg !== undefined ? (
            <Svg key="note-mark" source={NO_ICON} alt=" " width={ICON_SIZE} height={ICON_SIZE} />
          ) : (
            <Text> </Text>
          )}
          <Box flexGrow={1} flexShrink={1}>
            <Input
              // A field of its own per turn, so each starts empty; no `value`, so a
              // redraw never writes over what is being typed.
              key={`note-${summary.turnId}`}
              placeholder={t.notePlaceholder}
              // No button of its own: Send at the top sends; Enter still does.
              submitLabel=""
              onInput={value => {
                const wasEmpty = noteText.trim().length === 0
                noteText = value
                const isEmpty = value.trim().length === 0
                // Typing into an empty field checks it; emptying it unchecks it.
                if (wasEmpty !== isEmpty) void update($, isNotePicked, () => !isEmpty)
              }}
              onSubmit={value => void send(value)}
            />
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}

const STEPS_TIMEOUT_MS = 90_000

const NONE: Suggestion = { goal: null, question: null, steps: [], recommended: [], byClaude: [], milestones: [] }

/**
 * Finds the session's goal and goal-aligned steps for one turn and stores them:
 * first from a fork of the whole conversation, else from the last request and
 * answer. Never leaves the summary stuck loading.
 */
const generateSteps = async (
  $: EngineInterface,
  turnId: string,
  request: string,
  answer: string,
  isAutoLang: boolean,
) => {
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
      ? {
          ...cur,
          steps: parsed.steps,
          recommended: parsed.recommended,
          byClaude: parsed.byClaude,
          milestones: parsed.milestones,
          goal: parsed.goal ?? cur.goal,
          question: parsed.question,
          // On "auto" the steps decide when they can: they are written in the conversation's
          // language, while the request may be short, pasted, or the band's own English message.
          lang:
            isAutoLang && parsed.steps.length > 0
              ? (guessLang([parsed.goal ?? '', parsed.question ?? '', ...parsed.steps].join(' ')) ?? cur.lang)
              : cur.lang,
        }
      : cur,
  )
  // The recommended steps, and Claude's own, start checked, unless the person already picked some.
  const preselected = [...new Set([...parsed.recommended, ...parsed.byClaude])].sort((a, b) => a - b)
  await update($, selected, cur => (cur.length > 0 ? cur : preselected))
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
        void generateSteps($, summary.turnId, summary.request ?? '', summary.answer, setting === 'auto')
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
    noteText = ''
    await update($, isNotePicked, () => false)
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

    void generateSteps($, turnId, request, answer, setting === 'auto')

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
