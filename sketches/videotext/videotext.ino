// Videotext board firmware: wake, fetch a rendered frame from the relay,
// draw it, deep sleep. All layout/content decisions live in the relay;
// the board is deliberately dumb. See CLAUDE.md's videotext section.

#ifndef ARDUINO_INKPLATECOLOR
#error "Select the Soldered Inkplate 6COLOR board."
#endif

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

Inkplate display;

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

// Unpacks row-major 4bpp (2px/byte, high nibble = even x) straight to the
// panel via drawPixel, which handles the rotation-0 x/y flip inside
// DMemory4Bit for us; see CLAUDE.md's hardware gotchas.
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

void setup() {
    Serial.begin(115200);
    display.begin();

    const char *reason = wakeReason();
    Serial.printf("videotext: wake reason=%s\n", reason);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    const uint32_t wifiStart = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < WIFI_TIMEOUT_MS) {
        delay(200);
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("videotext: WiFi not joined");
    } else {
        char url[96];
        snprintf(url, sizeof(url), "http://%s:%d/frame?page=100&reason=%s", RELAY_HOST, RELAY_PORT, reason);

        HTTPClient http;
        http.setConnectTimeout(HTTP_TIMEOUT_MS);
        http.setTimeout(HTTP_TIMEOUT_MS);
        if (http.begin(url)) {
            http.addHeader("Authorization", String("Bearer ") + BOARD_TOKEN);
            const int status = http.GET();
            if (status == 200 && http.getSize() == FRAME_BYTES) {
                uint8_t *buf = (uint8_t *)ps_malloc(FRAME_BYTES);
                if (buf != nullptr) {
                    const int got = http.getStream().readBytes(buf, FRAME_BYTES);
                    if (got == FRAME_BYTES) {
                        drawFrame(buf);
                        display.display();
                        Serial.println("videotext: frame drawn");
                    } else {
                        Serial.printf("videotext: bad response from relay (read %d of %d bytes)\n", got,
                                      FRAME_BYTES);
                    }
                    free(buf);
                }
            } else {
                Serial.printf("videotext: relay %s:%d unreachable (status %d)\n", RELAY_HOST, RELAY_PORT, status);
            }
            http.end();
        }
    }

    WiFi.mode(WIFI_OFF);
    esp_sleep_enable_timer_wakeup((uint64_t)POLL_SECONDS * 1000000ULL);
    esp_sleep_enable_ext0_wakeup(GPIO_NUM_36, 0);
    esp_deep_sleep_start();
}

void loop() {
}
