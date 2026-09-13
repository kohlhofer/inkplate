# Archived: Mac Relay Version

This is the first version of videotext, kept for reference and in case the design ever needs to come back. A Node relay on the Mac stored many pages, rendered them, and the board pulled frames in a deep-sleep loop. It was replaced by the single-screen server that runs on the board itself (`sketches/videotext`), because a relay on a laptop that sleeps kept the wall stale.

Everything here still works as it did at the time of archiving:

- `src/`, `bin/vt.js`, `test/`: the relay, renderer and `vt` CLI. `npm test` at the repo root runs these 253 tests.
- `sketches/videotext/`: the pull firmware. It needs a `config.h` next to `videotext.ino` with `WIFI_SSID`, `WIFI_PASS`, `RELAY_HOST`, `RELAY_PORT`, `BOARD_TOKEN` and `POLL_SECONDS`.
- `font/generate-font-data.mjs`: builds `font/font-data.js` from the Bedstead source in the repo's top-level `font/`.
- `relay-install.plist.template`: the LaunchAgent the relay ran under.

The board firmware's renderer is a C++ port of `src/render/`, and `make test-native` at the repo root still compares its pixels against this code. Keep the renderer here working for as long as that comparison matters.

To bring the relay back: run `node archive/relay/bin/vt.js serve` from the repo root, or restore the `relay-install` Makefile target from git history (commit `79ec001`). Then flash `archive/relay/sketches/videotext` with `make upload SKETCH=archive/relay/sketches/videotext`.
