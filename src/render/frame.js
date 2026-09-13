import { PANEL_WIDTH, PANEL_HEIGHT, createFramebuffer, fillRect, packTo4bpp } from "./grid.js";

// Inkplate palette order (see CLAUDE.md): 0 black, 1 white, 2 green, 3 blue,
// 4 red, 5 yellow, 6 orange. 448/7 divides exactly, so the bars are even.
const BAR_COLORS = [0, 1, 2, 3, 4, 5, 6];
const BAR_HEIGHT = PANEL_HEIGHT / BAR_COLORS.length;

// Deterministic, store-free pattern used as the /frame payload before the
// real render pipeline exists, and as the documented legibility fixture.
export function testcard() {
    const fb = createFramebuffer();
    for (let i = 0; i < BAR_COLORS.length; i++) {
        fillRect(fb, 0, i * BAR_HEIGHT, PANEL_WIDTH, BAR_HEIGHT, BAR_COLORS[i]);
    }
    return packTo4bpp(fb);
}
