---
name: videotext
description: >
  How to put information on the teletext-style Inkplate wall display (videotext), which
  serves one screen over MCP and HTTP on the local network. Load before showing, replacing,
  previewing or clearing what the wall shows, and whenever someone asks to show, put, send or
  pin something on the wall, the display, the Inkplate or videotext: build or deploy status,
  weather, reminders, a chart, a notice.
---

# Showing Something on the Videotext Wall

The wall shows exactly one screen. It serves an MCP server itself, so the tools do the work and explain the rules.

If the `videotext` MCP tools are available (`show_screen`, `preview_screen`, `get_screen`, `clear_screen`), use them. Their descriptions and the server instructions have the complete layout and markup rules; follow those rather than anything remembered from elsewhere.

1. Call `get_screen` to see what's showing. Don't replace someone else's screen unless asked.
2. Call `show_screen`, then look at the image in the result before telling anyone it's up. Fix every warning and send again.
3. Only send when the content changed. Each new screen flashes the whole panel for about 30 seconds.

If the tools aren't connected, the board still answers over HTTP on its local network. `curl http://videotext.local/` returns the full guide, including the HTTP API; the name is different if whoever set the board up changed `HOSTNAME`. You need the board's address and API key. Pressing the button on the side of the board shows both, and they are in `sketches/videotext/config.h` in the repo that flashed it. Ask the person rather than guessing either one. A wall reached through Tailscale lives at `https://videotext.<tailnet>.ts.net` instead.

To connect Claude Code, use the board's IP address or the tailnet name, because Claude Code can't resolve `.local` names:

```sh
claude mcp add --scope user --transport http videotext http://<board-ip>/mcp --header "X-Api-Key: <key>"
```

If the board doesn't answer, it's switched off, not on WiFi, or on a network this machine can't reach. Tell the person rather than retrying.
