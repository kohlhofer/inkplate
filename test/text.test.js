import { test } from "node:test";
import assert from "node:assert/strict";
import { cpLength, cpSlice } from "../src/render/text.js";

// U+1FB01 is a sextant glyph — a single grid cell, but a surrogate pair
// (2 UTF-16 code units) in JS string representation (finding M3/m4).
const SEXTANT = "\u{1FB01}";

test("cpLength counts an astral codepoint as one, not two", () => {
    assert.equal(SEXTANT.length, 2); // UTF-16 units — the bug this guards against
    assert.equal(cpLength(SEXTANT), 1);
    assert.equal(cpLength(`a${SEXTANT}b`), 3);
});

test("cpSlice slices by codepoint, never splitting a surrogate pair", () => {
    const s = `a${SEXTANT}b`;
    assert.equal(cpSlice(s, 0, 2), `a${SEXTANT}`);
    assert.equal(cpSlice(s, 1, 2), SEXTANT);
    assert.equal(cpSlice(s, 0, 1), "a");
});
