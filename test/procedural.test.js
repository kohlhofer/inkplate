import { test } from "node:test";
import assert from "node:assert/strict";
import { createFramebuffer, PANEL_WIDTH } from "../src/render/grid.js";
import { drawProcedural, SEXTANT_MASKS, SEXTANT_BASE } from "../src/render/procedural.js";

function pixel(fb, x, y) {
    return fb[y * PANEL_WIDTH + x];
}

test("sextant table has exactly 60 entries spanning U+1FB00 to U+1FB3B", () => {
    const codepoints = Object.keys(SEXTANT_MASKS)
        .map(Number)
        .sort((a, b) => a - b);
    assert.equal(codepoints.length, 60);
    assert.equal(codepoints[0], SEXTANT_BASE);
    assert.equal(codepoints[codepoints.length - 1], 0x1fb3b);
});

test("sextant masks are 1..62 excluding 21 and 42, each used exactly once", () => {
    const masks = Object.values(SEXTANT_MASKS).sort((a, b) => a - b);
    const expected = [];
    for (let m = 1; m <= 62; m++) {
        if (m !== 21 && m !== 42) expected.push(m);
    }
    assert.deepEqual(masks, expected);
});

test("mask 21 (left column) is not in range, matching U+258C left half block", () => {
    assert.equal(Object.values(SEXTANT_MASKS).includes(21), false);
    assert.equal(Object.values(SEXTANT_MASKS).includes(42), false);
});

test("drawProcedural draws a sextant's top-left cell only for mask 1", () => {
    const codepoint = Object.keys(SEXTANT_MASKS).find((cp) => SEXTANT_MASKS[cp] === 1);
    const fb = createFramebuffer();
    const drew = drawProcedural(fb, 0, 0, Number(codepoint), 5);
    assert.equal(drew, true);
    assert.equal(pixel(fb, 0, 0), 5); // top-left sub-cell
    assert.equal(pixel(fb, 11, 0), 0); // top-right sub-cell untouched
    assert.equal(pixel(fb, 0, 23), 0); // bottom-left sub-cell untouched
});

test("light horizontal box char (U+2500) draws a thin band through the vertical middle", () => {
    const fb = createFramebuffer();
    drawProcedural(fb, 0, 0, 0x2500, 7);
    assert.equal(pixel(fb, 6, 11), 7);
    assert.equal(pixel(fb, 6, 0), 0);
    assert.equal(pixel(fb, 6, 23), 0);
});

test("heavy vertical box char (U+2503) is thicker than light vertical (U+2502)", () => {
    const countFg = (fb) => {
        let n = 0;
        for (const v of fb) if (v === 7) n++;
        return n;
    };
    const light = createFramebuffer();
    const heavy = createFramebuffer();
    drawProcedural(light, 0, 0, 0x2502, 7);
    drawProcedural(heavy, 0, 0, 0x2503, 7);
    assert.ok(countFg(heavy) > countFg(light));
});

test("upper half block (U+2580) fills only the top half of the cell", () => {
    const fb = createFramebuffer();
    drawProcedural(fb, 0, 0, 0x2580, 2);
    assert.equal(pixel(fb, 6, 0), 2);
    assert.equal(pixel(fb, 6, 11), 2);
    assert.equal(pixel(fb, 6, 12), 0);
    assert.equal(pixel(fb, 6, 23), 0);
});

test("quadrant upper-left (U+2598) fills only that quadrant", () => {
    const fb = createFramebuffer();
    drawProcedural(fb, 0, 0, 0x2598, 3);
    assert.equal(pixel(fb, 0, 0), 3);
    assert.equal(pixel(fb, 11, 0), 0);
    assert.equal(pixel(fb, 0, 23), 0);
    assert.equal(pixel(fb, 11, 23), 0);
});

test("out-of-scope codepoints (e.g. a plain letter) are not handled", () => {
    const fb = createFramebuffer();
    const drew = drawProcedural(fb, 0, 0, "A".codePointAt(0), 1);
    assert.equal(drew, false);
});
