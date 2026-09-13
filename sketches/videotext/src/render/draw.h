// Pixel primitives over the palette-index framebuffer: rectangles, font
// glyphs, and the procedural box/block/sextant characters.
#pragma once

#include <cstdint>

#include "text.h"
#include "theme.h"

namespace vt {

// Both clip to the panel, so callers may pass rectangles that overhang it.
void setPixel(std::uint8_t* fb, int x, int y, std::uint8_t color);
void fillRect(std::uint8_t* fb, int x, int y, int w, int h, std::uint8_t color);

// Sets only the glyph's foreground pixels; the caller has already painted
// the background. Returns false, drawing nothing, for a codepoint the font
// lacks, so a missing glyph shows as a blank cell.
bool drawGlyph(std::uint8_t* fb, int x, int y, char32_t codepoint, std::uint8_t color, bool doubleHeight);

// One cell per codepoint, font glyphs only (no procedural characters).
void drawText(std::uint8_t* fb, int x, int y, const Codepoints& text, std::uint8_t color, bool doubleHeight = false);

// Titles and the header's left text: accent colour, or fg on an accent band
// reaching 4 px past the text on each side.
void drawAccentText(std::uint8_t* fb, int x, int y, const Codepoints& text, const Theme& theme, bool doubleHeight = false);

// The ranges drawProcedural owns: sextants, block elements, box drawing.
bool isProceduralCodepoint(char32_t codepoint);

// Returns false, drawing nothing, for codepoints outside its scope (including
// the dashed, double, rounded and diagonal box-drawing variants).
bool drawProcedural(std::uint8_t* fb, int x, int y, char32_t codepoint, std::uint8_t color);

}  // namespace vt
