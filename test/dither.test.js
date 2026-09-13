import { test } from "node:test";
import assert from "node:assert/strict";
import { ditherFloydSteinberg } from "../src/image/dither.js";
import { PALETTE } from "../src/render/palette.js";

test("a solid-colour image dithers to a single, exact palette index", () => {
    const width = 6;
    const height = 6;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const [r, g, b] = PALETTE[4].rgb; // red
    for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = 255;
    }
    const out = ditherFloydSteinberg(rgba, width, height);
    assert.equal(out.length, width * height);
    assert.ok([...out].every((v) => v === 4));
});

test("output is deterministic for identical input", () => {
    const width = 8;
    const height = 8;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) % 256;
    assert.deepEqual(ditherFloydSteinberg(rgba, width, height), ditherFloydSteinberg(rgba, width, height));
});

test("every output value is a valid palette index", () => {
    const width = 5;
    const height = 5;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = Math.floor(Math.random() * 256);
    const out = ditherFloydSteinberg(rgba, width, height);
    for (const v of out) assert.ok(v >= 0 && v < PALETTE.length);
});
