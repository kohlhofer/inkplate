#include <algorithm>

#include "draw.h"
#include "font_data.h"

namespace vt {

void setPixel(std::uint8_t* fb, int x, int y, std::uint8_t color) {
    if (x < 0 || x >= PANEL_WIDTH || y < 0 || y >= PANEL_HEIGHT) return;
    fb[y * PANEL_WIDTH + x] = color & 0x0F;
}

void fillRect(std::uint8_t* fb, int x, int y, int w, int h, std::uint8_t color) {
    const int x0 = std::max(0, x);
    const int y0 = std::max(0, y);
    const int x1 = std::min(PANEL_WIDTH, x + w);
    const int y1 = std::min(PANEL_HEIGHT, y + h);
    if (x1 <= x0) return;
    for (int yy = y0; yy < y1; yy++) {
        std::fill(fb + yy * PANEL_WIDTH + x0, fb + yy * PANEL_WIDTH + x1, static_cast<std::uint8_t>(color & 0x0F));
    }
}

bool drawGlyph(std::uint8_t* fb, int x, int y, char32_t codepoint, std::uint8_t color, bool doubleHeight) {
    const std::uint16_t* rows = font::glyphRows(codepoint);
    if (rows == nullptr) return false;
    for (int ry = 0; ry < CELL_HEIGHT; ry++) {
        const std::uint16_t bits = rows[ry];
        if (bits == 0) continue;
        for (int rx = 0; rx < CELL_WIDTH; rx++) {
            if (!((bits >> (CELL_WIDTH - 1 - rx)) & 1)) continue;
            if (doubleHeight) {
                setPixel(fb, x + rx, y + ry * 2, color);
                setPixel(fb, x + rx, y + ry * 2 + 1, color);
            } else {
                setPixel(fb, x + rx, y + ry, color);
            }
        }
    }
    return true;
}

void drawText(std::uint8_t* fb, int x, int y, const Codepoints& text, std::uint8_t color, bool doubleHeight) {
    for (char32_t c : text) {
        drawGlyph(fb, x, y, c, color, doubleHeight);
        x += CELL_WIDTH;
    }
}

void drawAccentText(std::uint8_t* fb, int x, int y, const Codepoints& text, const Theme& theme, bool doubleHeight) {
    if (!theme.hasAccentBand) {
        drawText(fb, x, y, text, theme.accent, doubleHeight);
        return;
    }
    const int width = static_cast<int>(text.size()) * CELL_WIDTH;
    const int height = doubleHeight ? 2 * CELL_HEIGHT : CELL_HEIGHT;
    fillRect(fb, x - 4, y, width + 8, height, theme.accentBand.bg);
    drawText(fb, x, y, text, theme.accentBand.fg, doubleHeight);
}

}  // namespace vt
