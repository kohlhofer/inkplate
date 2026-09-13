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
- There is no partial update. `display.display()` measured 29.4 s on 2026-09-13 when the board
  wakes from deep sleep to draw (videotext's timing log), so a redraw wake is about 32 s
  awake. Don't refresh in a tight loop.
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

Setup, page order, the sender guide and the HTTP API live in README.md. Agents posting
pages follow `.claude/skills/videotext/SKILL.md`; keep both in step with behaviour changes
to the relay, renderer or CLI. The relay runs as a login service from this checkout
(`make relay-install`), so `launchctl kickstart -k gui/$(id -u)/com.videotext.relay`
picks up relay changes. Relay data (tokens, pages, board status) lives in
`~/Library/Application Support/videotext` unless `VT_DATA` says otherwise.

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
