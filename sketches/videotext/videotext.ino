// Videotext board firmware: wake, fetch a rendered frame from the relay,
// draw it, deep sleep. All layout/content decisions live in the relay;
// the board is deliberately dumb. See CLAUDE.md's videotext section.

#ifndef ARDUINO_INKPLATECOLOR
#error "Select the Soldered Inkplate 6COLOR board."
#endif

#include "ESPmDNS.h"
#include "HTTPClient.h"
#include "Inkplate.h"
#include "WiFi.h"
#include "esp_system.h"

#if __has_include("config.h")
#include "config.h"
#else
#warning "config.h not found; using config.example.h placeholders (WiFi will not connect)."
#include "config.example.h"
#endif

#define FRAME_WIDTH 600
#define FRAME_HEIGHT 448
#define FRAME_BYTES ((FRAME_WIDTH * FRAME_HEIGHT) / 2)
#define WIFI_TIMEOUT_MS 15000
#define WIFI_POLL_MS 10
// B7: a dead/unreachable relay must fail fast on the TCP connect, not ride
// the full read timeout every single wake — the read timeout still needs to
// be generous, since the relay actually streams 134KB.
#define HTTP_CONNECT_TIMEOUT_MS 2000
#define HTTP_READ_TIMEOUT_MS 10000
#define MAX_BACKOFF_SECONDS 1800
#define FW_VERSION "1"

Inkplate display;

// Survives deep sleep; only takes these values on a genuine cold start
// (power-on/reflash/brownout), since C++ static initializers run once and
// RTC memory otherwise carries over from the previous wake.
RTC_DATA_ATTR char lastEtag[65] = "";
RTC_DATA_ATTR int lastPage = 100;
RTC_DATA_ATTR bool everDrawnRealFrame = false;
RTC_DATA_ATTR int consecutiveFailures = 0;
RTC_DATA_ATTR bool offlineNoticeShown = false;
// Total sleep time already spent failing, in seconds — accumulated from the
// actual (possibly backed-off) sleep durations used, not from
// consecutiveFailures * POLL_SECONDS, which would be wrong once backoff
// makes each failed wake's sleep longer than the last (finding M7).
RTC_DATA_ATTR uint32_t failureElapsedSeconds = 0;
// Cached from the last successful join, so most wakes can skip the AP scan
// (finding M26). No static IP: DHCP still runs every time.
RTC_DATA_ATTR uint8_t cachedBssid[6] = {0, 0, 0, 0, 0, 0};
RTC_DATA_ATTR int32_t cachedChannel = 0;
RTC_DATA_ATTR bool haveCachedWifi = false;

// A genuine cold start (power-on/reflash/brownout) is a reset reason other
// than waking from deep sleep — checking RTC variables against their static
// defaults instead (the old approach) also matches a *warm* wake that just
// hasn't succeeded or failed yet, which isn't the same thing (finding m7).
static bool isColdStart() {
    return esp_reset_reason() != ESP_RST_DEEPSLEEP;
}

static const char *wakeReason() {
    switch (esp_sleep_get_wakeup_cause()) {
    case ESP_SLEEP_WAKEUP_EXT0:
        return "button";
    case ESP_SLEEP_WAKEUP_TIMER:
        return "timer";
    default:
        return "boot";
    }
}

static bool looksLikeIp(const char *host) {
    for (const char *p = host; *p != '\0'; p++) {
        if (*p != '.' && !isdigit((unsigned char)*p)) return false;
    }
    return true;
}

// RELAY_HOST is a bare IP in the deployed config.h, which sidesteps mDNS
// entirely (the recommended default). MDNS.queryHost without a prior
// MDNS.begin() is unverified on this ESP32 core; moot for this deployment,
// but kept for a future .local RELAY_HOST.
static String resolveHost() {
    if (looksLikeIp(RELAY_HOST)) return String(RELAY_HOST);
    MDNS.begin("videotext");
    IPAddress ip = MDNS.queryHost(RELAY_HOST, 2000);
    if (ip == IPAddress((uint32_t)0)) return String(RELAY_HOST);
    return ip.toString();
}

static bool waitForWifi(uint32_t timeoutMs) {
    const uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
        delay(WIFI_POLL_MS); // M26: poll every 10ms, not 200ms
    }
    return WiFi.status() == WL_CONNECTED;
}

// Joins by cached BSSID/channel when we have one (skips the AP scan on most
// wakes); falls back to a normal scan-and-join in the same wake if the
// cached join doesn't come up (the AP may have rebooted onto a different
// channel/BSSID) — never a static IP (finding M26).
static void connectWifi() {
    WiFi.mode(WIFI_STA);
    bool connected = false;
    if (haveCachedWifi) {
        WiFi.begin(WIFI_SSID, WIFI_PASS, cachedChannel, cachedBssid);
        connected = waitForWifi(WIFI_TIMEOUT_MS);
        if (!connected) {
            WiFi.disconnect();
            WiFi.begin(WIFI_SSID, WIFI_PASS);
            connected = waitForWifi(WIFI_TIMEOUT_MS);
        }
    } else {
        WiFi.begin(WIFI_SSID, WIFI_PASS);
        connected = waitForWifi(WIFI_TIMEOUT_MS);
    }

    if (connected) {
        memcpy(cachedBssid, WiFi.BSSID(), 6);
        cachedChannel = WiFi.channel();
        haveCachedWifi = true;
    } else {
        haveCachedWifi = false; // don't keep retrying a possibly-stale cache
    }
}

// Unpacks row-major 4bpp (2px/byte, high nibble = even x) straight to the
// panel via drawPixel, which handles the rotation-0 x/y flip inside
// DMemory4Bit for us (see CLAUDE.md's hardware gotchas). drawPixel is a
// per-pixel virtual call and is the likely cost center if the timing log
// below ever shows unpack_ms dominating — DMemory4Bit's buffer could be
// written directly instead, but rotation 0 flips x/y in that buffer, so
// that optimization is deferred until the log actually shows it's needed.
static void drawFrame(const uint8_t *packed) {
    for (int y = 0; y < FRAME_HEIGHT; y++) {
        const uint8_t *row = packed + y * (FRAME_WIDTH / 2);
        for (int x = 0; x < FRAME_WIDTH; x++) {
            const uint8_t byte = row[x / 2];
            const uint8_t index = (x % 2 == 0) ? (byte >> 4) : (byte & 0x0f);
            display.drawPixel(x, y, index);
        }
    }
}

// What to actually do about a given failure cause — paired with the cause
// itself (M7's headline) as the local screen's second line.
static String actionHint(const String &cause) {
    if (cause.startsWith("WiFi")) return "check WIFI_SSID/WIFI_PASS in config.h";
    if (cause.startsWith("can't reach relay")) return "start the relay: node bin/vt.js serve";
    if (cause == "board token rejected") return "set BOARD_TOKEN from vt token board --rotate";
    return "check the relay log";
}

// Local, dumb fallback screens for when the relay can't be reached at all —
// drawn with Inkplate's built-in font at a size chosen to roughly match the
// wall's Spleen rendering, black background/white text (finding M7), not
// the relay's own Spleen rendering. Both lines are built to stay within the
// panel's ~600px width at this text size. `elapsedMinutes` is 0 (omitted)
// on the very first failure, when there's nothing to report yet.
static void drawLocalMessage(const String &cause, uint32_t elapsedMinutes) {
    String line2 = actionHint(cause);
    if (elapsedMinutes > 0) {
        line2 = String(elapsedMinutes) + " min - " + line2;
    }

    display.clearDisplay();
    display.setTextColor(INKPLATE_WHITE, INKPLATE_BLACK);
    display.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT, INKPLATE_BLACK);
    display.setTextSize(2);
    display.setCursor(20, 190);
    display.println(cause);
    display.setCursor(20, 220);
    display.println(line2);
    display.display();
}

void setup() {
    const uint32_t wakeStart = millis();
    Serial.begin(115200);
    display.begin();

    if (isColdStart()) {
        Serial.println("videotext: cold start etag=empty page=100 failures=0");
    }
    const char *reason = wakeReason();

    // Read before WiFi.begin(): WiFi TX current draw sags the battery
    // reading toward the low-battery threshold (finding m23).
    const float battery = display.readBattery();

    const uint32_t wifiStart = millis();
    connectWifi();
    const uint32_t wifiMs = millis() - wifiStart;

    String host = RELAY_HOST;
    String cause;
    bool success = false;
    int httpStatus = 0; // 0 = never attempted (WiFi never joined)
    uint32_t fetchMs = 0;
    uint32_t readMs = 0;
    uint32_t unpackMs = 0;
    uint32_t displayMs = 0;
    uint8_t *buf = nullptr;

    if (WiFi.status() != WL_CONNECTED) {
        cause = String("WiFi ") + WIFI_SSID + " not joined";
    } else {
        host = resolveHost();
        char url[160];
        snprintf(url, sizeof(url), "http://%s:%d/frame?page=%d&reason=%s&battery=%.2f&rssi=%d&fw=%s", host.c_str(),
                 RELAY_PORT, lastPage, reason, battery, WiFi.RSSI(), FW_VERSION);

        HTTPClient http;
        http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
        http.setTimeout(HTTP_READ_TIMEOUT_MS);
        const char *headerKeys[] = {"ETag", "X-Page"};

        const uint32_t fetchStart = millis();
        if (http.begin(url)) {
            // Must be called before GET(): without it, these headers read
            // back empty even on a successful response.
            http.collectHeaders(headerKeys, 2);
            http.addHeader("Authorization", String("Bearer ") + BOARD_TOKEN);
            if (lastEtag[0] != '\0') http.addHeader("If-None-Match", lastEtag);

            httpStatus = http.GET();
            fetchMs = millis() - fetchStart;

            if (httpStatus < 0) {
                // A negative code is HTTPClient reporting a connect/transport
                // failure, not a real HTTP response (finding M6).
                cause = String("can't reach relay ") + host + ":" + String(RELAY_PORT);
            } else if (httpStatus == 401) {
                cause = "board token rejected";
            } else if (httpStatus == 304) {
                success = true;
            } else if (httpStatus == 200) {
                if (http.getSize() != FRAME_BYTES) {
                    cause = "bad response from relay";
                } else {
                    buf = (uint8_t *)ps_malloc(FRAME_BYTES);
                    if (buf == nullptr) {
                        cause = "bad response from relay";
                    } else {
                        const uint32_t readStart = millis();
                        const int got = http.getStream().readBytes(buf, FRAME_BYTES);
                        readMs = millis() - readStart;
                        if (got != FRAME_BYTES) {
                            cause = "bad response from relay";
                            free(buf);
                            buf = nullptr;
                        } else {
                            success = true;
                            everDrawnRealFrame = true;
                        }
                    }
                }
            } else {
                cause = String("relay error ") + String(httpStatus);
            }

            if (success) {
                const String newEtag = http.header("ETag");
                // Longer than the fixed buffer, or simply absent: clear
                // lastEtag rather than keep the previous (now possibly
                // stale) value, so the next poll sends no If-None-Match and
                // forces an honest compare instead of a silently wrong
                // match (finding m5).
                if (newEtag.length() > 0 && newEtag.length() <= 64) {
                    newEtag.toCharArray(lastEtag, sizeof(lastEtag));
                } else {
                    lastEtag[0] = '\0';
                }
                const String newPage = http.header("X-Page");
                if (newPage.length() > 0) lastPage = newPage.toInt();
            }
            // M24: end the HTTP connection and drop WiFi (below) before any
            // unpacking/drawing/display() work, rather than holding the
            // radio up through the ~12.5s display refresh.
            http.end();
        } else {
            fetchMs = millis() - fetchStart;
            cause = String("can't reach relay ") + host + ":" + String(RELAY_PORT);
        }
    }

    WiFi.mode(WIFI_OFF);

    if (buf != nullptr) {
        const uint32_t unpackStart = millis();
        drawFrame(buf);
        unpackMs = millis() - unpackStart;
        free(buf);
        const uint32_t displayStart = millis();
        display.display();
        displayMs = millis() - displayStart;
    }

    uint32_t sleepSeconds = POLL_SECONDS;
    if (success) {
        consecutiveFailures = 0;
        offlineNoticeShown = false;
        failureElapsedSeconds = 0;
    } else {
        consecutiveFailures++;
        Serial.printf("videotext: failure #%d: %s\n", consecutiveFailures, cause.c_str());

        const uint32_t elapsedMinutes = failureElapsedSeconds / 60;
        if (!everDrawnRealFrame && consecutiveFailures == 1) {
            // Never say "offline" here (finding M7): the board has never
            // shown a real frame, so there's nothing to have gone offline
            // from yet — just report the cause.
            drawLocalMessage(cause, 0);
        } else if (consecutiveFailures == 3 && !offlineNoticeShown) {
            drawLocalMessage(cause, elapsedMinutes);
            offlineNoticeShown = true;
            lastEtag[0] = '\0'; // force an unconditional redraw once it recovers
        }
        // Any other failure count: log only, keep the current screen.

        // B7: back off exponentially while failing, capped, so a dead relay
        // doesn't wake the board (and burn WiFi joins) every POLL_SECONDS
        // all night.
        const uint32_t backoffExp = consecutiveFailures > 10 ? 10 : (uint32_t)consecutiveFailures;
        const uint64_t backoff = (uint64_t)POLL_SECONDS << backoffExp;
        sleepSeconds = (backoff == 0 || backoff > MAX_BACKOFF_SECONDS) ? MAX_BACKOFF_SECONDS : (uint32_t)backoff;
        failureElapsedSeconds += sleepSeconds;
    }

    const uint32_t totalMs = millis() - wakeStart;
    Serial.printf("videotext: reason=%s wifi_ms=%u fetch_ms=%u read_ms=%u unpack_ms=%u display_ms=%u total_ms=%u "
                  "status=%d page=%d etag=%s sleep_s=%u\n",
                  reason, wifiMs, fetchMs, readMs, unpackMs, displayMs, totalMs, httpStatus, lastPage,
                  lastEtag[0] != '\0' ? lastEtag : "empty", sleepSeconds);

    esp_sleep_enable_timer_wakeup((uint64_t)sleepSeconds * 1000000ULL);
    esp_sleep_enable_ext0_wakeup(GPIO_NUM_36, 0);
    esp_deep_sleep_start();
}

void loop() {
}
