// Copy to config.h (gitignored) and fill in. videotext.ino falls back to this
// file with a #warning when config.h is missing, so the sketch always compiles.
#pragma once

#define WIFI_SSID "your-wifi-ssid"
#define WIFI_PASS "your-wifi-password"

// Every request except GET / must send this as "X-Api-Key: <key>" or
// "Authorization: Bearer <key>". A word is fine: it keeps guest devices off the
// wall and is easy to type from the wall's setup screen, which shows it.
#define API_KEY "change-me"

// The board answers at http://<HOSTNAME>.local
#define HOSTNAME "videotext"

// POSIX TZ string for the "updated" time in the header.
#define TIMEZONE "EST5EDT,M3.2.0,M11.1.0"
