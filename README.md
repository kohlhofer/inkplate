# Inkplate Videotext

A teletext-style wall display that runs entirely on a Soldered Inkplate 6COLOR. The board joins your WiFi, shows one screen, and serves an HTTP API and an MCP server, so any agent or script on the local network can replace what the wall shows.

There is nothing to run on a computer. The board stores the screen in flash, renders it with the Bedstead teletext font, and refreshes the panel only when the screen changes.

## Connecting an Agent

Press the button on the side of the board. The wall shows its IP address, the API key and the exact command to run. For Claude Code:

```sh
claude mcp add --transport http videotext http://<board-ip>/mcp --header "X-Api-Key: <key>"
```

Use the IP address for Claude Code, since it can't resolve `.local` names. Browsers, curl, Node and other MCP clients can also use `http://videotext.local`. A DHCP reservation for the board keeps the address stable.

The MCP server explains itself. Its instructions and the `show_screen` description carry the complete layout and markup rules, and every call returns a PNG of exactly what the wall will draw. An agent needs nothing beyond the connection.

| Tool | What it does |
|---|---|
| `show_screen` | Replaces the screen and returns the preview image and any warnings |
| `preview_screen` | Renders a screen without touching the wall |
| `get_screen` | Returns the current screen's fields, its state and an image of it |
| `clear_screen` | Removes the screen, so the wall shows its connection details |

## Sending a Screen Over HTTP

Every request except `GET /` needs the key as `X-Api-Key: <key>` or `Authorization: Bearer <key>`. JSON bodies need `Content-Type: application/json`.

```sh
curl -X PUT http://videotext.local/screen \
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"title": "Build status", "body": "{green}main{/} passed\n{red}release{/} failed: 2 tests", "footer": "CI"}'
```

| Endpoint | Purpose |
|---|---|
| `GET /` | The full guide, no key needed |
| `GET /screen` | The current screen as JSON, with its state and update time |
| `PUT /screen` | Replace the screen; only `title` is required |
| `POST /preview` | Render a screen to PNG without showing it; warnings in `X-Warnings` |
| `GET /preview` | PNG of what the wall should show now |
| `DELETE /screen` | Remove the screen |
| `GET /status` | IP, battery, signal, uptime, refresh state |
| `POST /mcp` | The MCP endpoint |

## What a Screen Looks Like

The wall is a fixed grid of 50 by 18 character cells, so senders choose words, not positions. The board draws the top row, "VIDEOTEXT" and when the screen was sent. The title is double height and holds 48 characters. The body is 48 characters wide and 14 rows tall, and an optional one-line footer sits at the bottom.

In the body, colour tags carry meaning: `{red}` needs a person, `{yellow}` is attention, `{green}` is fine and `{blue}` is information. Lines between two ```` ``` ```` fences are cropped instead of wrapped and keep their spacing, which is how tables and box-drawing or block-character pictures line up. A `chart` takes numbers, either a `spark` trend or `bars` from zero. `theme` is `dark` or `light`. There are no images.

`GET /` on the board has the complete rules. It's the same text agents receive over MCP.

## How the Wall Behaves

A new screen triggers a full refresh that flashes the panel for about 30 seconds. If several screens arrive during a refresh, the board draws only the newest once it finishes, and the API reply says how long until the new screen is readable. A screen survives power loss and reboots, and the board never redraws a frame that is already on the panel.

The button toggles between the screen and the connection details. The board keeps WiFi on all the time, so it wants USB power; on battery it lasts days, not months.

## Setting Up the Board

1. Install the toolchain from [CLAUDE.md](CLAUDE.md), plus `arduino-cli lib install ArduinoJson`.
2. Copy `sketches/videotext/config.example.h` to `config.h` in the same folder. Fill in the WiFi network and password, an API key (a memorable word is fine; the button screen shows it anyway), the hostname and your time zone. `config.h` is gitignored.
3. Switch the board on, plug it in and run `make upload SKETCH=sketches/videotext`.
4. About 30 seconds after it joins WiFi, the wall shows its connection details.

## Development

`make test-native` builds the renderer and protocol code for the Mac. The renderer has to match the archived Node renderer pixel for pixel across 29 fixtures, and the MCP handler, request validation and PNG encoder have their own tests. `make log LOG_SECONDS=90` captures the board's serial output, one line per redraw. `make font` regenerates the font header from `font/bedstead.c`.

The first version, a Node relay on the Mac serving many pages to a board that polled it, is kept in [archive/relay](archive/relay/README.md).
