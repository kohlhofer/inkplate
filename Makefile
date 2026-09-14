# Inkplate 6COLOR build helpers around arduino-cli.
#   make                                  compile the videotext firmware
#   make upload                           compile and flash it (SKETCH=sketches/<name> for another sketch)
#   make monitor
#   make backup                           read the board's whole flash into firmware-backup/ first
#   make log LOG_SECONDS=90               capture serial output without an interactive terminal
#   make font                             regenerate the board's Bedstead font header
#   make test-native                      compare the C++ renderer with the archived Node renderer
#   make tailnet-install                  serve the wall in the tailnet from this Mac (login service)

SKETCH ?= sketches/videotext
FQBN   := soldered-inkplate-boards:esp32:Inkplate6COLOR
# macOS names the CH340 port cu.usbserial-* or cu.wchusbserial*, Linux ttyUSB*.
PORT   ?= $(firstword $(wildcard /dev/cu.usbserial-*) $(wildcard /dev/cu.wchusbserial*) $(wildcard /dev/ttyUSB*))
BUILD  := build/$(notdir $(SKETCH))

TAILNET_PLIST := $(HOME)/Library/LaunchAgents/com.videotext.tailnet.plist
VT_BOARD ?= http://videotext.local

.PHONY: compile upload check-upload flash monitor log port backup restore-backup font test-native tailnet-install tailnet-uninstall

compile:
	arduino-cli compile --fqbn $(FQBN) --output-dir $(BUILD) $(SKETCH)

# The firmware compiles without config.h (it falls back to config.example.h), but
# a board flashed that way never joins WiFi, so upload refuses.
upload: check-upload compile
	arduino-cli upload --fqbn $(FQBN) --port $(PORT) --input-dir $(BUILD) $(SKETCH)

flash: upload monitor

check-upload:
	@test -f sketches/videotext/config.h -o "$(SKETCH)" != sketches/videotext || \
		(echo "sketches/videotext/config.h is missing: copy config.example.h to config.h and fill it in" && exit 1)
	@test -n "$(PORT)" || (echo "No Inkplate serial port found. Is it plugged in and switched on?" && exit 1)

monitor:
	arduino-cli monitor --port $(PORT) --config baudrate=115200

# Non-interactive capture (scripts, agents): arduino-cli monitor quits as soon
# as its stdin closes, so a sleeping pipe holds it open for LOG_SECONDS.
LOG_SECONDS ?= 90
log:
	@test -n "$(PORT)" || (echo "No Inkplate serial port found. Is it plugged in and switched on?" && exit 1)
	@perl -e 'alarm $(LOG_SECONDS); exec @ARGV' sh -c \
		'sleep $$(($(LOG_SECONDS) + 5)) | arduino-cli monitor --port $(PORT) --config baudrate=115200 --quiet' | \
		LC_ALL=C tr -d '\r' || true

port:
	@echo $(PORT)

# The whole 4 MB flash, at 115200 baud because the CH340 link corrupts long reads at
# higher speeds. Takes about six minutes. restore-backup writes a saved image back.
BACKUP ?= firmware-backup/inkplate6color-$(shell date +%Y-%m-%d).bin
backup:
	@test -n "$(PORT)" || (echo "No Inkplate serial port found. Is it plugged in and switched on?" && exit 1)
	@mkdir -p firmware-backup
	esptool --port $(PORT) --baud 115200 read-flash 0 0x400000 $(BACKUP)

restore-backup:
	@test -n "$(PORT)" || (echo "No Inkplate serial port found. Is it plugged in and switched on?" && exit 1)
	@test -f "$(BACKUP)" || (echo "no image at $(BACKUP); pass BACKUP=firmware-backup/<file>.bin" && exit 1)
	esptool --port $(PORT) --baud 115200 write-flash 0 $(BACKUP)

# Regenerates sketches/videotext/src/render/font_data.h from font/bedstead.c.
font:
	node tools/generate-font-header.mjs

# Builds the board's renderer and protocol code for the host. The renderer must
# match the archived Node renderer pixel for pixel (test/native/compare.mjs);
# the MCP handler, request validation and PNG encoder have their own checks.
RENDER_SRC := sketches/videotext/src/render
APP_SRC := sketches/videotext/src/app
ARDUINOJSON ?= $(shell arduino-cli config get directories.user)/libraries/ArduinoJson/src
NATIVE := build/native

test-native:
	@mkdir -p $(NATIVE)
	clang++ -std=c++17 -O2 -Wall -Wextra -I $(RENDER_SRC) -isystem $(ARDUINOJSON) \
		test/native/render_main.cpp $(RENDER_SRC)/*.cpp -o $(NATIVE)/render_main
	node test/native/compare.mjs $(NATIVE)/render_main
	clang++ -std=c++17 -O1 -Wall -Wextra -isystem $(ARDUINOJSON) \
		test/native/app_test.cpp $(APP_SRC)/*.cpp -o $(NATIVE)/app_test
	$(NATIVE)/app_test $(NATIVE)/app_test.png
	node test/native/check-png.mjs $(NATIVE)/app_test.png

# The tailnet proxy for the Mac that stays on at home (see README.md). The first
# run needs the node approved once: run `tailnet/videotext-proxy.sh start` by hand,
# open the login link, `tailnet/videotext-proxy.sh stop`, then install this.
tailnet-install:
	@test -x "$$(brew --prefix tailscale 2>/dev/null)/bin/tailscaled" || \
		(echo "run: brew install tailscale && brew unlink tailscale" && exit 1)
	@mkdir -p $(HOME)/Library/Logs
	sed -e 's#__REPO__#$(CURDIR)#' -e 's#__BOARD__#$(VT_BOARD)#' -e 's#__LOGDIR__#$(HOME)/Library/Logs#' \
		tailnet/com.videotext.tailnet.plist.template > $(TAILNET_PLIST)
	launchctl load $(TAILNET_PLIST)
	@echo "installed; logs in ~/Library/Logs/videotext-tailnet.log"

tailnet-uninstall:
	-launchctl unload $(TAILNET_PLIST) 2>/dev/null
	rm -f $(TAILNET_PLIST)
	@echo "uninstalled"
