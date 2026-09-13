// Copy this to config.h and fill in real values. config.h is gitignored so
// secrets never get committed; videotext.ino falls back to this file (with a
// #warning) when config.h is absent, so the sketch always compiles.

#define WIFI_SSID "your-wifi-ssid"
#define WIFI_PASS "your-wifi-password"
#define RELAY_HOST "192.168.1.50"
#define RELAY_PORT 8080
#define BOARD_TOKEN "set-at-flash-time"
#define POLL_SECONDS 60
