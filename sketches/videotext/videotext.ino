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
#define HTTP_TIMEOUT_MS 10000
#define MIN_POLL_SECONDS 30
#define MAX_POLL_SECONDS 3600
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

// Local, dumb fallback screens for when the relay can't be reached at all —
// drawn with Inkplate's built-in font, not the relay's Spleen rendering.
static void drawLocalMessage(const char *line1, const char *line2) {
    display.clearDisplay();
    display.setTextColor(INKPLATE_BLACK);
    display.setTextSize(2);
    display.setCursor(20, 200);
    display.println(line1);
    display.setCursor(20, 230);
    display.println(line2);
    display.display();
}

void setup() {
    const uint32_t wakeStart = millis();
    Serial.begin(115200);
    display.begin();

    const char *reason = wakeReason();
    if (lastEtag[0] == '\0' && lastPage == 100 && consecutiveFailures == 0 && !everDrawnRealFrame && !offlineNoticeShown) {
        Serial.println("videotext: cold start etag=empty page=100 failures=0");
    }

    const uint32_t wifiStart = millis();
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < WIFI_TIMEOUT_MS) {
        delay(200);
    }
    const uint32_t wifiMs = millis() - wifiStart;

    String host = RELAY_HOST;
    String cause = "";
    bool success = false;
    int httpStatus = -1;
    int pollHintSeconds = -1;
    uint32_t fetchMs = 0;
    uint32_t unpackMs = 0;
    uint32_t displayMs = 0;

    if (WiFi.status() != WL_CONNECTED) {
        cause = "WiFi not joined";
    } else {
        host = resolveHost();
        char url[160];
        snprintf(url, sizeof(url), "http://%s:%d/frame?page=%d&reason=%s&battery=%.2f&rssi=%d&fw=%s", host.c_str(),
                 RELAY_PORT, lastPage, reason, display.readBattery(), WiFi.RSSI(), FW_VERSION);

        HTTPClient http;
        http.setConnectTimeout(HTTP_TIMEOUT_MS);
        http.setTimeout(HTTP_TIMEOUT_MS);
        const char *headerKeys[] = {"ETag", "X-Page", "X-Poll"};

        const uint32_t fetchStart = millis();
        if (http.begin(url)) {
            // Must be called before GET(): without it, these headers read
            // back empty even on a successful response.
            http.collectHeaders(headerKeys, 3);
            http.addHeader("Authorization", String("Bearer ") + BOARD_TOKEN);
            if (lastEtag[0] != '\0') http.addHeader("If-None-Match", lastEtag);

            httpStatus = http.GET();
            fetchMs = millis() - fetchStart;

            if (httpStatus == 401) {
                cause = "token rejected";
            } else if (httpStatus == 304) {
                success = true;
            } else if (httpStatus == 200) {
                if (http.getSize() != FRAME_BYTES) {
                    cause = "bad response from relay";
                } else {
                    const uint32_t unpackStart = millis();
                    uint8_t *buf = (uint8_t *)ps_malloc(FRAME_BYTES);
                    if (buf == nullptr) {
                        cause = "bad response from relay";
                    } else {
                        const int got = http.getStream().readBytes(buf, FRAME_BYTES);
                        if (got != FRAME_BYTES) {
                            cause = "bad response from relay";
                        } else {
                            drawFrame(buf);
                            unpackMs = millis() - unpackStart;
                            const uint32_t displayStart = millis();
                            display.display();
                            displayMs = millis() - displayStart;
                            success = true;
                            everDrawnRealFrame = true;
                        }
                        free(buf);
                    }
                }
            } else {
                cause = String("relay ") + host + ":" + String(RELAY_PORT) + " unreachable";
            }

            if (success) {
                const String newEtag = http.header("ETag");
                // Longer than the fixed buffer: draw the frame anyway (already
                // done above), just skip storing it so next poll won't send a
                // stale If-None-Match and mask a real change with a 304.
                if (newEtag.length() > 0 && newEtag.length() <= 64) {
                    newEtag.toCharArray(lastEtag, sizeof(lastEtag));
                }
                const String newPage = http.header("X-Page");
                if (newPage.length() > 0) lastPage = newPage.toInt();
                const String poll = http.header("X-Poll");
                if (poll.length() > 0) pollHintSeconds = poll.toInt();
            }
            http.end();
        } else {
            fetchMs = millis() - fetchStart;
            cause = String("relay ") + host + ":" + String(RELAY_PORT) + " unreachable";
        }
    }

    if (success) {
        consecutiveFailures = 0;
        offlineNoticeShown = false;
    } else {
        consecutiveFailures++;
        Serial.printf("videotext: failure #%d: %s\n", consecutiveFailures, cause.c_str());
        if (!everDrawnRealFrame && consecutiveFailures == 1) {
            char line2[96];
            snprintf(line2, sizeof(line2), "%s:%d - %s", host.c_str(), RELAY_PORT, cause.c_str());
            drawLocalMessage("waiting for relay", line2);
        } else if (consecutiveFailures == 3 && !offlineNoticeShown) {
            char line2[96];
            snprintf(line2, sizeof(line2), "%s - %s:%d", cause.c_str(), host.c_str(), RELAY_PORT);
            drawLocalMessage("relay offline since 3 wakes", line2);
            offlineNoticeShown = true;
            lastEtag[0] = '\0'; // force an unconditional redraw once it recovers
        }
        // Any other failure count: log only, keep the current screen.
    }

    const uint32_t totalMs = millis() - wakeStart;
    Serial.printf("videotext: reason=%s wifi_ms=%u fetch_ms=%u unpack_ms=%u display_ms=%u total_ms=%u status=%d "
                  "page=%d etag=%s\n",
                  reason, wifiMs, fetchMs, unpackMs, displayMs, totalMs, httpStatus, lastPage,
                  lastEtag[0] != '\0' ? lastEtag : "empty");

    WiFi.mode(WIFI_OFF);
    int sleepSeconds = (pollHintSeconds >= MIN_POLL_SECONDS && pollHintSeconds <= MAX_POLL_SECONDS) ? pollHintSeconds
                                                                                                      : POLL_SECONDS;
    esp_sleep_enable_timer_wakeup((uint64_t)sleepSeconds * 1000000ULL);
    esp_sleep_enable_ext0_wakeup(GPIO_NUM_36, 0);
    esp_deep_sleep_start();
}

void loop() {
}
