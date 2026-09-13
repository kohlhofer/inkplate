import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/render/markup.js";
import { wrap } from "../src/render/wrap.js";

function rowText(row) {
    return row.map((s) => s.text).join("");
}

test("greedy word wrap packs words up to the column budget", () => {
    const { lines } = parse("the quick brown fox jumps");
    const { rows, warnings } = wrap(lines, 10, 10);
    assert.deepEqual(
        rows.map(rowText),
        ["the quick", "brown fox", "jumps"],
    );
    assert.deepEqual(warnings, []);
});

test("a word longer than the column budget is hard-broken", () => {
    const { lines } = parse("supercalifragilistic");
    const { rows } = wrap(lines, 6, 10);
    for (const row of rows) assert.ok(rowText(row).length <= 6);
    assert.equal(rows.map(rowText).join(""), "supercalifragilistic");
});

test("tag spans cost 0 columns: colour changes don't shrink the row budget", () => {
    const { lines } = parse("{red}hi{/} there");
    const { rows } = wrap(lines, 8, 10);
    assert.equal(rows.length, 1);
    assert.equal(rowText(rows[0]), "hi there");
});

test("a space between two words of the same tag keeps the tag, so the band is continuous", () => {
    const { lines } = parse("{yellow}Partly sunny{/} high 90");
    const { rows } = wrap(lines, 30, 10);
    assert.deepEqual(rows[0][0], { text: "Partly sunny", tag: "yellow" });
    assert.equal(rows[0][1].tag, null);
});

test("the space at a tag boundary is untagged, never taking the next word's colour (m16)", () => {
    const { lines } = parse("before {red}FAILED{/} after");
    const { rows } = wrap(lines, 30, 10);
    const flat = rows[0].flatMap((span) => [...span.text].map(() => span.tag));
    const text = rowText(rows[0]);
    // Both spaces (around FAILED) must be untagged, regardless of which
    // word sits on either side of them.
    for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") assert.equal(flat[i], null, `space at ${i} should be untagged`);
    }
});

test("fenced lines are not wrapped, only cropped, and warn once per overflowing line", () => {
    const { lines } = parse("```\n0123456789ABCDEF\nshort\n```");
    const { rows, warnings } = wrap(lines, 10, 10);
    assert.equal(rowText(rows[0]), "0123456789");
    assert.equal(rowText(rows[1]), "short");
    assert.deepEqual(warnings, ["1 fenced line(s) cropped"]);
});

test("vertical truncation reports the number of dropped rows", () => {
    const { lines } = parse("a\nb\nc\nd\ne");
    const { rows, warnings } = wrap(lines, 10, 3);
    assert.equal(rows.length, 3);
    assert.deepEqual(warnings, ["2 lines truncated"]);
});

test("blank lines are preserved as empty rows", () => {
    const { lines } = parse("first\n\nthird");
    const { rows } = wrap(lines, 10, 10);
    assert.equal(rows.length, 3);
    assert.equal(rowText(rows[1]), "");
});
