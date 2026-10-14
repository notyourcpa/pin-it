# pin-it

A Claude Code mod that pins Claude's replies to a side pane, so steps or info you need stay in view while the conversation moves on.

## Use

- Hover a reply and click the **⚲** at its top right to pin it; click again to unpin. A reply that uses tools is drawn in parts, and each part has its own ⚲. Pinned parts keep their ⚲ showing.
- `/pin` pins Claude's whole last reply, every part of it around tool calls; parts of it you pinned from the chat merge into that one pin. Clicking the ⚲ on any of its parts unpins the whole reply.
- `/unpin N` removes pin #N, `/unpin` alone removes the last pin, and `/unpin all` clears them; in the pane, click a pin's **⚲** to unpin it.
- `/pins` reopens the Pinned pane.
- Each pin in the pane is headed by the first line of the prompt it answered.

Pins are saved, so they come back when you restart Claude Code. Each pin is cleared 7 days after you pinned it. To keep pins until you unpin them, set **Pin it: keep pins** to `forever` in `/config` (it's stored in `~/.claude/settings.json`, so the desktop app follows it too). Expired pins are cleared when a session starts and whenever you pin or unpin.

Pins are kept per folder you start Claude in, so a subfolder or a git worktree of a project has its own list; this includes worktrees the desktop app makes for its sessions.

Open sessions started in the same folder share pins. An open session picks up a pin saved elsewhere when you send a prompt, when Claude finishes a turn, or when you run `/pins`. To have it check every 5 seconds as well, set **Pin it: sync pins** to `every 5 seconds` in `/config`.

### Limits

- The pane draws pins with the app's generic markdown, so styling (e.g. inline-code color) differs slightly from the chat.
- The desktop app draws the ⚲ grey; the terminal draws it orange.

## Install

Inside a Claude Code session (run `claude` first; this is a slash command, not a shell command):

```
/plugin install pin-it --marketplace notyourcpa/pin-it
```

Answer `y` to add the marketplace, then pick a scope.

Or from your shell:

```bash
claude plugin install pin-it --marketplace notyourcpa/pin-it
```

This adds the marketplace and installs for your user; pass `--scope project` or `--scope local` to install elsewhere.

## Develop

```bash
claude --plugin-dir path/to/pin-it
```

The folder is watched; saving a file reloads the mod.

```bash
claude plugin validate path/to/pin-it
claude plugin test path/to/pin-it
```

Code: `hooks/register.tsx`. State types: `types/index.d.ts`. Tests: `pin.test.ts`.

## License

MIT. See [LICENSE](LICENSE).
