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
