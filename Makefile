# Inkplate 6COLOR build helpers around arduino-cli.
#   make                                  compile sketches/hello
#   make upload SKETCH=sketches/videotext
#   make monitor
#   make log LOG_SECONDS=90               capture serial output without an interactive terminal
#   make font                             regenerate the board's Bedstead font header
#   make test-native                      compare the C++ renderer with the archived Node renderer
#   make tailnet-install                  serve the wall in the tailnet from this Mac (login service)

SKETCH ?= sketches/hello
FQBN   := soldered-inkplate-boards:esp32:Inkplate6COLOR
PORT   ?= $(firstword $(wildcard /dev/cu.usbserial-*) $(wildcard /dev/cu.wchusbserial*))
BUILD  := build/$(notdir $(SKETCH))
BACKUP := firmware-backup/inkplate6color-full-flash-2026-09-12.bin

TAILNET_PLIST := $(HOME)/Library/LaunchAgents/com.videotext.tailnet.plist
VT_BOARD ?= http://192.168.86.242

.PHONY: compile upload flash monitor log port restore-backup font test-native tailnet-install tailnet-uninstall

compile:
	arduino-cli compile --fqbn $(FQBN) --output-dir $(BUILD) $(SKETCH)

upload: compile
	@test -n "$(PORT)" || (echo "No Inkplate serial port found. Is it plugged in and switched on?" && exit 1)
	arduino-cli upload --fqbn $(FQBN) --port $(PORT) --input-dir $(BUILD) $(SKETCH)

flash: upload monitor

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

# Writes the full 4MB image read off the board before any development started.
restore-backup:
	esptool --port $(PORT) --baud 115200 write-flash 0 $(BACKUP)

# Regenerates sketches/videotext/src/render/font_data.h from font/bedstead.c.
font:
	node tools/generate-font-header.mjs

# Builds the board's renderer and protocol code for the Mac. The renderer must
# match the archived Node renderer pixel for pixel (test/native/compare.mjs);
# the MCP handler, request validation and PNG encoder have their own checks.
RENDER_SRC := sketches/videotext/src/render
APP_SRC := sketches/videotext/src/app
ARDUINOJSON ?= $(HOME)/Documents/Arduino/libraries/ArduinoJson/src
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
