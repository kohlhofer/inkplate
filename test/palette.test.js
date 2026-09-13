import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE, nearestIndex } from "../src/render/palette.js";

test("palette has exactly 7 colours in Inkplate index order", () => {
    assert.equal(PALETTE.length, 7);
    assert.deepEqual(
        PALETTE.map((c) => c.index),
        [0, 1, 2, 3, 4, 5, 6],
    );
});

test("nearestIndex returns an exact palette entry's own index", () => {
    for (const { index, rgb } of PALETTE) {
        assert.equal(nearestIndex(...rgb), index);
    }
});

test("nearestIndex picks white for near-white input", () => {
    assert.equal(nearestIndex(250, 250, 250), 1);
});
