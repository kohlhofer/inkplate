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
relay. See `sketches/videotext/`, `src/`, `bin/vt.js`, and the design brief this was
built from for the full behavioural contract (frame format, HTTP API, markup grammar,
view resolution).

### Running the relay

`node bin/vt.js serve [--port N]` is the only way to run it — there is no `make relay`.
Env overrides: `VT_DATA` (data dir, default `~/Library/Application Support/videotext`),
`VT_HOST` (bind address, default `0.0.0.0`), `VT_PORT` (default 8080), `VT_THEME`
(`dark`|`light`, default `dark` — a relay restart is required to change it; there is no
runtime theme switch). `VT_DATA` is how a worktree and the main checkout can share
state without touching the real data dir from either.

**The relay dies when the laptop sleeps.** `make relay-install` runs it as a LaunchAgent
(`relay-install.plist.template` + `~/Library/LaunchAgents/com.videotext.relay.plist`,
`RunAtLoad`+`KeepAlive`) — this is the only keep-running mechanism, and it is opt-in,
never installed automatically. `make relay-uninstall` reverses it. Logs go to
`relay.log` in the repo root.

### Tokens

Tokens are local file operations, not an HTTP route: `node bin/vt.js token add <name>
--pages 200-299 [--images] [--urgent] [--save]`, `token list`, `token revoke <name>`,
and `token board --rotate` — the *only* way to see the board token's plaintext (no
separate "show" command, no auto-print on first run). Rotating replaces the previous
board token immediately. `--save` writes the printed sender token into
`~/.config/vt/config.json`, which the orchestrator's flash-time step then copies into
`sketches/videotext/config.h`'s `BOARD_TOKEN` placeholder — this repo's own tooling
never edits `config.h`.

### CLI round-trip

```
node bin/vt.js token add demo --pages 200-299 --images --urgent --save
node bin/vt.js serve &
node bin/vt.js send 205 "Deploy done" --body "all tests passed"
node bin/vt.js ls
node bin/vt.js preview 205 --out /tmp/205.png
node bin/vt.js status
node bin/vt.js rm 205
```

**Legibility test card** (both themes, no built-in test-card code — this is a real
`vt send`):
```
vt send 101 "Legibility test" --body "{red}red{/} {green}green{/} {blue}blue{/} {yellow}yellow{/} {orange}orange{/} {white}white{/} {black}black{/}"
vt preview 101
# restart the relay with VT_THEME=light and repeat vt preview 101
```

### Hardware bring-up checklist (after flashing)

1. Flash with the real `config.h` (WiFi credentials filled in, `BOARD_TOKEN` set from
   `vt token board --rotate`); watch `make monitor` through boot — expect the cold-start
   log line (`videotext: cold start etag=empty page=100 failures=0`).
2. Observe at least 3 full timer poll cycles on serial; confirm the per-wake timing line
   (`videotext: reason=... wifi_ms=... fetch_ms=... unpack_ms=... display_ms=... total_ms=...
   status=... page=... etag=...`) each time, and that sleep duration is always `POLL_SECONDS`
   (there is no server-driven poll hint; see finding m22 in the round-2 fix notes).
3. Press the wake button; confirm `reason=button` in the log and that the shown page
   advances per the button cycle.
4. Stop the relay (Ctrl-C on `vt serve`); confirm the board logs failures, shows the
   "waiting for relay"/"relay offline since 3 wakes" screens at the documented
   thresholds, and that the stored ETag is cleared by the 3rd wake.
5. Restart the relay; confirm the next wake redraws unconditionally (no stray 304) and
   clears the failure/offline state.
6. Post the legibility test card in both themes (above) and visually assess each colour
   tag's contrast on the physical panel — the theme tables are marked PROVISIONAL for
   exactly this reason.
