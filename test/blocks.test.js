import { test } from "node:test";
import assert from "node:assert/strict";
import { quantizeBlocks } from "../src/image/blocks.js";
import { PALETTE } from "../src/render/palette.js";
import { CELL_WIDTH, CELL_HEIGHT } from "../src/render/grid.js";

function fillRgba(width, height, colorAt) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b] = colorAt(x, y);
            const off = (y * width + x) * 4;
            rgba[off] = r;
            rgba[off + 1] = g;
            rgba[off + 2] = b;
            rgba[off + 3] = 255;
        }
    }
    return rgba;
}

test("a solid-colour cell quantizes to a single palette index", () => {
    const [r, g, b] = PALETTE[2].rgb; // green
    const rgba = fillRgba(CELL_WIDTH, CELL_HEIGHT, () => [r, g, b]);
    const out = quantizeBlocks(rgba, CELL_WIDTH, CELL_HEIGHT);
    assert.ok([...out].every((v) => v === 2));
});

test("a cell uses at most 2 distinct palette indices, even with varied input", () => {
    const rgba = fillRgba(CELL_WIDTH, CELL_HEIGHT, (x, y) => [(x * 40) % 256, (y * 20) % 256, (x + y) % 256]);
    const out = quantizeBlocks(rgba, CELL_WIDTH, CELL_HEIGHT);
    assert.ok(new Set(out).size <= 2);
});

test("output is one palette index per pixel, matching the input dimensions", () => {
    const width = CELL_WIDTH * 3;
    const height = CELL_HEIGHT * 2;
    const rgba = fillRgba(width, height, () => [10, 10, 10]);
    const out = quantizeBlocks(rgba, width, height);
    assert.equal(out.length, width * height);
});

test("handles dimensions that aren't an exact multiple of the cell size", () => {
    const width = CELL_WIDTH + 3;
    const height = CELL_HEIGHT + 5;
    const rgba = fillRgba(width, height, () => [50, 60, 70]);
    assert.doesNotThrow(() => quantizeBlocks(rgba, width, height));
});
