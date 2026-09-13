import { test } from "node:test";
import assert from "node:assert/strict";
import { regionsFor, rowY, BODY_ROW_START, FOOTER_ROW } from "../src/render/layout.js";
import { PANEL_HEIGHT } from "../src/render/grid.js";

test("rowY places the body region's start at pixel y=80 per the plan", () => {
    assert.equal(rowY(BODY_ROW_START), 80);
});

test("footer row sits just above the bottom border", () => {
    // row17 (24px) + BORDER (8px) should land exactly on PANEL_HEIGHT
    assert.equal(rowY(FOOTER_ROW) + 24 + 8, PANEL_HEIGHT);
});

test("text layout insets the body width to columns 1-48 (M19)", () => {
    const { text, image, caption } = regionsFor("text");
    assert.equal(image, null);
    assert.equal(caption, null);
    assert.equal(text.colStart, 1);
    assert.equal(text.colSpan, 48);
    assert.equal(text.rowSpan, 14);
});

test("image-left splits into a 24-col image, gutter, and 24-col inset text", () => {
    const { image, text } = regionsFor("image-left");
    assert.equal(image.colSpan, 24);
    assert.equal(text.colStart, 25);
    assert.equal(text.colSpan, 24); // stops at col 48, not col 49 (M19)
    assert.equal(image.w, 288);
    assert.equal(text.w, 288);
});

test("image-top splits into a 7-row image, gutter, and 6-row inset text", () => {
    const { image, text } = regionsFor("image-top");
    assert.equal(image.rowSpan, 7);
    assert.equal(text.rowSpan, 6);
    assert.equal(image.h, 168);
    assert.equal(text.h, 144);
    assert.equal(text.colStart, 1);
    assert.equal(text.colSpan, 48);
});

test("full image layout reserves a 1-row inset caption and no wrapped text region", () => {
    const { image, text, caption } = regionsFor("image");
    assert.equal(image.rowSpan, 13);
    assert.equal(text, null);
    assert.equal(caption.rowSpan, 1);
    assert.equal(caption.colStart, 1);
    assert.equal(caption.colSpan, 48);
});
