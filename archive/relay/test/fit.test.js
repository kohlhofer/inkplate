import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFit, resample } from "../src/image/fit.js";

test("contain-fit scales a wide image down to the box width", () => {
    const { width, height } = computeFit(1000, 500, 300, 336);
    assert.equal(width, 300);
    assert.equal(height, 150);
});

test("contain-fit scales a tall image down to the box height", () => {
    const { width, height } = computeFit(500, 1000, 300, 336);
    assert.equal(height, 336);
    assert.ok(width <= 300);
});

test("contain-fit upscales a small image to fill the box", () => {
    const { width, height } = computeFit(10, 10, 100, 100);
    assert.equal(width, 100);
    assert.equal(height, 100);
});

test("resample preserves a solid colour", () => {
    const src = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
        src[i * 4] = 200;
        src[i * 4 + 1] = 10;
        src[i * 4 + 2] = 20;
        src[i * 4 + 3] = 255;
    }
    const out = resample(src, 4, 4, 8, 8);
    assert.equal(out.length, 8 * 8 * 4);
    assert.equal(out[0], 200);
    assert.equal(out[1], 10);
    assert.equal(out[2], 20);
});
