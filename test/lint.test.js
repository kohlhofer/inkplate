import { test } from "node:test";
import assert from "node:assert/strict";
import { lint, TITLE_MAX } from "../src/render/lint.js";

test("a too-long title produces exactly one 'title cut' warning and is cut to 50 chars", () => {
    const title = "x".repeat(80);
    const { title: cutTitle, warnings } = lint({ title, body: "", layout: "text" });
    assert.equal(cutTitle.length, TITLE_MAX);
    assert.deepEqual(
        warnings.filter((w) => w === "title cut"),
        ["title cut"],
    );
});

test("a title within the limit is untouched and warning-free", () => {
    const { title, warnings } = lint({ title: "short", body: "", layout: "text" });
    assert.equal(title, "short");
    assert.deepEqual(warnings, []);
});

test("a body that overflows the row budget produces an 'N lines truncated' warning", () => {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const { warnings } = lint({ title: "t", body, layout: "text" });
    assert.ok(warnings.some((w) => /lines truncated/.test(w)));
});

test("an unknown tag appearing three times produces one deduplicated warning", () => {
    const { warnings } = lint({ title: "t", body: "{foo} and {foo} and {foo}", layout: "text" });
    assert.deepEqual(
        warnings.filter((w) => w === "unknown tag {foo}"),
        ["unknown tag {foo}"],
    );
});

test("image layout with extra body lines warns that they're dropped", () => {
    const { warnings } = lint({ title: "t", body: "caption\nsecond line", layout: "image" });
    assert.deepEqual(warnings, ["extra body lines dropped (image layout keeps only a caption)"]);
});

test("image layout with a single short caption line has no warning", () => {
    const { warnings } = lint({ title: "t", body: "caption", layout: "image" });
    assert.deepEqual(warnings, []);
});
