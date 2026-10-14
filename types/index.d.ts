// `prompt`: the first line of the person's prompt before the reply; absent on pins saved
// before it was recorded, or when the prompt couldn't be found.
// `parts`: on a whole reply pinned with /pin, the text of each block it joins; absent on a
// block pinned from its button, and on /pin pins saved before it was recorded.
export type Pin = { id: string; text: string; pinnedAt: number; prompt?: string; parts?: string[] }

declare module 'claude-code' {
  interface PluginState {
    'pin-it': { pins: Pin[] }
  }
}
