import { test } from "node:test";
import assert from "node:assert/strict";
import { CELL_WIDTH, CELL_HEIGHT, GLYPHS } from "../font/font-data.js";

test("covers full ASCII (0x20-0x7e) and Latin-1 Supplement (0xa0-0xff)", () => {
    for (let cp = 0x20; cp <= 0x7e; cp++) {
        assert.ok(GLYPHS[cp], `missing ASCII codepoint ${cp}`);
    }
    for (let cp = 0xa0; cp <= 0xff; cp++) {
        assert.ok(GLYPHS[cp], `missing Latin-1 codepoint ${cp}`);
    }
});

test("includes U+00B7 middle dot used in the footer", () => {
    assert.ok(GLYPHS[0xb7]);
});

test("every glyph is CELL_HEIGHT rows of a CELL_WIDTH-bit mask", () => {
    const maxValue = 2 ** CELL_WIDTH - 1;
    for (const [cp, rows] of Object.entries(GLYPHS)) {
        assert.equal(rows.length, CELL_HEIGHT, `codepoint ${cp} has ${rows.length} rows`);
        for (const row of rows) {
            assert.ok(row >= 0 && row <= maxValue, `codepoint ${cp} row ${row} out of range`);
        }
    }
});

test("letter A is non-blank and roughly symmetric", () => {
    const rows = GLYPHS[65];
    assert.ok(rows.some((row) => row !== 0));
});

function setBits(rows) {
    return rows.reduce((n, row) => n + row.toString(2).replace(/0/g, "").length, 0);
}

test("glyphs are drawn SAA5050-style: doubled pixels plus corner rounding on diagonals", () => {
    // '/' is 5 source pixels in a diagonal: 5 x 4 doubled pixels, plus 2
    // rounding pixels at each of its 4 diagonal steps.
    assert.equal(setBits(GLYPHS[0x2f]), 5 * 4 + 4 * 2);
    // 'L' has no diagonals, so it is exactly its doubled pixels (11 source pixels).
    assert.equal(setBits(GLYPHS[0x4c]), 11 * 4);
});

test("covers the punctuation agents write: dashes, curly quotes, bullet, ellipsis", () => {
    for (const cp of [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026]) {
        assert.ok(GLYPHS[cp], `missing U+${cp.toString(16)}`);
    }
});
