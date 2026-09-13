import { test } from "node:test";
import assert from "node:assert/strict";
import { testcard } from "../src/render/frame.js";
import { FRAME_BYTES } from "../src/render/grid.js";

test("testcard is exactly one frame's worth of bytes", () => {
    assert.equal(testcard().length, FRAME_BYTES);
});

test("testcard is deterministic", () => {
    assert.deepEqual(testcard(), testcard());
});
