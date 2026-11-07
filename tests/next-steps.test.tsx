import { expect, mock, test } from 'claude-code/testing'

const row = (id: string) =>
  ({
    plugin: 'next-steps',
    component: 'Placed',
    props: { id, plugin: 'next-steps' },
  }) as const

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const finishTurn = ($: any, over: Record<string, unknown> = {}) =>
  $.turn.complete({
    answer: 'Lisäsin kirjautumisen ja testit.',
    durationMs: 192_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    ...over,
  })

test('a finished turn shows its duration and selectable next steps; the picked ones are sent', { options: { language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', (_, e) => ({ value: { isPlaced: true, requestId: e.id } }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '```json\n["Lisää uloskirjautuminen", "Kirjoita README", "Aja testit CI:ssä"]\n```',
      usage: USAGE,
    },
  }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  await $.prompt.submit({ text: 'Lisää kirjautuminen' } as never)
  await finishTurn($)
  await clock.settle()

  const ui = await $.ui.mount({ ...row('t1'), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /took/ }))?.text).toBe(' · took 3m 12s')
  expect((await ui.find({ type: 'Button', key: 'step-0' }))?.props.label).toBe('☐ Lisää uloskirjautuminen')

  await ui.press({ key: 'step-0' })
  await ui.press({ key: 'step-2' })
  expect((await ui.find({ type: 'Button', key: 'step-2' }))?.props.label).toBe('☑ Aja testit CI:ssä')
  expect((await ui.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Send selected (2)')

  await ui.press({ key: 'send' })
  expect(submitted.at(-1)).toBe('Do these next:\n1. Lisää uloskirjautuminen\n2. Aja testit CI:ssä')
  expect(await ui.find({ type: 'Button', key: 'send' })).toBeUndefined()
  expect((await ui.find({ type: 'Text' }))?.text).toBe('✓ Done · took 3m 12s')
  await ui.unmount()
})

test('a subagent turn and an interrupted turn show nothing', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', (_, e) => ({ value: { isPlaced: true, requestId: e.id } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '["x"]', usage: USAGE } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await finishTurn($, { agentId: 'a1' })
  await finishTurn($, { turnId: 't2', isAborted: true, reason: 'aborted' })
  await clock.settle()

  const ui = await $.ui.mount({ ...row('t2'), surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a failed suggestion call still shows the duration', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', (_, e) => ({ value: { isPlaced: true, requestId: e.id } }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }))

  await finishTurn($, { durationMs: 45_000 })
  await clock.settle()

  const ui = await $.ui.mount({ ...row('t1'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /took/ }))?.text).toBe(' · took 45s')
  expect(await ui.find({ type: 'Button', key: 'send' })).toBeUndefined()
  await ui.unmount()
})

test('an older row keeps its duration once a newer turn finished', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', (_, e) => ({ value: { isPlaced: true, requestId: e.id } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '["a"]', usage: USAGE } }))

  await finishTurn($, { turnId: 'old', durationMs: 5_000 })
  await finishTurn($, { turnId: 'new', durationMs: 65_000 })
  await clock.settle()

  const old = await $.ui.mount({ ...row('old'), surface: 'desktop' })
  expect((await old.find({ type: 'Text' }))?.text).toBe('✓ Done · took 5s')
  expect(await old.find({ type: 'Button', key: 'send' })).toBeUndefined()
  await old.unmount()

  const fresh = await $.ui.mount({ ...row('new'), surface: 'desktop' })
  expect((await fresh.find({ type: 'Text', text: /took/ }))?.text).toBe(' · took 1m 5s')
  expect(await fresh.find({ type: 'Button', key: 'step-0' })).toBeDefined()
  await fresh.unmount()
})

test('where no surface draws placed rows, the band above the prompt shows the summary', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Aja testit"]', usage: USAGE } }))

  await finishTurn($, { durationMs: 12_000 })
  await clock.settle()

  const band = await $.ui.mount({
    plugin: 'next-steps',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect((await band.find({ type: 'Text', text: /took/ }))?.text).toBe(' · took 12s')
  expect((await band.find({ type: 'Button', key: 'step-0' }))?.props.label).toBe('☐ Aja testit')
  await band.unmount()
})

test('where the row is placed, the band stays empty', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', (_, e) => ({ value: { isPlaced: true, requestId: e.id } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '["a"]', usage: USAGE } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await finishTurn($)
  await clock.settle()

  const band = await $.ui.mount({
    plugin: 'next-steps',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
})

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} }

test('a model call that rejects leaves the duration, not a stuck loading line', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.complete', () => ({ deny: 'model blocked' }))

  await finishTurn($, { durationMs: 97_000 })
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect((await band.find({ type: 'Text', text: /took/ }))?.text).toBe(' · took 1m 37s')
  expect(await band.find({ type: 'Text', text: /Getting next steps/ })).toBeUndefined()
  await band.unmount()
})

test('a reload during generation picks the generation up again, recommended steps checked', async ($, on) => {
  const clock = mock.clock(on)
  // What the module before the reload stored: a summary still loading.
  const store = new Map<string, { value: unknown; version: number }>([
    [
      'last',
      {
        value: { turnId: 't9', ms: 97_000, steps: null, isPlaced: false, request: 'Korjaa palkki', answer: 'Korjasin palkin.' },
        version: 1,
      },
    ],
    ['isHidden', { value: false, version: 1 }],
  ])
  on('state.get', (_, e) => ({ value: store.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', (_, e) => {
    const version = (store.get(e.key)?.version ?? 0) + 1
    store.set(e.key, { value: e.value, version })
    return { value: { isSet: true, version } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '[{"step": "Testaa palkki", "recommended": true}, {"step": "Siisti koodi", "recommended": false}]',
      usage: USAGE,
    },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  // The recommended step comes back checked and starred after the reload too.
  expect((await band.find({ type: 'Button', key: 'step-0' }))?.props.label).toBe('☑ ★ Testaa palkki')
  expect((await band.find({ type: 'Button', key: 'step-1' }))?.props.label).toBe('☐ Siisti koodi')
  expect((await band.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Send selected (1)')
  await band.unmount()
})

test('the steps the model recommends start checked', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '[{"step": "Aja testit", "recommended": true}, {"step": "Päivitä README", "recommended": false}, {"step": "Julkaise", "recommended": true}]',
      usage: USAGE,
    },
  }))

  await finishTurn($)
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect((await band.find({ type: 'Button', key: 'step-0' }))?.props.label).toBe('☑ ★ Aja testit')
  expect((await band.find({ type: 'Button', key: 'step-1' }))?.props.label).toBe('☐ Päivitä README')
  expect((await band.find({ type: 'Button', key: 'step-2' }))?.props.label).toBe('☑ ★ Julkaise')
  expect((await band.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Send selected (2)')
  await band.unmount()
})

test('language "fi" draws the band in Finnish', { options: { language: 'fi' } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: '[{"step": "Aja testit", "recommended": true}, {"step": "Julkaise", "recommended": true}]', usage: USAGE },
  }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  await finishTurn($)
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect((await band.find({ type: 'Text', text: /kesto/ }))?.text).toBe(' · kesto 3 min 12 s')
  expect((await band.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Lähetä valitut (2)')
  expect((await band.find({ type: 'Button', key: 'dismiss' }))?.props.label).toBe('Sulje')
  await band.press({ key: 'send' })
  expect(submitted.at(-1)).toBe('Tee seuraavaksi nämä:\n1. Aja testit\n2. Julkaise')
  await band.unmount()
})

const autoTurn = async ($: any, on: any, request: string) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '[{"step": "x", "recommended": true}]', usage: USAGE } }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  await $.prompt.submit({ text: request } as never)
  await finishTurn($)
  await clock.settle()
  return $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
}

test('language "auto" (the default) follows a Finnish request', async ($, on) => {
  const band = await autoTurn($, on, 'Voitko lisätä kirjautumisen ja testit')
  expect((await band.find({ type: 'Button', key: 'dismiss' }))?.props.label).toBe('Sulje')
  expect((await band.find({ type: 'Text', text: /kesto/ }))?.text).toBe(' · kesto 3 min 12 s')
  await band.unmount()
})

test('language "auto" follows an English request', async ($, on) => {
  const band = await autoTurn($, on, 'Please add login and tests')
  expect((await band.find({ type: 'Button', key: 'dismiss' }))?.props.label).toBe('Close')
  await band.unmount()
})

test('language "en" stays English for a Finnish request', { options: { language: 'en' } }, async ($, on) => {
  const band = await autoTurn($, on, 'Voitko lisätä kirjautumisen')
  expect((await band.find({ type: 'Button', key: 'dismiss' }))?.props.label).toBe('Close')
  await band.unmount()
})
