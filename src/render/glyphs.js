import { GLYPHS, CELL_WIDTH, CELL_HEIGHT } from "../../font/font-data.js";
import { setPixel } from "./grid.js";

// Draws one glyph's foreground pixels at (originX, originY); the caller is
// expected to have already filled the background (cells are opaque blocks,
// glyphs only set foreground bits). Unmapped codepoints draw nothing, so a
// missing glyph shows as blank background rather than a crash or a box.
export function drawGlyph(fb, originX, originY, codepoint, fgIndex, { doubleHeight = false } = {}) {
    const rows = GLYPHS[codepoint];
    if (!rows) return false;
    for (let ry = 0; ry < CELL_HEIGHT; ry++) {
        const bits = rows[ry];
        if (bits === 0) continue;
        const outRows = doubleHeight ? [ry * 2, ry * 2 + 1] : [ry];
        for (let rx = 0; rx < CELL_WIDTH; rx++) {
            if (!((bits >> (CELL_WIDTH - 1 - rx)) & 1)) continue;
            for (const oy of outRows) {
                setPixel(fb, originX + rx, originY + oy, fgIndex);
            }
        }
    }
    return true;
}

// Draws a single-colour run of text left to right, one cell per codepoint.
// Colour spans and wrapping are markup.js/wrap.js concerns; this just blits.
export function drawText(fb, originX, originY, text, fgIndex, options = {}) {
    let x = originX;
    for (const ch of text) {
        drawGlyph(fb, x, originY, ch.codePointAt(0), fgIndex, options);
        x += CELL_WIDTH;
    }
}
