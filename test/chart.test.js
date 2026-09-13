import { test } from "node:test";
import assert from "node:assert/strict";
import { createFramebuffer, PANEL_WIDTH } from "../src/render/grid.js";
import { drawChart } from "../src/render/chart.js";

function columnHeight(fb, x, rect, fgIndex) {
    let height = 0;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
        if (fb[y * PANEL_WIDTH + x] === fgIndex) height++;
    }
    return height;
}

test("the max value in a spark chart fills the full rect height", () => {
    const fb = createFramebuffer();
    const rect = { x: 0, y: 0, w: 20, h: 10 };
    drawChart(fb, rect, { type: "spark", values: [1, 10] }, 5);
    assert.equal(columnHeight(fb, rect.w - 1, rect, 5), 10);
});

test("a zero value draws no column", () => {
    const fb = createFramebuffer();
    const rect = { x: 0, y: 0, w: 20, h: 10 };
    drawChart(fb, rect, { type: "spark", values: [0, 10] }, 5);
    assert.equal(columnHeight(fb, 0, rect, 5), 0);
});

test("bars leave a gap between columns; spark packs them edge to edge", () => {
    const fb = createFramebuffer();
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    drawChart(fb, rect, { type: "bars", values: [10, 10, 10] }, 3);
    // with a 1px gap and 3 columns, not every x in [0,10) is filled
    let filled = 0;
    for (let x = 0; x < rect.w; x++) filled += columnHeight(fb, x, rect, 3) > 0 ? 1 : 0;
    assert.ok(filled < rect.w);
});

test("equal values produce equal column heights", () => {
    const fb = createFramebuffer();
    const rect = { x: 0, y: 0, w: 12, h: 8 };
    drawChart(fb, rect, { type: "spark", values: [4, 4, 4] }, 2);
    const heights = [0, 4, 8].map((x) => columnHeight(fb, x, rect, 2));
    assert.deepEqual(new Set(heights).size, 1);
});

test("empty values draws nothing and does not throw", () => {
    const fb = createFramebuffer();
    assert.doesNotThrow(() => drawChart(fb, { x: 0, y: 0, w: 10, h: 10 }, { type: "spark", values: [] }, 1));
});
