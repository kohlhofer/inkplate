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
