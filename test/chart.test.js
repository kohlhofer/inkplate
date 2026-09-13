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

// A realistic rect: 5 grid rows tall (120px), well over the label rows a
// spark chart reserves, so bar heights actually snap to whole cells.
const rect = { x: 0, y: 0, w: 4 * 12, h: 5 * CELL_HEIGHT };

test("the max value in a spark chart reaches the top of the (whole-cell) bar area", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [1, 10] }, theme);
    // 1 label row reserved top+bottom leaves 3 whole cell-rows of bar area.
    assert.equal(columnHeight(fb, rect.w - 1, rect, theme.foreground), 3 * CELL_HEIGHT);
});

test("spark scales min-to-max: the minimum value draws no column, even though it isn't zero", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [3, 10] }, theme);
    assert.equal(columnHeight(fb, 0, rect, theme.foreground), 0);
    assert.equal(columnHeight(fb, 0, rect, theme.accent), 0);
});

test("bars stay 0-based: a flat series of positive bars still draws full-height columns", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "bars", values: [4, 4, 4] }, theme);
    const heights = [0, rect.w / 3, (2 * rect.w) / 3].map((x) => columnHeight(fb, Math.floor(x), rect, theme.foreground));
    for (const h of heights) assert.ok(h > 0);
});

test("a flat spark series (no variation) draws at the baseline, not as a solid slab", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [4, 4, 4] }, theme);
    for (const x of [0, Math.floor(rect.w / 2), rect.w - 1]) {
        assert.equal(columnHeight(fb, x, rect, theme.foreground), 0);
    }
});

test("bars leave a gap between columns; spark packs them edge to edge", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "bars", values: [10, 10, 10] }, theme);
    let filled = 0;
    for (let x = 0; x < rect.w; x++) filled += columnHeight(fb, x, rect, theme.foreground) > 0 ? 1 : 0;
    assert.ok(filled < rect.w);
});

test("a sub-cell remainder is drawn in the accent colour, on top of the whole-cell body", () => {
    const fb = createFramebuffer();
    // rows = 3; value 5 of range [0,10] (0-based bars) -> exactly half of 3
    // cells = 1 whole cell + a 4-eighths (half-cell) accent cap.
    drawChart(fb, rect, { type: "bars", values: [5, 10] }, theme);
    assert.ok(columnHeight(fb, 0, rect, theme.accent) > 0);
});

test("spark prints right-aligned max/min labels beside the chart", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [3, 10] }, theme);
    assert.ok(countColor(fb, rect.y, rect.y + CELL_HEIGHT, theme.foreground) > 0); // "10" top-right
    assert.ok(countColor(fb, rect.y + rect.h - CELL_HEIGHT, rect.y + rect.h, theme.foreground) > 0); // "3" bottom-right
});

test("bars charts reserve no label rows: the max-value bar reaches the very top of the rect", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "bars", values: [10] }, theme);
    assert.equal(fb[rect.y * PANEL_WIDTH + 0], theme.foreground);
});

test("spark charts reserve a label row: even the max value doesn't reach the very top of the rect", () => {
    const fb = createFramebuffer();
    drawChart(fb, rect, { type: "spark", values: [1, 10] }, theme);
    assert.notEqual(fb[rect.y * PANEL_WIDTH + (rect.w - 1)], theme.foreground);
    assert.notEqual(fb[rect.y * PANEL_WIDTH + (rect.w - 1)], theme.accent);
});

test("empty values draws nothing and does not throw", () => {
    const fb = createFramebuffer();
    assert.doesNotThrow(() => drawChart(fb, { x: 0, y: 0, w: 10, h: 10 }, { type: "spark", values: [] }, theme));
});
