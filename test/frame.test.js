import { test } from "node:test";
import assert from "node:assert/strict";
import { testcard, renderFrame } from "../src/render/frame.js";
import { FRAME_BYTES } from "../src/render/grid.js";
import { THEMES } from "../src/render/theme.js";

test("testcard is exactly one frame's worth of bytes", () => {
    assert.equal(testcard().length, FRAME_BYTES);
});

test("testcard is deterministic", () => {
    assert.deepEqual(testcard(), testcard());
});

const board = (overrides) => ({
    batteryLow: false,
    lastRedrawAt: 0,
    lastButtonAt: 0,
    lastUrgentBypassAt: null,
    ...overrides,
});

test("renderFrame's front page output is exactly one frame's worth of bytes", () => {
    const { bytes } = renderFrame(100, { liveSummaries: [] }, board({}), THEMES.dark);
    assert.equal(bytes.length, FRAME_BYTES);
});

test("renderFrame is deterministic: identical inputs give identical bytes and etag", () => {
    const snapshot = { liveSummaries: [] };
    const a = renderFrame(100, snapshot, board({}), THEMES.dark);
    const b = renderFrame(100, snapshot, board({}), THEMES.dark);
    assert.deepEqual(a.bytes, b.bytes);
    assert.equal(a.etag, b.etag);
});

test("a stored batteryLow=true changes the front page's rendered bytes and etag", () => {
    const snapshot = { liveSummaries: [] };
    const normal = renderFrame(100, snapshot, board({ batteryLow: false }), THEMES.dark);
    const low = renderFrame(100, snapshot, board({ batteryLow: true }), THEMES.dark);
    assert.notEqual(normal.etag, low.etag);
    assert.notDeepEqual(normal.bytes, low.bytes);
});

test("renderFrame draws a real text-layout page without crashing and at full length", () => {
    const page = {
        number: 205,
        sender: "hooks",
        postedDisplay: "Sat 12 Sep 14:05",
        expiresDisplay: "Sun 13 Sep 09:00",
        title: "Deploy finished",
        body: "{green}all tests passed{/}\nsee the log for details",
        layout: "text",
        image: null,
        chart: null,
    };
    const { bytes, etag } = renderFrame(205, { page, liveSummaries: [{ number: 205 }] }, board({}), THEMES.dark);
    assert.equal(bytes.length, FRAME_BYTES);
    assert.equal(typeof etag, "string");
});

test("renderFrame draws a chart on a text-layout page without crashing", () => {
    const page = {
        number: 206,
        sender: "hooks",
        postedDisplay: "Sat 12 Sep 14:05",
        expiresDisplay: "Sun 13 Sep 09:00",
        title: "Rainfall",
        body: "steady all week",
        layout: "text",
        image: null,
        chart: { type: "spark", values: [1, 4, 2, 8, 3], label: "rain/hr" },
    };
    const { bytes } = renderFrame(206, { page, liveSummaries: [{ number: 206 }] }, board({}), THEMES.dark);
    assert.equal(bytes.length, FRAME_BYTES);
});
