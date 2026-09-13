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

A teletext-style wall display. A Node relay on the Mac renders pages into 600x448 frames,
and the board wakes, pulls the current frame over WiFi, draws it and sleeps. The board
never accepts connections; all layout and design live in the relay, so changing how the
wall looks never needs a reflash. Source: `sketches/videotext/` (firmware), `src/relay/`,
`src/render/`, `src/image/`, `src/cli/`, `bin/vt.js`, `test/`.

Text uses Bedstead (`font/bedstead.c`, CC0), the recreation of the Mullard SAA5050 teletext
character generator: glyphs are pixel-doubled with the chip's corner rounding, on a 50x18
grid of 12x24 cells with text inset one cell. `node font/generate-font-data.mjs`
regenerates `font/font-data.js` from it. Block, box-drawing and sextant characters are
drawn procedurally so they tile.

### From nothing to a working wall

1. `npm install` (Node 23+). Everything below runs from the repo root; `npm link` once
   makes `vt` available instead of `node bin/vt.js`.
2. `node bin/vt.js token board --rotate` prints the board token once.
   `node bin/vt.js token add <name> --pages 101-899 --images --urgent --save` creates your
   own sender token and saves it to `~/.config/vt/config.json`.
3. `make relay-install` runs the relay as a login service from this checkout (logs in
   `relay.log`; `make relay-uninstall` removes it). For a foreground run instead:
   `node bin/vt.js serve`, which prints the `RELAY_HOST`/`RELAY_PORT` lines for the board.
4. `cp sketches/videotext/config.example.h sketches/videotext/config.h` (gitignored) and
   fill in `WIFI_SSID`, `WIFI_PASS`, `RELAY_HOST` (the Mac's LAN IP, bare), `RELAY_PORT`,
   `BOARD_TOKEN` (from step 2, never a sender token) and `POLL_SECONDS` (60 on wall
   power, 900 on battery). A DHCP reservation for the Mac keeps `RELAY_HOST` valid.
5. Switch the board on and `make upload SKETCH=sketches/videotext` (a bare `make upload`
   builds `hello`). The first frame appears about 15 s later: "Nothing posted" on an
   empty relay means everything works.
6. `node bin/vt.js send 201 "Hello" --body "{green}it works{/}"` and
   `node bin/vt.js status` to see what the board last fetched.

The relay can't answer while the Mac sleeps or is off. The board then backs off (see
"When things fail") and catches up on its own once the Mac is back.

### What the wall shows

- **The wall opens on content**: after boot, and on every timer wake, it shows the
  lowest-numbered live page. The index (P100) is the default only when nothing is live.
- **The button** steps through the live pages in order, then the index, then back to the
  first page. Someone who pressed it in the last 10 minutes stays on their page; after
  that the wall returns to the first page. Presses while the board is drawing (about 15 s)
  are not registered.
- **Pages 101-899**: header (number, sender token name, posted date), double-height title,
  body, footer (position, next page, expiry).
- **P100, the index**: today's date, a newsflash band while an urgent page is live, and one
  row per live page (number, title, posted day and time). With no pages it says "Nothing
  posted" over a stripe of all seven panel colours.
- **Updates**: the board polls every `POLL_SECONDS`. The relay only lets a timer wake
  redraw once every 3 minutes (a redraw is a 12 s full-panel flash), so a change to the
  first page shows within about 3 minutes on wall power. An urgent page skips that wait:
  the wall shows that page itself at the next poll, at most once per 10 minutes. Pick low
  page numbers for what should be on the wall by default.
- **Theme**: `VT_THEME=dark` (default) or `light`, read at relay start. The colour tables
  in `src/render/theme.js` are still provisional until checked on the panel.

### Sender reference

- **CLI**: `node bin/vt.js send <page> <title> [--body text | stdin] [--ttl 2h] [--urgent]
  [--replace] [--layout text|image-left|image-top|image] [--image file.png|jpg]
  [--style dither|blocks] [--chart "1 2 3" --chart-type spark|bars --chart-label text]`,
  plus `rm <page>`, `ls`, `preview <page> [--out file.png]`, `status`, `token add|list|
  revoke|board`. Unknown flags are rejected.
- **HTTP**: `POST /pages/:n` with `Authorization: Bearer <sender token>` and JSON fields
  `title` (required, cut to 48 chars), `body` (max 8 KiB), `ttl` (seconds or `"90m"`,
  `"2h"`, `"1d"`; default 1 day, max 7 days), `urgent` (boolean; token needs `--urgent`),
  `layout`, `image` (`{data: base64, style}`; token needs `--images`; not with `text`),
  `chart` (`{type, values: up to 600 numbers, label?}`; `text` layout only), `replace`
  (boolean). Other keys are rejected. `DELETE /pages/:n`, `GET /pages`,
  `GET /preview/:n.png`, `GET /status`.
- **Page ranges**: each sender token may write only its `--pages` range; 100 is
  generated. Ranges may overlap, but a live page belongs to whoever posted it: posting
  over another sender's live page is `409 page_taken` unless the post sets `replace`,
  which then warns. Any sender token may read every page. Token names appear on the wall.
- **Markup**: `{red}` needs you, `{yellow}` attention, `{green}` fine, `{blue}` info,
  `{orange}`, `{white}`, `{black}`; `{/}` resets. Tagged text sits on a band of that
  colour; a tagged run of block characters (`{red}████`) is drawn in that colour. Unknown
  tags render literally. Lines between ```` ``` ```` fences are never wrapped, only
  cropped, for ASCII and block art.
- **Layouts**: `text`; `image-left` (image left, text right); `image-top`; `image` (large
  image, first body line as caption). Image `style`: `dither` for photos, `blocks` for a
  mosaic look. PNG or JPEG, up to 4 MP.
- **Charts**: `spark` scales min to max and labels both; `bars` starts at zero. Columns
  are solid accent colour and snap to whole cells.
- **Responses**: `201` carries `location` (whether the page is first on the wall, urgent,
  or behind another page) and `warnings[]` for anything cut, dropped or replaced. Errors
  are `{"error":{"code","message"}}` with a message that says what to change.
- **Theme**: in `light`, page numbers and titles are white on a blue band, because blue
  text is barely distinguishable from black on the panel.

### When things fail

The board draws its own black error screen, separate from the relay's rendering, naming
the cause and the fix: `WiFi <SSID> not joined`, `can't reach relay <host>:<port>`,
`board token rejected` (401 or 403, usually a sender token in `BOARD_TOKEN`), or
`relay error <status>`. A board that has never drawn a page shows it on the first failure;
one that has shows it on the third, so a single missed poll never replaces the wall. While
WiFi or the relay is unreachable, sleep doubles each failed wake (2x, 4x ... `POLL_SECONDS`,
capped at 30 minutes); an error answer from a running relay keeps the normal interval.
A button press retries immediately.

`make monitor` (interactive) or `make log LOG_SECONDS=90` (scripts and agents) shows one
line per wake:
`videotext: reason=timer join=cached wifi_ms=... fetch_ms=... read_ms=... unpack_ms=...
display_ms=... total_ms=... status=304 page=205 etag=... sleep_s=60`. A no-change wake on
wall power measured about 1.9 s awake, 1.6 s of it joining WiFi.

### Hardware check after flashing

1. `make monitor` through boot: expect `videotext: cold start` and a `status=200` wake
   showing the first live page (or 100 when nothing is posted).
2. Watch a few timer wakes: `status=304` with an unchanged `etag` while nothing changed,
   `sleep_s` equal to `POLL_SECONDS`, `join=cached` after the first wake.
3. Press the button: `reason=button` and the next page drawn.
4. Stop the relay: failures logged with `sleep_s` doubling from the first failed wake, the
   error screen on the third failure.
5. Start the relay and press the button: the page redraws and `sleep_s` returns to normal.
6. Send a page using every colour tag and judge contrast on the panel itself; `preview`
   PNGs approximate the panel and show white brighter than it is.
