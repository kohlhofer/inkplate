# Inkplate 6COLOR

Board: Soldered Inkplate 6COLOR. ESP32-D0WD-V3 (WROVER-E), 4MB flash, CH340 USB-serial,
600x448 ACeP panel with 7 colours (`INKPLATE_BLACK/WHITE/GREEN/BLUE/RED/YELLOW/ORANGE`).
Identified 2026-09-12 by chip (plain ESP32 rules out 7SPECTRA and 13SPECTRA, which are
ESP32-S3) and by the string "Welcome to Inkplate 6COLOR!" in the old firmware.

## Toolchain

- `arduino-cli` + `esptool` from Homebrew.
- Board index: `https://raw.githubusercontent.com/SolderedElectronics/Inkplate-Board-Definitions-for-Arduino-IDE/refs/heads/main/package_Inkplate_Boards_index.json`
  (the older Dasduino index ships `Inkplate_Boards:esp32`, which is outdated; don't use it).
- Core `soldered-inkplate-boards:esp32`, FQBN `soldered-inkplate-boards:esp32:Inkplate6COLOR`.
- Library `InkplateLibrary` (Arduino library manager). Examples live in
  `~/Documents/Arduino/libraries/InkplateLibrary/examples/Inkplate6COLOR/`.

## Workflow

`make` compiles, `make upload SKETCH=sketches/<name>`, `make monitor`, `make flash` (upload then monitor).
Each sketch is a folder under `sketches/` whose `.ino` matches the folder name.

## Hardware gotchas

- The side power switch must be on. With it off, the CH340 still enumerates as
  `/dev/cu.usbserial-*` but the ESP32 never answers ("No serial data received").
- The CH340 link corrupts at 921600 baud. Uploads at the board default 460800 are fine;
  long `esptool read-flash` runs need 115200.
- A full refresh takes ~12 s and there is no partial update. Don't refresh in a tight loop.
- `display.touchpad.read()` panics (null pointer): InkplateLibrary 11.1.5's 6COLOR driver never calls
  `touchpad.begin()`. Current 6COLOR boards likely have no touchpads anyway. The library's
  `Inkplate6COLOR_Read_Touchpads` example crashes the same way.
- `sketches/probe` reports what the board sees. On 2026-09-12: 4MB PSRAM, I2C devices 0x20
  (PCAL6416A expander) and 0x51 (PCF85063A RTC), RTC unset, battery ADC 4.23 V, no SD card.
- `firmware-backup/` holds the full 4MB image read off the board before development;
  `make restore-backup` writes it back.

## videotext

A teletext-inspired wall display: a Node relay renders pages to frames, the board pulls
and draws them over WiFi. The board never accepts connections; all design lives in the
relay. This section is the complete behavioural contract — frame format, HTTP API,
markup grammar, view resolution, sender reference — there is nothing else to read.
Source: `sketches/videotext/` (firmware), `src/` (relay + CLI), `bin/vt.js` (CLI
entrypoint), `test/` (one file per module).

### Running the relay

`node bin/vt.js serve [--port N]` is the only way to run it — there is no `make relay`.
It also prints the LAN URL(s) to use as the board's `RELAY_HOST` and warns if no board
token exists yet. Env overrides: `VT_DATA` (data dir, default `~/Library/Application
Support/videotext`), `VT_HOST` (bind address, default `0.0.0.0`), `VT_PORT` (default
8080), `VT_THEME` (`dark`|`light`, default `dark` — a relay restart is required to
change it; there is no runtime theme switch). `VT_DATA` is how a worktree and the main
checkout can share state without touching the real data dir from either.

**The relay dies when the laptop sleeps.** `make relay-install` runs it as a LaunchAgent
(`relay-install.plist.template` + `~/Library/LaunchAgents/com.videotext.relay.plist`,
`RunAtLoad`+`KeepAlive`) — this is the only keep-running mechanism, and it is opt-in,
never installed automatically. It checks `/healthz` after loading and warns if the
relay didn't come up — the usual cause is a separately-running foreground `vt serve`
already holding the port, which makes the `KeepAlive` LaunchAgent crash-loop forever
(bind fails, exits, relaunches, repeat); stop any foreground `vt serve` first.
`make relay-uninstall` reverses it. Logs go to `relay.log` in the repo root.

**Poll interval vs. coalescing** (`config.example.h`'s `POLL_SECONDS`, finding M25): the
relay coalesces a `timer` wake that already has the current frame (`If-None-Match`) into
a cheap 304 for 180s (`MIN_REDRAW_INTERVAL_MS`) at a time, so redraws never happen more
often than every 3 minutes regardless of how often the board polls — but an urgent page
still bypasses coalescing immediately. `POLL_SECONDS=60` (wall power) means a genuinely
new urgent page reaches the wall within a minute, at the cost of 2 out of every 3 timer
wakes being a no-op 304. `POLL_SECONDS=900` (battery, in the deployed `config.h`) trades
that urgency latency for far fewer wakes; either value is a deliberate choice, not a bug.

### Tokens

Tokens are local file operations, not an HTTP route: `node bin/vt.js token add <name>
--pages 200-299 [--images] [--urgent] [--save] [--replace]`, `token list`, `token revoke
<name>`, and `token board --rotate` — the *only* way to see the board token's plaintext
(no separate "show" command, no auto-print on first run). Rotating replaces the previous
board token immediately. `--save` writes the printed sender token into
`~/.config/vt/config.json`. **`BOARD_TOKEN` in `sketches/videotext/config.h` comes only
from `node bin/vt.js token board --rotate`'s printed output, copied in by hand before
flashing** — this repo's own tooling never reads, writes, or edits `config.h`, and there
is no other source for that value; do not put a `--save`d sender token there (a sender
token gets `403 forbidden_role` from `/frame`, which the board reports as "board token
rejected", not "sender token" — the board only ever holds a board-role token).

### CLI round-trip

Examples use `node bin/vt.js` explicitly, so they work from a fresh checkout with no
setup. Once installed (`npm link`, once), drop the `node bin/vt.js` prefix and call `vt`
directly — every example below still works either way.

```
node bin/vt.js token add demo --pages 200-299 --images --urgent --save
node bin/vt.js serve &
node bin/vt.js send 205 "Deploy done" --body "all tests passed"
node bin/vt.js ls
node bin/vt.js preview 205 --out /tmp/205.png
node bin/vt.js status
node bin/vt.js rm 205
```

**Legibility test card** (both themes, no built-in test-card code — this is a real `vt
send`, to page 205, inside the `demo` token's 200-299 range from the round-trip above):
```
vt send 205 "Legibility test" --body "{red}red{/} {green}green{/} {blue}blue{/} {yellow}yellow{/} {orange}orange{/} {white}white{/} {black}black{/}"
vt preview 205
# restart the relay with VT_THEME=light and repeat vt preview 205
```
`vt preview`'s PNG approximates the panel but isn't colour-calibrated against it — in
particular its white (RGB 255,255,255) reads brighter than the real ACeP panel's white.
Treat it as a layout/contrast check, not a proof of exact on-wall colour.

### Sender reference

Everything a sender (a script or person posting pages, as opposed to the board) needs,
in one place.

- **Page numbers**: 101-899. 100 is the generated front page (`reserved_page` if
  targeted directly) and is always readable via `GET /pages`, `GET /preview/100.png`.
  Each sender token is scoped to a contiguous range (e.g. `200-299`, set at `token add
  --pages`); posting outside it is `403 forbidden_range`. Any valid sender token may
  *read* any page (`GET /pages`, `/preview/:n.png`, `/status`) regardless of range — the
  wall is a shared physical object, and every sender needs to see what else is live to
  avoid clobbering another sender's page number.
- **POST /pages/:n JSON fields**: `title` (required, non-empty, cut to 48 chars — the
  real render width, cut chars are reported in `warnings`), `body` (default `""`, max
  8192 bytes), `ttl` (default `86400`, i.e. 1 day; seconds as a bare number or `"2h"`/
  `"90m"`/`"1d"`, max 7 days), `urgent` (boolean, requires the token's `urgent`
  capability), `layout` (`"text"`|`"image-left"`|`"image-top"`|`"image"`, default
  `"text"`), `image` (`{data: base64, style: "dither"|"blocks"}`, requires the token's
  `images` capability and a non-`"text"` layout), `chart` (`{type: "spark"|"bars",
  values: [1..600 numbers], labels?, label?}`, requires `layout: "text"` and no `image`
  on the same page). Any other top-level key is a `400 invalid_body` naming it.
- **Markup tags** (inside `body`, theme-independent — colour *meaning* is fixed, the
  actual RGB is theme-dependent and provisional): `{red}` (alerts/failures), `{green}`
  (success), `{blue}`, `{yellow}` (caution), `{orange}`, `{white}`, `{black}` set the
  active foreground/band colour; `{/}` resets to the page's default. An unknown `{word}`
  renders literally (braces included) and is reported once in `warnings` even if
  repeated. Fenced blocks (a line that is exactly ` ``` ` to open and close) are never
  word-wrapped, only cropped at the column edge — use them for anything pre-formatted
  (box-drawing, tables); colour tags still parse inside them.
- **Layouts**: `text` — full-width wrapped body, optionally with one `chart`.
  `image-left` — a 24-column image on the left, wrapped text on the right.
  `image-top` — a full-width image on top, wrapped text below. `image` — a large
  full-width image with a single-line caption (the first line of `body`; anything past
  it, or wider than the panel, is silently dropped and reported in `warnings`).
- **Image styles**: `dither` (Floyd-Steinberg, full resolution — better for photos)
  and `blocks` (2x3 sub-cell dual-colour quantization per character cell — a
  deliberately blockier, more teletext-native look). Both take a base64 PNG or JPEG,
  capped at 4 megapixels.
- **Charts**: `spark` scales its own min→max (so a narrow-range series still shows
  visible variation) and packs columns edge-to-edge; `bars` stays 0-based (a bar
  chart's zero baseline is meaningful) and leaves a 1px gap between columns. Both
  snap to whole grid cells with a sub-cell accent-coloured cap for the remainder.
- **Urgent** (`urgent: true`, requires the token's `urgent` capability): the page gets
  forced onto the wall (front page banner) the next time the board wakes for a timer or
  boot reason — never a button press — throttled to once per 10 minutes so a burst of
  urgent posts doesn't repeatedly interrupt whatever's already showing. The banner shows
  for as long as that page stays live and urgent, independent of how many redraws
  happen in between.
- **Warnings** (in the `201` response's `warnings[]`, one string per issue, never
  fatal): `"title cut"`, `"N lines truncated"`, `"N fenced line(s) cropped"`,
  `"unknown tag {x}"` (deduplicated), `"extra body lines dropped (image layout keeps
  only a caption)"`.
- **Error codes** (`{"error":{"code","message"}}`, all 4xx/409 except `internal_error`):
  `unauthorized`, `forbidden_range`, `forbidden_images`, `forbidden_urgent`,
  `forbidden_role`, `reserved_page`, `invalid_page`, `invalid_reason`, `invalid_ttl`,
  `invalid_body`, `invalid_request` (malformed URL), `method_not_allowed`,
  `payload_too_large`, `rate_limited`, `unsupported_image`, `not_found`,
  `schema_conflict` (409 — a page on disk has a schema version this relay doesn't
  understand; it refuses to overwrite it), `internal_error`.
- **What's visible on the wall**: a page's `title` is what appears in the P100 listing
  (there is no separate body snippet); the sender token's `name` appears in the page's
  own header (`vt token add`'s first argument) — pick token names accordingly, since
  they're effectively public on a shared physical display.
- **Board's local error screens**: when the board can't reach a working relay at all, it
  draws its own black-background/white-text screen (not the relay's rendering) naming
  the actual cause (`WiFi <SSID> not joined`, `can't reach relay <host>:<port>`, `board
  token rejected`, `relay error <status>`) and what to do about it. It only appears
  after a real failure, backs off (longer between retries the longer it's been failing,
  capped at 30 minutes), and never uses the word "offline" before the board has ever
  successfully shown a real page.
- Button presses are only read while the board is awake; a press during the ~1-2s poll
  window plus the ~12.5s panel refresh is physically not registered, not silently
  dropped by software — there's no debounce/queue to miss.

### Hardware bring-up checklist (after flashing)

1. Flash with the real `config.h` (WiFi credentials filled in, `BOARD_TOKEN` set from
   `vt token board --rotate` — see Tokens above); watch `make monitor` through boot —
   expect the cold-start log line (`videotext: cold start etag=empty page=100
   failures=0`).
2. Observe at least 3 full timer poll cycles on serial; confirm the per-wake timing line
   (`videotext: reason=... wifi_ms=... fetch_ms=... read_ms=... unpack_ms=...
   display_ms=... total_ms=... status=... page=... etag=... sleep_s=...`) each time, and
   that `sleep_s` is `POLL_SECONDS` on every successful wake (there is no server-driven
   poll hint).
3. Press the wake button; confirm `reason=button` in the log and that the shown page
   advances per the button cycle.
4. Stop the relay (Ctrl-C on `vt serve`); confirm the board logs failures, shows its
   local black-background error screen (headline names the actual cause) on the first
   and third consecutive failures, `sleep_s` grows on each subsequent failed wake
   (60 → 120 → 240 → ... capped at 1800), and the stored ETag is cleared on the third.
5. Restart the relay; confirm the next wake redraws unconditionally (no stray 304),
   clears the failure/backoff state, and `sleep_s` returns to `POLL_SECONDS`.
6. Post the legibility test card in both themes (above) and visually assess each colour
   tag's contrast on the physical panel — the theme tables are marked PROVISIONAL for
   exactly this reason.
