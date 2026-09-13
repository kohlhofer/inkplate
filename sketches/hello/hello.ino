// Hello world for Inkplate 6COLOR: one bar per panel colour, labelled.

#ifndef ARDUINO_INKPLATECOLOR
#error "Select the Soldered Inkplate 6COLOR board."
#endif

#include "Inkplate.h"

Inkplate display;

struct Swatch {
    uint8_t color;
    const char *name;
};

const Swatch swatches[] = {
    {INKPLATE_BLACK, "BLACK"},   {INKPLATE_WHITE, "WHITE"},   {INKPLATE_GREEN, "GREEN"},
    {INKPLATE_BLUE, "BLUE"},     {INKPLATE_RED, "RED"},       {INKPLATE_YELLOW, "YELLOW"},
    {INKPLATE_ORANGE, "ORANGE"},
};
const int swatchCount = sizeof(swatches) / sizeof(swatches[0]);

void setup() {
    Serial.begin(115200);
    display.begin();
    display.clearDisplay();

    const int headerHeight = 80;
    display.setTextColor(INKPLATE_BLACK);
    display.setTextSize(4);
    display.setCursor(20, 24);
    display.print("Hello, Inkplate");

    const int barHeight = (display.height() - headerHeight) / swatchCount;
    for (int i = 0; i < swatchCount; i++) {
        const int y = headerHeight + i * barHeight;
        display.fillRect(0, y, display.width(), barHeight, swatches[i].color);
        const bool dark = swatches[i].color == INKPLATE_BLACK || swatches[i].color == INKPLATE_BLUE;
        display.setTextColor(dark ? INKPLATE_WHITE : INKPLATE_BLACK);
        display.setTextSize(3);
        display.setCursor(20, y + (barHeight - 24) / 2);
        display.print(swatches[i].name);
    }
    display.drawRect(0, headerHeight, display.width(), display.height() - headerHeight, INKPLATE_BLACK);

    display.display();
    Serial.println("hello: display refreshed");
}

void loop() {
}
