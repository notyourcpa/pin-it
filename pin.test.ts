import { expect, mock, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { promptBefore, promptPreview, replies } from './hooks/register'

const msg = (role: 'user' | 'assistant', text: string, extra: Partial<SessionMessage> = {}): SessionMessage =>
  ({ role, text, toolUses: [], ...extra })

const transcript: SessionMessage[] = [
  msg('user', 'how do I set up X?'),
  msg('assistant', 'Checking.'),
  msg('user', '', { toolResults: [] as never }),
  msg('assistant', '1. Install\n2. Configure'),
  msg('user', 'what about Y?'),
  msg('assistant', 'Y is fine.'),
]

test('groups assistant text into one reply per prompt', () => {
  expect(replies(transcript)).toEqual(['Checking.\n\n1. Install\n2. Configure', 'Y is fine.'])
})

test("finds the prompt before a reply, past tool results, by the reply's text", () => {
  expect(promptBefore(transcript, '1. Install\n2. Configure')).toBe('how do I set up X?')
  expect(promptBefore(transcript, 'Checking.\n\n1. Install\n2. Configure')).toBe('how do I set up X?')
  expect(promptBefore(transcript, 'Y is fine.')).toBe('what about Y?')
  expect(promptBefore(transcript, 'never said')).toBeUndefined()
  expect(promptBefore([msg('user', '\n  first line\nsecond'), msg('assistant', 'ok')], 'ok')).toBe('first line')
})

test('the desktop cuts a long prompt preview to one line; the terminal leaves it to the pane', () => {
  const long = 'how do I keep the steps for this migration in view while we work'
  expect(promptPreview(long, 'terminal')).toBe(long)
  expect(promptPreview(long, 'desktop')).toBe('how do I keep the steps for this migration i…')
  expect(promptPreview('short one', 'desktop')).toBe('short one')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pin button draws and pins on ${surface}`, async ($, on) => {
    mock.store(on)
    on('session.root', async () => ({ value: '/project' }) as never)
    on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as never)
    let tick = 1000
    on('clock.now', async () => ({ value: tick++ }) as never)
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    on('session.messages', async () => ({
      value: [msg('user', 'how do I install it?'), msg('assistant', 'Steps:\n1. `npm i`')],
    }) as never)

    const drawn = await $.ui.mount({
      plugin: 'pin-it',
      surface,
      component: 'AssistantMessage',
      requestId: 'msg-1',
      props: { text: 'Steps:\n1. `npm i`', isFirstOfReply: true },
    })
    expect(await drawn.find({ key: 'pin-msg-1' })).toBeDefined()
    await $.ui.press({ plugin: 'pin-it', key: 'pin-msg-1' } as never)
    // Pinned replies keep their pin drawn, not the engine's fallback row.
    expect(await drawn.find({ key: 'pin-msg-1' })).toBeDefined()
    // The pane's header previews the prompt the reply answered.
    const pane = await $.ui.mount({ plugin: 'pin-it', surface, component: 'Pane', requestId: 'pinned', props: {} as never })
    expect(await pane.find({ type: 'Text', text: /how do I install it\?/ })).toBeDefined()
    const r = await $.command.run({ command: 'unpin', args: 'all' } as never)
    expect(r.text).toBe('Unpinned 1.')
  })
}

test('/pin pins the last reply once; /unpin all clears', async ($, on) => {
  mock.store(on)
  on('session.root', async () => ({ value: '/project' }) as never)
  on('session.messages', async () => ({ value: transcript }) as never)
  let tick = 1000
  on('clock.now', async () => ({ value: tick++ }) as never)
  on('ui.open',async () => ({ value: { isPlaced: true } }) as never)

  const first = await $.command.run({ command: 'pin', args: '' } as never)
  expect(first.text).toBe('Pinned: Y is fine.')

  const again = await $.command.run({ command: 'pin', args: '' } as never)
  expect(again.text).toBe('Pinned: Y is fine.')

  const all = await $.command.run({ command: 'unpin', args: 'all' } as never)
  expect(all.text).toBe('Unpinned 1.')
})

// The transcript's first reply, drawn in the chat as two blocks around a tool call.
const twoBlocks = transcript.slice(0, 4)
const twoBlocksText = 'Checking.\n\n1. Install\n2. Configure'

type Mount = Parameters<Parameters<typeof test>[1]>[0]

// Draws the reply's two blocks and the pane, over a session whose transcript is `twoBlocks`.
async function drawTwoBlocks($: Mount, on: Parameters<Parameters<typeof test>[1]>[1], surface: 'terminal' | 'desktop') {
  mock.store(on)
  on('session.root', async () => ({ value: '/project' }) as never)
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as never)
  let tick = 1000
  on('clock.now', async () => ({ value: tick++ }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.messages', async () => ({ value: twoBlocks }) as never)
  const block = (requestId: string, text: string) =>
    $.ui.mount({ plugin: 'pin-it', surface, component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true } })
  const first = await block('msg-1', 'Checking.')
  const second = await block('msg-2', '1. Install\n2. Configure')
  const pane = await $.ui.mount({ plugin: 'pin-it', surface, component: 'Pane', requestId: 'pinned', props: {} as never })
  // Pinned draws the pin full strength; unpinned, dim.
  const shownPinned = async (drawn: typeof first, id: string) => (await drawn.find({ key: `pin-${id}` }))?.props.dimColor === false
  const pinned = async () => (await pane.findAll({ type: 'Markdown' })).map(m => m.text)
  return { first, second, shownPinned, pinned }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/pin shows the pin on each block of the reply on ${surface}`, async ($, on) => {
    const { first, second, shownPinned } = await drawTwoBlocks($, on, surface)
    expect(await shownPinned(first, 'msg-1')).toBe(false)
    await $.command.run({ command: 'pin', args: '' } as never)
    expect(await shownPinned(first, 'msg-1')).toBe(true)
    expect(await shownPinned(second, 'msg-2')).toBe(true)
  })
}

test("a block's pin, then /pin, leaves one pin: the whole reply", async ($, on) => {
  const { second, shownPinned, pinned } = await drawTwoBlocks($, on, 'terminal')
  await second.press({ key: 'pin-msg-2' })
  expect(await pinned()).toEqual(['1. Install\n2. Configure'])
  await $.command.run({ command: 'pin', args: '' } as never)
  expect(await pinned()).toEqual([twoBlocksText])
  expect(await shownPinned(second, 'msg-2')).toBe(true)
})

test('after /pin, clicking any block of the reply unpins it, not adds a pin', async ($, on) => {
  const { first, second, shownPinned, pinned } = await drawTwoBlocks($, on, 'terminal')
  await $.command.run({ command: 'pin', args: '' } as never)
  await second.press({ key: 'pin-msg-2' })
  expect(await pinned()).toEqual([])
  expect(await shownPinned(first, 'msg-1')).toBe(false)
})

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

type Body = Parameters<typeof test>[1]

// Starts a session in /project with `saved` in the store, then draws the pane. The store
// is the test's own map, so a test can read what the mod left in it.
async function startWith($: Parameters<Body>[0], on: Parameters<Body>[1], saved: Record<string, unknown>) {
  const store = new Map(Object.entries(saved))
  on('store.get', async (_, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', async (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined } as never
  })
  on('store.delete', async (_, e) => {
    store.delete((e as { key: string }).key)
    return { value: undefined } as never
  })
  on('store.keys', async () => ({ value: [...store.keys()] }) as never)
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.root', async () => ({ value: '/project' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.start', async () => ({ cwd: '/project' }) as never)
  await $.session.start({ source: 'startup', cwd: '/project' } as never)
  const pane = await $.ui.mount({ plugin: 'pin-it', surface: 'terminal', component: 'Pane', requestId: 'pinned', props: {} as never })
  return { pane, store, clock }
}

test("a project's saved pins come back when a session starts there", async ($, on) => {
  const { pane, store } = await startWith($, on, {
    'pins:/project': [{ id: 'msg-9', text: 'Saved reply', pinnedAt: NOW - DAY }],
    'pins:/other': [{ id: 'msg-8', text: 'Other project', pinnedAt: NOW - DAY }],
  })
  expect(await pane.find({ key: 'unpin-msg-9' })).toBeDefined()
  expect(await pane.find({ key: 'unpin-msg-8' })).toBeUndefined()
})

test('pins are cleared 7 days after they were pinned, by default', async ($, on) => {
  const { pane, store } = await startWith($, on, {
    'pins:/project': [
      { id: 'msg-new', text: 'Six days old', pinnedAt: NOW - 6 * DAY },
      { id: 'msg-old', text: 'Eight days old', pinnedAt: NOW - 8 * DAY },
    ],
    'pins:/other': [{ id: 'msg-gone', text: 'Old, elsewhere', pinnedAt: NOW - 8 * DAY }],
  })
  expect(await pane.find({ key: 'unpin-msg-new' })).toBeDefined()
  expect(await pane.find({ key: 'unpin-msg-old' })).toBeUndefined()
  expect(store.has('pins:/other')).toBe(false)
})

test('"forever" keeps old pins', { options: { keep: 'forever' } }, async ($, on) => {
  const { pane, store } = await startWith($, on, {
    'pins:/project': [{ id: 'msg-old', text: 'A year old', pinnedAt: NOW - 365 * DAY }],
  })
  expect(await pane.find({ key: 'unpin-msg-old' })).toBeDefined()
})

const elsewhere = { id: 'msg-desk', text: 'Pinned in another session', pinnedAt: NOW }

test('/pins picks up a pin another session saved', async ($, on) => {
  const { pane, store } = await startWith($, on, { 'pins:/project': [] })
  store.set('pins:/project', [elsewhere])
  expect(await pane.find({ key: 'unpin-msg-desk' })).toBeUndefined()

  await $.command.run({ command: 'pins', args: '' } as never)
  expect(await pane.find({ key: 'unpin-msg-desk' })).toBeDefined()
})

test('"every 5 seconds" picks up pins on a timer', { options: { sync: 'every 5 seconds' } }, async ($, on) => {
  const { pane, store, clock } = await startWith($, on, { 'pins:/project': [] })
  store.set('pins:/project', [elsewhere])
  await clock.advance(5000)
  expect(await pane.find({ key: 'unpin-msg-desk' })).toBeDefined()
})

test('"on activity" sets no timer', async ($, on) => {
  const { pane, store, clock } = await startWith($, on, { 'pins:/project': [] })
  store.set('pins:/project', [elsewhere])
  await clock.advance(60000)
  expect(await pane.find({ key: 'unpin-msg-desk' })).toBeUndefined()
})
