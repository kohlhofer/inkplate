import { test } from "node:test";
import assert from "node:assert/strict";
import { PANEL_WIDTH, PANEL_HEIGHT, FRAME_BYTES, createFramebuffer, setPixel, packTo4bpp } from "../src/render/grid.js";

test("createFramebuffer is one palette-index byte per pixel", () => {
    const fb = createFramebuffer();
    assert.equal(fb.length, PANEL_WIDTH * PANEL_HEIGHT);
});

test("packTo4bpp produces exactly 134400 bytes", () => {
    const fb = createFramebuffer();
    const packed = packTo4bpp(fb);
    assert.equal(packed.length, FRAME_BYTES);
    assert.equal(FRAME_BYTES, 134400);
});

test("packTo4bpp: high nibble is even x, low nibble is odd x", () => {
    const fb = createFramebuffer();
    setPixel(fb, 0, 0, 0x4); // even x
    setPixel(fb, 1, 0, 0xa); // odd x
    const packed = packTo4bpp(fb);
    assert.equal(packed[0], (0x4 << 4) | 0xa);
});

test("packTo4bpp byte offset matches y*300 + floor(x/2)", () => {
    const fb = createFramebuffer();
    setPixel(fb, 10, 3, 0x5);
    const packed = packTo4bpp(fb);
    const offset = 3 * 300 + Math.floor(10 / 2);
    assert.equal(packed[offset] >> 4, 0x5);
});

test("setPixel ignores out-of-bounds writes", () => {
    const fb = createFramebuffer();
    assert.doesNotThrow(() => setPixel(fb, -1, -1, 1));
    assert.doesNotThrow(() => setPixel(fb, PANEL_WIDTH, PANEL_HEIGHT, 1));
});
