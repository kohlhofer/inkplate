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

The board serves one teletext-style screen over HTTP and MCP; README.md covers using
it. The sketch is `sketches/videotext`:

- `videotext.ino`: WiFi (IPv6 on, power saving off), mDNS, NTP, LittleFS storage of
  `/screen.json` and `/drawn.hash`, the WebServer routes, the button, and `drawTask`.
- `src/render/`: C++17 port of the archived Node renderer, no Arduino headers. Must stay
  reentrant: previews render in the web server task while `drawTask` renders the panel.
- `src/app/`: `mcp.cpp` (stateless JSON-RPC), `screen_json.cpp` (request validation shared
  by HTTP and MCP), `png.cpp` (4-bit palette PNG, stored deflate), `guide.h` (the text agents
  read; one source for MCP instructions, the `show_screen` description and `GET /`).

Tasks and state: `loop()` on core 1 runs the web server and button; `drawTask` on core 0
owns the Inkplate object after `setup()`. Shared fields live in `State` behind
`stateMutex`. Every change bumps `wantedVersion`; `drawTask` draws the newest version once
the panel is free and skips frames whose FNV-1a hash matches `/drawn.hash`, so reboots
don't flash the panel. `display()` waits on the busy pin with `delay(1)`, which yields,
so a 30 s refresh on core 0 doesn't trip the watchdog.

### Firmware gotchas

- Include the project headers before `Inkplate.h`: InkplateLibrary `#define`s `BLACK` and
  `WHITE`, which breaks `vt::Color`.
- Every file that includes ArduinoJson must include it through `src/app/screen_json.h`, which
  sets `ARDUINOJSON_STRING_LENGTH_SIZE 4`. The 32-bit default caps strings at 65535
  characters, and an MCP result carries a ~180 KB base64 PNG.
- ArduinoJson stores numbers that fit a float as floats; `screen_json.cpp` takes chart
  values back through `%.7g` so labels round like the Node renderer.
- WebServer keeps a raw body in `arg("plain")` only for non-form content types, so clients
  must send `Content-Type: application/json`; `curl -d` alone sends a form.
- Types used in function signatures in the `.ino` must be declared before the first
  function: the Arduino builder inserts prototypes there.
- The core's WiFi auto-reconnect doesn't reliably recover a boot whose first join failed: on
  2026-09-13 the board came up after a night switched off and stayed off WiFi until reset.
  `keepWifiUp()` rejoins after 20 s down and restarts after 5 minutes. To test that path, build
  with `--build-property "compiler.cpp.extra_flags=-DVT_TEST_FAILED_FIRST_JOIN"` (the boot join
  uses a wrong password) and watch `make log`: a rejoin line at 20 s, then `wifi got ip`.
  `/status` reports `bootReason`, `wifiRejoins` and `lastWifiDisconnectReason`. The EN reset from
  USB serial reports as power-on, same as the side switch.
- Claude Code can't connect to `http://videotext.local/mcp` (30 s timeout), while curl, Node
  and the MCP SDK can. Register it with the IP. Without IPv6 on the board, macOS waits 5 s
  on every `.local` lookup for an AAAA answer.

### Checks after flashing

Run `make test-native` before flashing. On the board, with `KEY` from `config.h`:

1. `make log LOG_SECONDS=60`: a `drew v1 render_ms=~70 copy_ms=~240 display_ms=~29400` line
   when the frame differs from what's on the panel, nothing when it matches.
2. `curl http://videotext.local/` answers the guide; `/status` without the key is 401.
3. `PUT /screen` three times quickly: the log shows the first and the last drawn, not the middle.
4. Reset the board: `/status` keeps `hasScreen: true` and `lastDrawSecondsAgo: -1`.
5. `claude mcp list` shows `videotext ... ✔ Connected`; `show_screen` returns an image.
6. Press the button: the connection screen appears; press again to return.
