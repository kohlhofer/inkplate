# Inkplate 6COLOR build helpers around arduino-cli.
#   make                      compile sketches/hello
#   make upload SKETCH=sketches/foo
#   make monitor
#   make relay-install        run the videotext relay as a LaunchAgent (opt-in, not automatic)

SKETCH ?= sketches/hello
FQBN   := soldered-inkplate-boards:esp32:Inkplate6COLOR
PORT   ?= $(firstword $(wildcard /dev/cu.usbserial-*) $(wildcard /dev/cu.wchusbserial*))
BUILD  := build/$(notdir $(SKETCH))
BACKUP := firmware-backup/inkplate6color-full-flash-2026-09-12.bin

PLIST_LABEL := com.videotext.relay
PLIST       := $(HOME)/Library/LaunchAgents/$(PLIST_LABEL).plist
NODE_BIN    := $(shell command -v node)
REPO_DIR    := $(CURDIR)

.PHONY: compile upload flash monitor port restore-backup relay-install relay-uninstall

compile:
	arduino-cli compile --fqbn $(FQBN) --output-dir $(BUILD) $(SKETCH)

upload: compile
	@test -n "$(PORT)" || (echo "No Inkplate serial port found. Is it plugged in and switched on?" && exit 1)
	arduino-cli upload --fqbn $(FQBN) --port $(PORT) --input-dir $(BUILD) $(SKETCH)

flash: upload monitor

monitor:
	arduino-cli monitor --port $(PORT) --config baudrate=115200

port:
	@echo $(PORT)

# Writes the full 4MB image read off the board before any development started.
restore-backup:
	esptool --port $(PORT) --baud 115200 write-flash 0 $(BACKUP)

# Not installed automatically. The relay dies when the laptop sleeps; this
# LaunchAgent (RunAtLoad + KeepAlive) is the only keep-running mechanism —
# `vt serve` in a foreground terminal is otherwise the only way to run it.
relay-install:
	@test -n "$(NODE_BIN)" || (echo "node not found on PATH" && exit 1)
	sed -e 's#__NODE_PATH__#$(NODE_BIN)#' -e 's#__BIN_PATH__#$(REPO_DIR)/bin/vt.js#' -e 's#__REPO_PATH__#$(REPO_DIR)#' \
		relay-install.plist.template > $(PLIST)
	launchctl load $(PLIST)
	@echo "installed and loaded $(PLIST)"

relay-uninstall:
	-launchctl unload $(PLIST) 2>/dev/null
	rm -f $(PLIST)
	@echo "uninstalled $(PLIST)"
