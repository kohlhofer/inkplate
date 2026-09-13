// Hardware probe: prints what the board reports over serial. Does not refresh the panel.

#ifndef ARDUINO_INKPLATECOLOR
#error "Select the Soldered Inkplate 6COLOR board."
#endif

#include "Inkplate.h"
#include "WiFi.h"

Inkplate display;

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("probe: start");

    Serial.printf("chip: %s rev %d, %d cores, flash %u MB\n", ESP.getChipModel(), ESP.getChipRevision(),
                  ESP.getChipCores(), ESP.getFlashChipSize() / (1024 * 1024));
    Serial.printf("psram: %u KB total, %u KB free\n", ESP.getPsramSize() / 1024, ESP.getFreePsram() / 1024);
    Serial.printf("heap: %u KB free\n", ESP.getFreeHeap() / 1024);

    display.begin();

    Serial.print("i2c:");
    for (uint8_t addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            Serial.printf(" 0x%02X", addr);
        }
    }
    Serial.println();

    display.rtc.getRtcData();
    Serial.printf("rtc: isSet=%d %04d-%02d-%02d %02d:%02d:%02d\n", display.rtc.isSet(), display.rtc.getYear(),
                  display.rtc.getMonth(), display.rtc.getDay(), display.rtc.getHour(), display.rtc.getMinute(),
                  display.rtc.getSecond());

    Serial.printf("battery: %.3f V\n", display.readBattery());
    Serial.printf("sd: %s\n", display.sdCardInit() ? "card mounted" : "no card / init failed");

    // display.touchpad is not probed: InkplateLibrary 11.1.5 never calls touchpad.begin() for 6COLOR,
    // so touchpad.read() dereferences a null Inkplate pointer and panics.

    Serial.printf("wake button GPIO36: %d\n", digitalRead(36));

    WiFi.mode(WIFI_STA);
    const int networks = WiFi.scanNetworks();
    Serial.printf("wifi: %d networks visible, MAC %s\n", networks, WiFi.macAddress().c_str());

    Serial.println("probe: done");
}

void loop() {
}
