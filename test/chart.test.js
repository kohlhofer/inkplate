import { test } from "node:test";
import assert from "node:assert/strict";
import { createFramebuffer, PANEL_WIDTH, CELL_HEIGHT } from "../src/render/grid.js";
import { drawChart } from "../src/render/chart.js";
import { THEMES } from "../src/render/theme.js";

const theme = THEMES.dark;

function columnHeight(fb, x, rect, colorIndex) {
    let height = 0;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
        if (fb[y * PANEL_WIDTH + x] === colorIndex) height++;
    }
    return height;
}

function countColor(fb, y0, y1, colorIndex) {
    let n = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = 0; x < PANEL_WIDTH; x++) if (fb[y * PANEL_WIDTH + x] === colorIndex) n++;
    }
    return n;
}

// 5 grid rows tall (120px): spark reserves one label row top and bottom,
// leaving 3 cell-rows of bar area.
const rect = { x: 0, y: 0, w: 4 * 12, h: 5 * CELL_HEIGHT };

test("the max value in a spark chart fills the whole bar area", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [1, 10] }, theme);
    assert.equal(columnHeight(fb, rect.w / 2, rect, theme.accent), 3 * CELL_HEIGHT);
});

test("spark keeps the minimum visible as a one-eighth stub", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [3, 10] }, theme);
    assert.equal(columnHeight(fb, 0, rect, theme.accent), 3);
});

test("a flat spark series draws stubs at the baseline, not a solid slab", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [4, 4, 4] }, theme);
    for (const x of [0, 16, 32]) assert.equal(columnHeight(fb, x, rect, theme.accent), 3);
});

test("every column is a single colour: no foreground pixels inside the bar area", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [2, 7, 5, 9] }, theme);
    assert.equal(countColor(fb, rect.y + CELL_HEIGHT, rect.y + rect.h - CELL_HEIGHT, theme.foreground), 0);
    assert.ok(countColor(fb, rect.y + CELL_HEIGHT, rect.y + rect.h - CELL_HEIGHT, theme.accent) > 0);
});

test("bars stay 0-based: a flat series of positive bars draws full-height columns", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "bars", values: [4, 4, 4] }, theme);
    assert.equal(columnHeight(fb, 0, rect, theme.accent), rect.h);
});

test("bars leave a visible gap between columns", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "bars", values: [10, 10, 10] }, theme);
    let empty = 0;
    for (let x = 0; x < rect.w; x++) empty += columnHeight(fb, x, rect, theme.accent) === 0 ? 1 : 0;
    assert.ok(empty >= 3);
});

test("column widths snap to whole cells once a column is at least a cell wide", () => {
    const wide = { x: 0, y: 0, w: 576, h: 5 * CELL_HEIGHT };
    const fb = createFramebuffer();
    drawChart(fb, wide, { type: "spark", values: [1, 2, 3, 4, 5, 6, 7] }, theme); // 576/7 = 82 -> 72
    assert.ok(columnHeight(fb, 7 * 72 - 1, wide, theme.accent) > 0);
    assert.equal(columnHeight(fb, 7 * 72, wide, theme.accent), 0);
});

test("a series wider than the rect never draws past its right edge", () => {
    const narrow = { x: 12, y: 0, w: 100, h: 5 * CELL_HEIGHT };
    const fb = createFramebuffer();
    drawChart(fb, narrow, { type: "spark", values: Array.from({ length: 600 }, (_, i) => i % 17) }, theme);
    for (let x = narrow.x + narrow.w; x < PANEL_WIDTH; x++) {
        assert.equal(columnHeight(fb, x, narrow, theme.accent), 0);
    }
});

test("spark prints the real max and min beside the chart", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [3, 10] }, theme);
    assert.ok(countColor(fb, rect.y, rect.y + CELL_HEIGHT, theme.foreground) > 0);
    assert.ok(countColor(fb, rect.y + rect.h - CELL_HEIGHT, rect.y + rect.h, theme.foreground) > 0);
});

test("bars charts reserve no label rows: the max-value bar reaches the top of the rect", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "bars", values: [10] }, theme);
    assert.equal(fb[rect.y * PANEL_WIDTH + 0], theme.accent);
});

test("empty values draws nothing and does not throw", () => {
    const fb = createFramebuffer();
    assert.doesNotThrow(() => drawChart(fb, { x: 0, y: 0, w: 10, h: 10 }, { type: "spark", values: [] }, theme));
});
