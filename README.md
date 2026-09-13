# Inkplate Videotext

A teletext-style wall display built on a Soldered Inkplate 6COLOR. People, scripts and AI agents post pages to a small relay on a Mac, and the board wakes up, pulls the rendered frame over WiFi, draws it and goes back to sleep.

The board stays dumb on purpose. It never accepts connections and knows nothing about layout. The relay owns the grid, the Bedstead teletext font, the colours and every page, so changing how the wall looks never needs a reflash.

```
senders: vt CLI, scripts, agents
   │  POST /pages/301            (sender token)
   ▼
relay on the Mac: stores pages, expires them, renders 600x448 frames
   ▲
   │  GET /frame                 (board token, ETag of what it shows)
   │  → 304 nothing changed, or 200 + frame
board: wake (timer or button) → fetch → draw if changed → deep sleep
```

## Posting Pages

Every command below runs from the repo root. `npm link` once gives you `vt` instead of `node bin/vt.js`.

```sh
node bin/vt.js ls                                   # what's live, who owns it
node bin/vt.js send 301 "Cary, NC · Sunday" --ttl 1d --body "{yellow}Partly sunny{/}  high 90°"
node bin/vt.js preview 301 --out /tmp/301.png       # the rendered page as a PNG
node bin/vt.js rm 301
node bin/vt.js status                               # battery, signal, what the board last got
```

`send` prints where the page lands and any warnings. A title over 48 characters gets cut, a body that runs past the page gets truncated, and the relay tells you both. The index only has room for the first 34 characters of a title, so put the important words first. Check `preview` before trusting a layout.

### Choosing a Page Number

The wall opens on the lowest-numbered live page, so the number decides what people see without touching the button. Pages run from 101 to 899, and 100 is the generated index. Until someone decides otherwise, this is the house convention:

| Range | Use |
|---|---|
| 101-199 | Pinned by the owner: what should be on the wall by default |
| 200-299 | Agent jobs, builds, deploys |
| 300-399 | Home and weather |
| 400-499 | Calendar and reminders |
| 500-899 | Everything else |

Reuse the page you already own for the same topic, and set `--ttl` to how long the information stays true. A live page belongs to whoever posted it. Posting over someone else's page fails with `page_taken` unless you pass `--replace`, and you should only do that when you mean to.

### Writing the Body

The body is plain text on a 48-column grid. The `text` layout gives it 14 rows. Lines wrap at word boundaries and blank lines are kept.

Colour tags carry meaning, so use them for status and nothing else:

| Tag | Meaning |
|---|---|
| `{red}` | Needs you |
| `{yellow}` | Attention |
| `{green}` | Fine |
| `{blue}` | Information |
| `{orange}`, `{white}`, `{black}` | Free use |

`{/}` ends a tag. Tagged text sits on a band of that colour, and a tagged run of block characters (`{red}████`) is drawn in the colour itself. Unknown tags show up literally.

Lines between two ```` ``` ```` fences are never wrapped, only cropped at the edge. Use fences for tables and ASCII art. Box drawing (`┌─┐`), block elements (`▀▄█▒`) and teletext sextants (U+1FB00 to U+1FB3B) all tile cleanly. The font covers ASCII, Latin-1, dashes, curly quotes, bullets and arrows. Emoji have no glyph and render as blank space.

### Layouts, Charts and Images

`--layout` picks one of four fixed layouts. Senders never position anything themselves.

| Layout | Text area | Image area |
|---|---|---|
| `text` | 48 x 14 | none |
| `image-left` | 24 x 14, right side | 288 x 336 px, left side |
| `image-top` | 48 x 6, below | 600 x 168 px |
| `image` | first body line as caption | 600 x 312 px |

A chart belongs on a `text` page. Pass numbers, never a picture of a chart: `--chart "73 76 81 85 88" --chart-type spark --chart-label "°F by hour"`. A spark chart scales from the lowest to the highest value and labels both, and bars start at zero.

Images are PNG or JPEG up to 4 megapixels, sent with `--image photo.jpg`. `--style dither` suits photos and `--style blocks` gives a chunky mosaic look. Both need a token created with `--images`.

### Urgent Pages

`--urgent` puts the page on the wall at the board's next poll, skipping the usual three-minute wait, and shows a newsflash band on the index. The relay allows this at most once every 10 minutes. Keep it for things that need a person now, since every redraw flashes the whole panel for 30 seconds. The token needs `--urgent`.

## What the Wall Shows

On boot and on every timer wake, the wall shows the lowest-numbered live page. The button steps through the live pages in order, then the index, then back to the first page. Someone who pressed it in the last 10 minutes stays on their page. After that the wall returns to the first page.

Each page has a header with its number, the sender's token name and when it was posted, a double-height title, the body, and a footer with its position, the next page and its expiry. The index lists every live page. With nothing posted it says "Nothing posted" over a stripe of all seven panel colours.

The board polls every `POLL_SECONDS`, 60 on wall power and 900 on battery. The relay lets a timer wake redraw at most once every three minutes, because a redraw is a 30-second full-panel flash, so a change to the first page reaches the wall within about three minutes on wall power.

## HTTP API

Senders who can't run the CLI talk to the relay directly on port 8080 with `Authorization: Bearer <sender token>`.

`POST /pages/:n` takes JSON:

| Field | Notes |
|---|---|
| `title` | Required, cut to 48 characters |
| `body` | Up to 8 KiB of markup |
| `ttl` | Seconds, or `"90m"`, `"2h"`, `"1d"`. Default 1 day, maximum 7 days |
| `layout` | `text`, `image-left`, `image-top` or `image` |
| `chart` | `{"type": "spark"\|"bars", "values": [...], "label": "..."}`, `text` layout only |
| `image` | `{"data": "<base64>", "style": "dither"\|"blocks"}`, image layouts only |
| `urgent` | Boolean |
| `replace` | Boolean, to take over another sender's live page |

A `201` response carries `location` and `warnings`. Errors come back as `{"error": {"code", "message"}}` with a message that says what to change. The other routes are `DELETE /pages/:n`, `GET /pages`, `GET /preview/:n.png` and `GET /status`.

## Setting Up the Wall

1. Install Node 23 or newer and run `npm install`.
2. Create tokens. `node bin/vt.js token board --rotate` prints the board token once. `node bin/vt.js token add <name> --pages 101-899 --images --urgent --save` creates your sender token and saves it to `~/.config/vt/config.json`. The token name appears on the wall.
3. Run the relay. `make relay-install` installs it as a login service from this checkout, logging to `relay.log`, and `make relay-uninstall` removes it. `node bin/vt.js serve` runs it in the foreground and prints the `RELAY_HOST` and `RELAY_PORT` lines the board needs.
4. Copy `sketches/videotext/config.example.h` to `config.h` in the same folder and fill in the WiFi credentials, the Mac's LAN IP and port, the board token and the poll interval. `config.h` is gitignored. A DHCP reservation for the Mac keeps the IP stable.
5. Switch the board on and run `make upload SKETCH=sketches/videotext`. About 35 seconds later the wall shows "Nothing posted", which means everything works.

The relay can't answer while the Mac sleeps. The board backs off, doubling its sleep up to 30 minutes, and catches up once the Mac wakes. When the board can't get a frame at all, it draws its own black screen naming the cause: WiFi, an unreachable relay, a rejected token, or a relay error.

## For Agents

Agents should read the [videotext skill](.claude/skills/videotext/SKILL.md), which condenses this README into the steps for posting a good page. [AGENTS.md](AGENTS.md) points agents that don't load skills to the same place. Hardware notes, firmware details and the development workflow are in [CLAUDE.md](CLAUDE.md).

To make the skill available to Claude sessions in every project on this Mac, link it into the user skills folder:

```sh
ln -s "$PWD/.claude/skills/videotext" ~/.claude/skills/videotext
```

## Development

`npm test` runs the relay, renderer and CLI tests. `make log LOG_SECONDS=90` captures the board's serial output, one line per wake, without an interactive terminal. `node font/generate-font-data.mjs` regenerates the font table from `font/bedstead.c`, Bedstead's CC0 recreation of the SAA5050 teletext character set.
