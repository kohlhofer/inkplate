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
RELAY_PORT  ?= 8080

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
# KeepAlive means a second, separately-started `vt serve` already holding
# RELAY_PORT will make this agent crash-loop forever (bind EADDRINUSE, exit,
# restart, repeat) — stop any foreground `vt serve` before installing this.
relay-install:
	@test -n "$(NODE_BIN)" || (echo "node not found on PATH" && exit 1)
	sed -e 's#__NODE_PATH__#$(NODE_BIN)#' -e 's#__BIN_PATH__#$(REPO_DIR)/bin/vt.js#' -e 's#__REPO_PATH__#$(REPO_DIR)#' \
		relay-install.plist.template > $(PLIST)
	launchctl load $(PLIST)
	@echo "installed and loaded $(PLIST)"
	@sleep 1
	@curl -sf http://127.0.0.1:$(RELAY_PORT)/healthz >/dev/null && echo "relay is healthy on port $(RELAY_PORT)" || \
		echo "warning: /healthz did not respond on port $(RELAY_PORT) within 1s -- if a separately running 'vt serve' already holds that port, this LaunchAgent will crash-loop retrying it; check 'launchctl list | grep $(PLIST_LABEL)' and 'cat relay.log'"

relay-uninstall:
	-launchctl unload $(PLIST) 2>/dev/null
	rm -f $(PLIST)
	@echo "uninstalled $(PLIST)"
