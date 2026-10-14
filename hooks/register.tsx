import { atom, read, update } from 'claude-code'
import type { Hook, Register, SessionMessage } from 'claude-code'

import type { Pin } from '../types'

const PANE = 'pinned'
// A plain text glyph shaped like a map pin: takes the text color, never emoji red.
const PIN_GLYPH = '⚲'
// Anthropic orange; Button has no color prop, so the glyph is a colored Text child.
const PIN_COLOR = '#D97757'

// The chat's pin and the pane's unpin draw the same glyph. Terminal: bold and padded,
// since a glyph can't be drawn bigger there.
function pinLabel(surface: string): { bold: boolean; text: string } {
  return surface === 'terminal' ? { bold: true, text: ` ${PIN_GLYPH} ` } : { bold: false, text: PIN_GLYPH }
}

const pins = atom({ plugin: 'pin-it', key: 'pins' } as const, [])

type Dollar = Parameters<Hook<'session.start'>>[0]

// Session state draws the UI but resets on restart; $.store keeps pins between sessions,
// one list per project root. Changes apply to the stored list, so two open sessions in a
// project don't drop each other's pins.
async function storeKey($: Dollar) {
  return `pins:${await $.session.root()}`
}

const DAY_MS = 24 * 60 * 60 * 1000
// From the "keep" setting: how long a pin is kept after it was pinned. Set by register.
let keepMs = 7 * DAY_MS

function unexpired(list: Pin[], now: number): Pin[] {
  return list.filter(p => now - p.pinnedAt < keepMs)
}

async function change($: Dollar, fn: (list: Pin[]) => Pin[]) {
  const key = await storeKey($)
  const stored = await $.store.get(key)
  const next = unexpired(fn(Array.isArray(stored) ? (stored as Pin[]) : await read($, pins)), await $.clock.now())
  await $.store.set(key, next)
  await update($, pins, () => next)
}

// Pulls in pins another session saved for this project. There's no notice when one does,
// so this runs at set moments (and on a timer, with the "sync" setting on "every 5 seconds").
async function refresh($: Dollar) {
  const stored = await $.store.get(await storeKey($))
  if (!Array.isArray(stored)) return
  const fresh = unexpired(stored as Pin[], await $.clock.now())
  if (JSON.stringify(fresh) !== JSON.stringify(await read($, pins))) await update($, pins, () => fresh)
}

// Clears expired pins from every project's saved list, dropping lists left empty.
async function sweep($: Dollar) {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    const stored = await $.store.get(key)
    if (!key.startsWith('pins:') || !Array.isArray(stored)) continue
    const kept = unexpired(stored as Pin[], now)
    if (kept.length === 0) await $.store.delete(key)
    else if (kept.length !== stored.length) await $.store.set(key, kept)
  }
}

function isPrompt(m: SessionMessage): boolean {
  return m.role === 'user' && m.text !== '' && !m.toolResults?.length
}

// One reply = every assistant text from one prompt of the person's to the next; each
// reply here is its blocks, the texts the chat draws apart (split by tool calls).
function replyParts(messages: readonly SessionMessage[]): string[][] {
  const out: string[][] = []
  let current: string[] | null = null
  for (const m of messages) {
    if (isPrompt(m)) {
      if (current?.length) out.push(current)
      current = []
    } else if (m.role === 'assistant' && m.text.trim() !== '') {
      ;(current ??= []).push(m.text.trim())
    }
  }
  if (current?.length) out.push(current)
  return out
}

export function replies(messages: readonly SessionMessage[]): string[] {
  return replyParts(messages).map(parts => parts.join('\n\n'))
}

// Whether `pin` holds the chat's block `id`: pinned from its button, or as part of a whole
// reply pinned with /pin. Messages carry no ids, so /pin's blocks are matched by text.
function holds(pin: Pin, id: string, text: string): boolean {
  return pin.id === id || (pin.parts?.includes(text) ?? false)
}

// The first line of the prompt before the last assistant message that `text` holds or is
// part of. Messages carry no ids, so a reply is found by its text.
export function promptBefore(messages: readonly SessionMessage[], text: string): string | undefined {
  let prompt: string | undefined
  let found: string | undefined
  for (const m of messages) {
    const own = m.text.trim()
    if (isPrompt(m)) prompt = m.text
    else if (m.role === 'assistant' && own !== '' && (own.includes(text) || text.includes(own))) found = prompt
  }
  const line = found?.split('\n').find(l => l.trim() !== '')?.trim()
  return line === undefined ? undefined : line.slice(0, 200)
}

// The terminal cuts the pane's header at its edge (wrap="truncate-end"); the desktop app
// ignores that and wraps, so there the preview is cut to fit one line of a narrow pane.
const DESKTOP_PREVIEW_CHARS = 45

export function promptPreview(prompt: string, surface: string): string {
  if (surface === 'terminal' || prompt.length <= DESKTOP_PREVIEW_CHARS) return prompt
  return `${prompt.slice(0, DESKTOP_PREVIEW_CHARS - 1).trimEnd()}…`
}

export function firstLine(text: string): string {
  const line = text.split('\n').find(l => l.trim() !== '') ?? ''
  const plain = line.replace(/^[#>*\-`\s]+/, '')
  return plain.length > 60 ? `${plain.slice(0, 57)}...` : plain
}

export const register: Register = (on, options) => {
  keepMs = options.keep === 'forever' ? Infinity : 7 * DAY_MS

  on('session.start', async ($, e, next) => {
    await sweep($)
    await refresh($)
    if (options.sync === 'every 5 seconds') $.clock.every(5000, () => void refresh($))
    await $.command.register({
      name: 'pin',
      description: "Pin Claude's last reply to the Pinned pane",
    })
    await $.command.register({
      name: 'unpin',
      description: 'Unpin a reply: /unpin N (as numbered in the pane), or /unpin all',
      argumentHint: '[N|all]',
    })
    await $.command.register({ name: 'pins', description: 'Show the Pinned pane' })

    return next(e)
  })

  on('command.run', { command: 'pin' }, async $ => {
    const messages = await $.session.messages()
    const parts = (Array.isArray(messages) ? replyParts(messages) : []).at(-1)
    if (parts === undefined) return { text: 'No reply to pin yet.' }
    const text = parts.join('\n\n')
    const list = await read($, pins)
    if (!list.some(p => p.text === text)) {
      const now = await $.clock.now()
      const prompt = promptBefore(messages as SessionMessage[], text)
      const pin: Pin = { id: `cmd-${now}`, text, pinnedAt: now, prompt, parts }
      // The whole reply takes the place of its blocks pinned from their buttons.
      await change($, l => [...l.filter(p => p.parts !== undefined || !parts.includes(p.text)), pin])
    }
    await $.ui.open({ id: PANE, title: 'Pinned' })

    return { text: `Pinned: ${firstLine(text)}` }
  })

  on('command.run', { command: 'unpin' }, async ($, e) => {
    const arg = e.args.trim()
    const list = await read($, pins)
    if (arg === 'all') {
      await change($, () => [])
      return { text: `Unpinned ${list.length}.` }
    }
    const n = arg === '' ? list.length : Number(arg)
    const target = list[n - 1]
    if (!Number.isInteger(n) || target === undefined) {
      return { text: list.length ? `Usage: /unpin [1-${list.length}|all]` : 'Nothing pinned.' }
    }
    await change($, l => l.filter(p => p.id !== target.id))

    return { text: `Unpinned #${n}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('command.run', { command: 'pins' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Pinned' })

    return { text: 'Pinned pane opened.' }
  })

  // A pin button under each block of Claude's reply: shown on hover, always once pinned.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.isSummary || e.props.text.trim() === '') return drawn

    const { Box, Text, Button } = $.ui.resolve(e)
    const id = e.requestId
    const text = e.props.text.trim()
    const isPinned = (await read($, pins)).some(p => holds(p, id, text))
    const toggle = async () => {
      if (isPinned) {
        // A block of a reply pinned with /pin unpins that whole reply.
        await change($, l => l.filter(p => !holds(p, id, text)))
        return
      }
      const now = await $.clock.now()
      const messages = await $.session.messages()
      const prompt = Array.isArray(messages) ? promptBefore(messages, text) : undefined
      await change($, l => [...l.filter(p => p.id !== id), { id, text, pinnedAt: now, prompt }])
      await $.ui.open({ id: PANE, title: 'Pinned' })
    }

    return (
      <Box key={`row-${id}`} flexDirection="column">
        {drawn}
        {/* Absolute: shown or hidden, it never moves the transcript. Pinned: always shown;
            the engine refuses a hover reveal on a Box that's already shown, so only unpinned gets one. */}
        <Box
          position="absolute"
          top={0}
          right={0}
          {...(isPinned ? { display: 'flex' } : { display: 'none', hover: { display: 'flex' } })}
        >
          <Button key={`pin-${id}`} plain dimColor={!isPinned} onPress={toggle}>
            <Text color={PIN_COLOR} bold={pinLabel(e.surface).bold}>
              {pinLabel(e.surface).text}
            </Text>
          </Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const list = await read($, pins)

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Nothing pinned. Hover a reply and click the pin at its top right, or type /pin.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {list.map((pin, i) => (
          <Box flexDirection="column" marginBottom={1}>
            <Box justifyContent="space-between">
              <Box flexShrink={1} marginRight={1}>
                <Text wrap="truncate-end">
                  <Text bold>#{i + 1}</Text>
                  {pin.prompt !== undefined && <Text dimColor> {promptPreview(pin.prompt, e.surface)}</Text>}
                </Text>
              </Box>
              <Button
                key={`unpin-${pin.id}`}
                plain
                onPress={() => change($, l => l.filter(p => p.id !== pin.id))}
              >
                <Text color={PIN_COLOR} bold={pinLabel(e.surface).bold}>
                  {pinLabel(e.surface).text}
                </Text>
              </Button>
            </Box>
            <Markdown text={pin.text} />
          </Box>
        ))}
      </Box>
    )
  })
}
