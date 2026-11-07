import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import type { Summary } from '../types'

const last = atom({ plugin: 'next-steps', key: 'last' } as const, null)
const selected = atom({ plugin: 'next-steps', key: 'selected' } as const, [])
const isHidden = atom({ plugin: 'next-steps', key: 'isHidden' } as const, true)
const durations = atom({ plugin: 'next-steps', key: 'durations' } as const, {})

const MAX_ROWS = 200
const MAX_STEPS = 5

/** "45s", "3m 12s", "1h 4m" */
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
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

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max / 2)}\n…\n${text.slice(-max / 2)}`

const stepsPrompt = (request: string, answer: string) => `A coding assistant just finished a task.

<request>
${clip(request, 4000)}
</request>

<final_answer>
${clip(answer, 8000)}
</final_answer>

Suggest 3 to ${MAX_STEPS} concrete next steps the user might want the assistant to do next. Each step is one short imperative sentence (max ~12 words), specific to this task, in the same language as the request. Do not suggest things the answer says are already done.

Mark as recommended the steps you would advise doing next (at least one, usually one to three); leave optional or speculative ones unmarked.

Reply with only a JSON array of objects: [{"step": "...", "recommended": true}, ...]`

type Elements = Pick<ElementTable, 'Box' | 'Button' | 'Text'>

/** The interactive summary: duration, selectable next steps, send and close. */
const drawSummary = async ($: EngineInterface, ui: Elements, summary: Summary, withHotkeys: boolean) => {
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
        : `Do these next:\n${chosen.map((s, n) => `${n + 1}. ${s}`).join('\n')}`
    await update($, isHidden, () => true)
    await $.prompt.submit({ text, asUser: true })
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">✓ </Text>
        <Text bold>Done</Text>
        <Text dimColor> · took {formatDuration(summary.ms)}</Text>
      </Box>
      {steps === null ? (
        <Text dimColor>Getting next steps…</Text>
      ) : steps.length === 0 ? null : (
        <Box flexDirection="column">
          <Text dimColor>Next steps (★ = recommended, pick one or more):</Text>
          {steps.map((step, i) => (
            <Button
              key={`step-${i}`}
              label={`${picked.includes(i) ? '☑' : '☐'} ${recommended.includes(i) ? '★ ' : ''}${step}`}
              hotkey={withHotkeys ? String(i + 1) : undefined}
              plain
              onPress={() => toggle(i)}
            />
          ))}
        </Box>
      )}
      <Box marginTop={1} columnGap={1}>
        {steps !== null && steps.length > 0 ? (
          <Button
            key="send"
            label={picked.length > 0 ? `Send selected (${picked.length})` : 'Send selected'}
            variant="primary"
            onPress={send}
          />
        ) : null}
        <Button key="dismiss" label="Close" onPress={() => update($, isHidden, () => true)} />
      </Box>
    </Box>
  )
}

const STEPS_TIMEOUT_MS = 90_000

/** Generates the steps for one turn and stores them; never leaves the summary stuck loading. */
const generateSteps = async ($: EngineInterface, turnId: string, request: string, answer: string) => {
  let parsed: ParsedSteps = { steps: [], recommended: [] }
  try {
    const reply = await $.model.complete({
      model: 'opus',
      prompt: stepsPrompt(request, answer),
      effort: 'low',
      maxTokens: 1024,
      timeoutMs: STEPS_TIMEOUT_MS,
    })
    if (reply.isAnswered) parsed = parseSteps(reply.text)
  } catch {
    // A refused call shows the duration alone.
  }
  const current = await read($, last)
  if (current === null || current.turnId !== turnId) return
  await update($, last, cur => (cur !== null && cur.turnId === turnId ? { ...cur, steps: parsed.steps, recommended: parsed.recommended } : cur))
  // The recommended steps start checked, unless the person already picked some.
  await update($, selected, cur => (cur.length > 0 ? cur : parsed.recommended))
}

export const register: Register = on => {
  let lastRequest = ''

  on('prompt.submit', async ($, e, next) => {
    lastRequest = e.text
    // Never let hiding the summary hold up the person's prompt.
    void update($, isHidden, () => true).catch(() => {})
    return next(e)
  })

  // A reload drops a generation still under way: pick it up again.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
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
    await update($, last, () => ({ turnId, ms: e.durationMs, steps: null, isPlaced: false, request, answer }))
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
      return drawSummary($, ui, summary, false)
    }

    // An older row, or the latest once dealt with: the duration alone.
    const ms = summary !== null && summary.turnId === rowId ? summary.ms : (await read($, durations))[rowId]
    if (ms === undefined) return next(e)
    return (
      <ui.Box>
        <ui.Text dimColor>✓ Done · took {formatDuration(ms)}</ui.Text>
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
    return drawSummary($, $.ui.resolve(e), summary, true)
  })
}
