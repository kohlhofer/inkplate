# Inkplate 6COLOR build helpers around arduino-cli.
#   make                                  compile sketches/hello
#   make upload SKETCH=sketches/videotext
#   make monitor
#   make log LOG_SECONDS=90               capture serial output without an interactive terminal
#   make font                             regenerate the board's Bedstead font header
#   make test-native                      compare the C++ renderer with the archived Node renderer

SKETCH ?= sketches/hello
FQBN   := soldered-inkplate-boards:esp32:Inkplate6COLOR
PORT   ?= $(firstword $(wildcard /dev/cu.usbserial-*) $(wildcard /dev/cu.wchusbserial*))
BUILD  := build/$(notdir $(SKETCH))
BACKUP := firmware-backup/inkplate6color-full-flash-2026-09-12.bin

.PHONY: compile upload flash monitor log port restore-backup font test-native

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
