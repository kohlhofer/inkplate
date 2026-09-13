import { test } from "node:test";
import assert from "node:assert/strict";
import { createFramebuffer, PANEL_WIDTH } from "../src/render/grid.js";
import { drawGlyph, drawText } from "../src/render/glyphs.js";
import { CELL_WIDTH, CELL_HEIGHT } from "../font/font-data.js";

function countFg(fb, fgIndex) {
    let n = 0;
    for (const v of fb) if (v === fgIndex) n++;
    return n;
}

test("drawGlyph only sets foreground bits, leaving background untouched", () => {
    const fb = createFramebuffer();
    fb.fill(1); // pre-filled background
    drawGlyph(fb, 0, 0, "A".codePointAt(0), 0);
    assert.ok(countFg(fb, 0) > 0);
    assert.ok(countFg(fb, 1) > 0);
});

test("drawGlyph with doubleHeight stretches each source row to 2 output rows", () => {
    const fb = createFramebuffer();
    const normal = createFramebuffer();
    drawGlyph(fb, 0, 0, "A".codePointAt(0), 2, { doubleHeight: true });
    drawGlyph(normal, 0, 0, "A".codePointAt(0), 2);
    assert.ok(countFg(fb, 2) >= countFg(normal, 2) * 1.5);
});

test("drawGlyph on an unmapped codepoint draws nothing", () => {
    const fb = createFramebuffer();
    const drew = drawGlyph(fb, 0, 0, 0x10ffff, 3);
    assert.equal(drew, false);
    assert.equal(countFg(fb, 3), 0);
});

test("drawText advances one cell width per character", () => {
    const fb = createFramebuffer();
    drawText(fb, 0, 0, "AB", 4);
    // 'B' should have drawn some pixel at x >= CELL_WIDTH
    let sawSecondCell = false;
    for (let y = 0; y < CELL_HEIGHT; y++) {
        for (let x = CELL_WIDTH; x < CELL_WIDTH * 2; x++) {
            if (fb[y * PANEL_WIDTH + x] === 4) sawSecondCell = true;
        }
    }
    assert.ok(sawSecondCell);
});
