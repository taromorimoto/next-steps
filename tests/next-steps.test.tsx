import { expect, mock, test } from 'claude-code/testing'

const row = (id: string) =>
  ({
    plugin: 'next-steps',
    component: 'Placed',
    props: { id, plugin: 'next-steps' },
  }) as const

/** A step as the band draws it: ☑ for a picked checkbox button, ☐ otherwise, then the star and the text lines. */
const stepRow = async (ui: any, i: number) => {
  const box = await ui.find({ type: 'Button', key: `step-${i}` })
  const find = (node: any): any =>
    node === null || typeof node !== 'object'
      ? undefined
      : node.props?.key === `row-${i}`
        ? node
        : (node.children ?? []).map(find).find((x: any) => x !== undefined)
  const parts: string[] = []
  const walk = (node: any) => {
    if (node === null || typeof node !== 'object') return
    // A transparent star only keeps the column; it is not shown.
    if (node.type === 'Text' && node.props?.color !== 'transparent') {
      const text = (node.children ?? []).filter((c: any) => typeof c === 'string').join('').trim()
      if (text.length > 0) parts.push(text)
    }
    // An icon reads as its alt text; an empty one only keeps the column.
    if (node.type === 'Svg' && String(node.props?.alt ?? '').trim().length > 0) parts.push(node.props.alt === '★' ? '★' : '✻')
    if (node.type === 'Button' && String(node.props?.key).startsWith(`text-${i}-`)) parts.push(node.props.label)
    for (const child of node.children ?? []) walk(child)
  }
  walk(find(await ui.drawn()))
  return `${box?.props.variant === 'primary' ? '☑' : '☐'} ${parts.join(' ')}`
}

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
  expect(await ui.find({ type: 'Text', text: /^[0-9]/ })).toBeUndefined()
  expect(await stepRow(ui, 0)).toBe('☐ Lisää uloskirjautuminen')

  await ui.press({ key: 'step-0' })
  await ui.press({ key: 'step-2' })
  expect(await stepRow(ui, 2)).toBe('☑ Aja testit CI:ssä')
  expect((await ui.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Send selected (2)')

  await ui.press({ key: 'send' })
  expect(submitted.at(-1)).toBe('Do these next:\n1. Lisää uloskirjautuminen\n3. Aja testit CI:ssä')
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

test('a failed suggestion call leaves no empty band', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', (_, e) => ({ value: { isPlaced: true, requestId: e.id } }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }))

  await finishTurn($, { durationMs: 45_000 })
  await clock.settle()

  const ui = await $.ui.mount({ ...row('t1'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^[0-9]/ })).toBeUndefined()
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
  expect(await fresh.find({ type: 'Text', text: /^[0-9]/ })).toBeUndefined()
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
  expect(await band.find({ type: 'Text', text: /^[0-9]/ })).toBeUndefined()
  expect(await stepRow(band, 0)).toBe('☐ Aja testit')
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

test('a model call that rejects leaves no stuck loading line', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.complete', () => ({ deny: 'model blocked' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await finishTurn($, { durationMs: 97_000 })
  await clock.settle()

  // Nothing found: the band is left to the engine, with no loading line stuck in it.
  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
})

test('a reload during generation picks the generation up again, recommended steps checked', { options: { language: 'en' } }, async ($, on) => {
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
  expect(await stepRow(band, 0)).toBe('☑ ★ Testaa palkki')
  expect(await stepRow(band, 1)).toBe('☐ Siisti koodi')
  expect((await band.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Send selected (1)')
  await band.unmount()
})

test('the steps the model recommends start checked', { options: { language: 'en' } }, async ($, on) => {
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
  expect(await stepRow(band, 0)).toBe('☑ ★ Aja testit')
  expect(await stepRow(band, 1)).toBe('☐ Päivitä README')
  expect(await stepRow(band, 2)).toBe('☑ ★ Julkaise')
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
  expect(await band.find({ type: 'Text', text: /^[0-9]/ })).toBeUndefined()
  expect((await band.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Lähetä valitut (2)')
  expect((await band.find({ type: 'Button', key: 'dismiss' }))?.props.label).toBe('Sulje')
  await band.press({ key: 'send' })
  expect(submitted.at(-1)).toBe('Tee seuraavaksi nämä:\n1. Aja testit\n2. Julkaise')
  await band.unmount()
})

const autoTurn = async ($: any, on: any, request: string, steps = '[{"step": "x", "recommended": true}]', submitted: string[] = []) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: steps, usage: USAGE } }))
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await $.prompt.submit({ text: request } as never)
  await finishTurn($)
  await clock.settle()
  return $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
}

test('language "auto" (the default) follows a Finnish request', async ($, on) => {
  const band = await autoTurn($, on, 'Voitko lisätä kirjautumisen ja testit')
  expect((await band.find({ type: 'Button', key: 'dismiss' }))?.props.label).toBe('Sulje')
  expect(await band.find({ type: 'Text', text: /^[0-9]/ })).toBeUndefined()
  await band.unmount()
})

test('language "auto" follows an English request', async ($, on) => {
  const band = await autoTurn($, on, 'Please add login and tests')
  expect((await band.find({ type: 'Button', key: 'dismiss' }))?.props.label).toBe('Close')
  await band.unmount()
})

test('language "auto" follows Finnish steps even after an English-looking request', async ($, on) => {
  const submitted: string[] = []
  const band = await autoTurn($, on, 'Do these next: 1. Fix the band', '[{"step": "Tarkista rivinvaihdot", "recommended": true}, {"step": "Julkaise versio", "recommended": true}]', submitted)
  expect((await band.find({ type: 'Button', key: 'dismiss' }))?.props.label).toBe('Sulje')
  await band.press({ key: 'send' })
  expect(submitted.at(-1)).toBe('Tee seuraavaksi nämä:\n1. Tarkista rivinvaihdot\n2. Julkaise versio')
  await band.unmount()
})

test('language "en" stays English for a Finnish request', { options: { language: 'en' } }, async ($, on) => {
  const band = await autoTurn($, on, 'Voitko lisätä kirjautumisen')
  expect((await band.find({ type: 'Button', key: 'dismiss' }))?.props.label).toBe('Close')
  await band.unmount()
})

test('the band leads with the session goal from a fork of the conversation', { options: { language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  const forkPrompts: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', (_, e) => {
    forkPrompts.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: '{"goal": "Ship a next-steps mod for Claude Code", "steps": [{"step": "Release 0.5.0", "recommended": true}]}',
        usage: USAGE,
      },
    }
  })
  on('model.complete', () => ({ deny: 'the fork answered; no fallback expected' }))

  await finishTurn($, { turnId: 'a' })
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect((await band.find({ type: 'Text', text: /Ship a next-steps mod/ }))?.text).toBe('◎ Ship a next-steps mod for Claude Code')
  expect(await stepRow(band, 0)).toBe('☑ ★ Release 0.5.0')
  await band.unmount()

  // The next turn asks with the goal found so far, so it stays stable.
  await finishTurn($, { turnId: 'b' })
  await clock.settle()
  expect(forkPrompts[0]).not.toContain('The goal noted so far')
  expect(forkPrompts[1]).toContain('The goal noted so far: "Ship a next-steps mod for Claude Code"')
})

test('with nothing to fork, the last request and answer give the goal and steps', { options: { language: 'fi' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork', usage: USAGE } }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: '{"goal": "Kauppalista-sovellus valmiiksi", "steps": [{"step": "Lisää jakaminen", "recommended": true}]}', usage: USAGE },
  }))

  await finishTurn($)
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect((await band.find({ type: 'Text', text: /Kauppalista/ }))?.text).toBe('◎ Kauppalista-sovellus valmiiksi')
  expect(await stepRow(band, 0)).toBe('☑ ★ Lisää jakaminen')
  await band.unmount()
})

test('a narrow band puts the buttons above the goal; a wide one beside it', { options: { language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', () => ({
    value: { isAnswered: true, text: '{"goal": "A long goal that would wrap in a narrow column", "steps": [{"step": "One", "recommended": true}]}', usage: USAGE },
  }))

  await finishTurn($)
  await clock.settle()

  const narrow = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: { ...BAND_PROPS, bodyColumns: 50 } })
  const narrowTree = JSON.stringify(await narrow.drawn())
  expect(narrowTree.indexOf('Send selected')).toBeLessThan(narrowTree.indexOf('A long goal'))
  await narrow.unmount()

  const wide = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: { ...BAND_PROPS, bodyColumns: 140 } })
  const wideTree = JSON.stringify(await wide.drawn())
  expect(wideTree.indexOf('A long goal')).toBeLessThan(wideTree.indexOf('Send selected'))
  await wide.unmount()
})

test('the step rows draw on every surface, with hotkeys on the terminal alone', { options: { language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', () => ({ value: { isAnswered: true, text: '{"goal": "G", "steps": [{"step": "One", "recommended": true}]}', usage: USAGE } }))

  await finishTurn($)
  await clock.settle()

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface, props: BAND_PROPS })
    expect(await stepRow(band, 0)).toBe('☑ ★ One')
    expect((await band.find({ type: 'Button', key: 'step-0' }))?.props.hotkey).toBe(surface === 'terminal' ? '1' : undefined)
    await band.unmount()
  }
})

test('the step text toggles the step too, wraps into lines, and lights the row on hover', { options: { language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: '{"goal": "G", "steps": [{"step": "Package the body, lid and rubber STL files into a zip for a friend", "recommended": false}]}',
      usage: USAGE,
    },
  }))

  await finishTurn($)
  await clock.settle()

  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: { ...BAND_PROPS, bodyColumns: 50 } })
  const lines = (await band.findAll({ type: 'Button' })).filter((b: { key?: string }) => b.key?.startsWith('text-0-'))
  // Wrapped into lines that together hold the whole step, none cut short.
  expect(lines.length).toBeGreaterThan(1)
  expect(await stepRow(band, 0)).toBe('☐ Package the body, lid and rubber STL files into a zip for a friend')
  // A dim step lights all its lines, and its number, while the pointer is
  // anywhere on the row, not only the line under it.
  // A Button's hover rides on the drawn element, beside its props, where `find` does not show it.
  const hovers = new Map<string, unknown>()
  const collect = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const n = node as { type?: string; props?: { key?: string }; hover?: unknown; children?: unknown[] }
    if (n.type === 'Button' && n.props?.key !== undefined) hovers.set(n.props.key, n.hover)
    for (const child of n.children ?? []) collect(child)
  }
  collect(await band.drawn())
  for (const line of lines) expect(hovers.get(String((line as { key?: string }).key))).toEqual({ dimColor: false })
  expect(hovers.get('step-0')).toEqual({ dimColor: false })
  // A press on the text, its second line here, toggles the step as the checkbox does.
  await band.press({ key: 'text-0-1' })
  expect((await stepRow(band, 0)).startsWith('☑ ')).toBe(true)
  // The row lights under the pointer.
  expect(JSON.stringify(await band.drawn())).toContain('rgba(127, 127, 127, 0.16)')
  await band.unmount()
})

test('when Claude ends on a question, the band shows it with the replies Claude offered', { options: { language: 'fi' } }, async ($, on) => {
  const clock = mock.clock(on)
  const forkPrompts: string[] = []
  const submitted: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', (_, e) => {
    forkPrompts.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: '{"goal": "Paranna next-steps-palkkia", "question": "Kumpi ulkoasu otetaan käyttöön?", "steps": [{"step": "Ota käyttöön paneeli", "recommended": false, "claude": true}, {"step": "Ota käyttöön palkki", "recommended": false}]}',
        usage: USAGE,
      },
    }
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  await finishTurn($)
  await clock.settle()
  expect(forkPrompts[0]).toContain('"question"')

  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect((await band.find({ type: 'Text', text: /Kumpi ulkoasu/ }))?.text).toBe('? Kumpi ulkoasu otetaan käyttöön?')
  // Claude's own pick wears the Claude icon and starts checked.
  expect(await stepRow(band, 0)).toBe('☑ ✻ Ota käyttöön paneeli')
  const svgs: any[] = []
  const walk = (node: any) => {
    if (node === null || typeof node !== 'object') return
    if (node.type === 'Svg') svgs.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(await band.drawn())
  const mark = svgs[0]
  expect(mark?.props.alt).toBe('Clauden suositus')
  expect(mark?.props.source).toContain('#D97757')
  expect(await stepRow(band, 1)).toBe('☐ Ota käyttöön palkki')
  // One reply goes out under its number, with no "do these next" line around it.
  await band.press({ key: 'send' })
  expect(submitted.at(-1)).toBe('1. Ota käyttöön paneeli')
  await band.unmount()
})

test('a turn that ends without a question shows no question line', { options: { language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', () => ({
    value: { isAnswered: true, text: '{"goal": "Ship it", "question": null, "steps": [{"step": "Release", "recommended": true}]}', usage: USAGE },
  }))
  await finishTurn($)
  await clock.settle()
  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect(await band.find({ type: 'Text', text: /^\? / })).toBeUndefined()
  await band.unmount()
})

test('the terminal marks Claude\'s own pick with ✻ and the band\'s with ★', { options: { language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: '{"goal": "Ship it", "steps": [{"step": "Fix it here", "recommended": true, "claude": true}, {"step": "Add a test", "recommended": true}, {"step": "Later", "recommended": false}]}',
      usage: USAGE,
    },
  }))
  await finishTurn($)
  await clock.settle()
  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'terminal', props: BAND_PROPS })
  expect(await stepRow(band, 0)).toBe('☑ ✻ Fix it here')
  expect(await stepRow(band, 1)).toBe('☑ ★ Add a test')
  expect(await stepRow(band, 2)).toBe('☐ Later')
  await band.unmount()
})

test('without a question, the last steps can be milestones toward the goal, marked ◎', { options: { language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  const forkPrompts: string[] = []
  const submitted: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', (_, e) => {
    forkPrompts.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: '{"goal": "Ship a login flow", "question": null, "steps": [{"step": "Add a logout test", "recommended": true}, {"step": "Take the login flow to done: tests, docs and a release", "milestone": true}]}',
        usage: USAGE,
      },
    }
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await finishTurn($)
  await clock.settle()
  expect(forkPrompts[0]).toContain('"milestone": true')

  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect(await stepRow(band, 0)).toBe('☑ ★ Add a logout test')
  expect(await stepRow(band, 1)).toBe('☐ ◎ Take the login flow to done: tests, docs and a release')
  // The checkboxes are numbered, the text field's next in line.
  expect((await band.find({ type: 'Button', key: 'step-0' }))?.props.label).toBe('1')
  expect((await band.find({ type: 'Button', key: 'step-1' }))?.props.label).toBe('2')
  expect((await band.find({ type: 'Button', key: 'note-pick' }))?.props.label).toBe('3')
  // The mark is drawn, not sent.
  await band.press({ key: 'step-0' })
  await band.press({ key: 'step-1' })
  await band.press({ key: 'send' })
  expect(submitted.at(-1)).toBe('2. Take the login flow to done: tests, docs and a release')
  await band.unmount()
})

test('a question with several replies Claude listed checks and marks only one', { options: { language: 'fi' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: '{"goal": "Julkaise SupaDojo", "question": "Julkaisenko korjaukset tuotantoon?", "steps": [{"step": "Julkaise korjaukset", "recommended": true, "claude": true}, {"step": "Ei vielä, odota", "recommended": true, "claude": true}, {"step": "Julkaise vain web"}]}',
      usage: USAGE,
    },
  }))
  await finishTurn($)
  await clock.settle()
  const band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect(await stepRow(band, 0)).toBe('☑ ✻ Julkaise korjaukset')
  expect(await stepRow(band, 1)).toBe('☐ Ei vielä, odota')
  expect(await stepRow(band, 2)).toBe('☐ Julkaise vain web')
  expect((await band.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Lähetä valitut (1)')
  await band.unmount()
})

test('the band\'s own field adds the person\'s words to the picked steps, or sends them alone', { options: { language: 'fi' } }, async ($, on) => {
  const clock = mock.clock(on)
  const submitted: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }))
  on('model.fork', () => ({
    value: { isAnswered: true, text: '{"goal": "Julkaise", "steps": [{"step": "Aja testit", "recommended": true}, {"step": "Julkaise"}]}', usage: USAGE },
  }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await finishTurn($)
  await clock.settle()

  let band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  const field = await band.find({ type: 'Input' })
  expect(field?.props.placeholder).toBe('Lisää omin sanoin…')
  // No value of its own: a redraw never writes over what is being typed.
  expect(field?.props.value).toBeUndefined()
  // Typing checks the field's own checkbox; Send then adds the words after the picked step.
  expect((await band.find({ type: 'Button', key: 'note-pick' }))?.props.variant).toBe('secondary')
  await band.input({ key: String(field!.key), text: 'Käytä', kind: 'change' })
  await band.input({ key: String(field!.key), text: 'Käytä stagingia ensin', kind: 'change' })
  expect((await band.find({ type: 'Button', key: 'note-pick' }))?.props.variant).toBe('primary')
  expect((await band.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Lähetä valitut (2)')
  // Unchecked, the words stay in the field but are not sent.
  await band.press({ key: 'note-pick' })
  expect((await band.find({ type: 'Button', key: 'send' }))?.props.label).toBe('Lähetä valitut (1)')
  await band.press({ key: 'note-pick' })
  await band.press({ key: 'send' })
  expect(submitted.at(-1)).toBe('Tee seuraavaksi nämä:\n1. Aja testit\n3. Käytä stagingia ensin')
  await band.unmount()

  // Next turn: nothing picked, Enter in the field sends the words alone, and the field starts empty.
  await finishTurn($, { turnId: 't2' })
  await clock.settle()
  band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  // A new turn draws a new, empty field.
  const next = await band.find({ type: 'Input' })
  expect(next?.key).not.toBe(field?.key)
  expect((await band.find({ type: 'Button', key: 'note-pick' }))?.props.variant).toBe('secondary')
  await band.press({ key: 'step-0' })
  await band.input({ key: String(next!.key), text: 'Tee jotain muuta' })
  expect(submitted.at(-1)).toBe('Tee jotain muuta')
  await band.unmount()

  // Send right after typing sends every letter, not only the first: only the
  // first one redraws the band, the rest must still reach Send.
  await finishTurn($, { turnId: 't3' })
  await clock.settle()
  band = await $.ui.mount({ plugin: 'next-steps', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  const third = await band.find({ type: 'Input' })
  await band.input({ key: String(third!.key), text: 'T', kind: 'change' })
  await band.input({ key: String(third!.key), text: 'Te', kind: 'change' })
  await band.input({ key: String(third!.key), text: 'Testi testi', kind: 'change' })
  await band.press({ key: 'send' })
  expect(submitted.at(-1)).toBe('Tee seuraavaksi nämä:\n1. Aja testit\n3. Testi testi')
  await band.unmount()
})
