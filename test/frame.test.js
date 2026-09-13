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

const NOW = 1_757_678_700_000; // fixed instant, so the header's date is deterministic across runs

test("renderFrame's front page output is exactly one frame's worth of bytes", () => {
    const { bytes } = renderFrame(100, { liveSummaries: [] }, board({}), THEMES.dark, NOW);
    assert.equal(bytes.length, FRAME_BYTES);
});

test("renderFrame is deterministic: identical inputs give identical bytes and etag", () => {
    const snapshot = { liveSummaries: [] };
    const a = renderFrame(100, snapshot, board({}), THEMES.dark, NOW);
    const b = renderFrame(100, snapshot, board({}), THEMES.dark, NOW);
    assert.deepEqual(a.bytes, b.bytes);
    assert.equal(a.etag, b.etag);
});

test("a stored batteryLow=true changes the front page's rendered bytes and etag", () => {
    const snapshot = { liveSummaries: [] };
    const normal = renderFrame(100, snapshot, board({ batteryLow: false }), THEMES.dark, NOW);
    const low = renderFrame(100, snapshot, board({ batteryLow: true }), THEMES.dark, NOW);
    assert.notEqual(normal.etag, low.etag);
    assert.notDeepEqual(normal.bytes, low.bytes);
});

test("P100's rendered bytes change once the date changes, and only then (determinism note, M8)", () => {
    const snapshot = { liveSummaries: [] };
    const sameDay = renderFrame(100, snapshot, board({}), THEMES.dark, NOW + 60 * 60 * 1000); // +1h, same day
    const nextDay = renderFrame(100, snapshot, board({}), THEMES.dark, NOW + 24 * 60 * 60 * 1000); // +1 day
    const base = renderFrame(100, snapshot, board({}), THEMES.dark, NOW);
    assert.equal(base.etag, sameDay.etag);
    assert.notEqual(base.etag, nextDay.etag);
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

test("real-page text never touches column 0 or column 49 (M19 inset)", () => {
    const page = {
        number: 205,
        sender: "hooks",
        postedDisplay: "Sat 12 Sep 14:05",
        expiresDisplay: "Sun 13 Sep 09:00",
        title: "x".repeat(48),
        body: "y".repeat(48),
        layout: "text",
        image: null,
        chart: null,
    };
    const { indices } = renderFrame(205, { page, liveSummaries: [{ number: 205 }] }, board({}), THEMES.dark, NOW);
    const bg = THEMES.dark.background;
    for (let y = 0; y < 448; y++) {
        assert.equal(indices[y * 600 + 0], bg, `col 0 at y=${y} should be untouched background`);
        assert.equal(indices[y * 600 + 599], bg, `col 49 at y=${y} should be untouched background`);
    }
});

test("the header's page number is drawn in the theme's accent colour", () => {
    const page = {
        number: 205,
        sender: "hooks",
        postedDisplay: "Sat 12 Sep 14:05",
        expiresDisplay: "Sun 13 Sep 09:00",
        title: "t",
        body: "",
        layout: "text",
        image: null,
        chart: null,
    };
    const { indices } = renderFrame(205, { page, liveSummaries: [{ number: 205 }] }, board({}), THEMES.dark, NOW);
    let accentInHeader = false;
    for (let y = 8; y < 32; y++) {
        for (let x = 12; x < 12 + 3 * 12; x++) {
            if (indices[y * 600 + x] === THEMES.dark.accent) accentInHeader = true;
        }
    }
    assert.ok(accentInHeader);
});

test("a long footer is cut with an ellipsis and keeps two blank cells before the expiry", () => {
    const page = { ...textPage(""), number: 205 };
    const liveSummaries = [{ number: 205, title: "a" }, { number: 301, title: "Cary, NC · Sunday 13 Sep weather" }];
    const { indices } = renderFrame(205, { page, liveSummaries }, board({}), THEMES.dark, NOW);
    const footerTop = 8 + 17 * 24;
    // "expires Sun 09:00" is 17 cells, right-aligned in the 48 text cells (0-47): it starts at
    // cell 31, so the left side may use at most cells 0-28 and cells 29-30 stay blank.
    for (const col of [29, 30]) {
        assert.ok(cellPixels(indices, col, footerTop).every((c) => c === THEMES.dark.background), `cell ${col} blank`);
    }
    const lastLeftCell = [28, 27].find((col) => cellPixels(indices, col, footerTop).includes(THEMES.dark.foreground));
    assert.ok(lastLeftCell !== undefined, "the cut left side ends right before the gap");
    // The ellipsis glyph is three dots on one row: only a few pixels, all in the lower half of the cell.
    const pixels = cellPixels(indices, lastLeftCell, footerTop);
    const lit = pixels.map((c, i) => (c === THEMES.dark.foreground ? Math.floor(i / 12) : -1)).filter((row) => row >= 0);
    assert.ok(lit.length > 0 && lit.every((row) => row >= 12), "last left cell is the ellipsis");
});

test("the footer names the index as next on the last live page", () => {
    const page = {
        number: 300,
        sender: "hooks",
        postedDisplay: "Sat 12 Sep 14:05",
        expiresDisplay: "Sun 13 Sep 09:00",
        title: "t",
        body: "",
        layout: "text",
        image: null,
        chart: null,
    };
    const liveSummaries = [{ number: 205, title: "a" }, { number: 300, title: "b" }];
    const { indices: withMore } = renderFrame(
        205,
        { page: { ...page, number: 205 }, liveSummaries },
        board({}),
        THEMES.dark,
        NOW,
    );
    const { indices: withoutMore } = renderFrame(300, { page, liveSummaries }, board({}), THEMES.dark, NOW);
    // The two footers differ (one names the next real page, the other wraps
    // to the front page) — a coarse but effective proxy for "renders
    // correctly for both the middle and the last live page" without
    // depending on exact glyph positions.
    let footerDiffers = false;
    for (let y = 416; y < 440; y++) {
        for (let x = 0; x < 600; x++) {
            if (withMore[y * 600 + x] !== withoutMore[y * 600 + x]) footerDiffers = true;
        }
    }
    assert.ok(footerDiffers);
});

function textPage(body) {
    return {
        number: 205,
        sender: "hooks",
        postedDisplay: "Sat 12 Sep 14:05",
        expiresDisplay: "Sun 13 Sep 09:00",
        title: "t",
        body,
        layout: "text",
        image: null,
        chart: null,
    };
}

const BODY_Y = 8 + 3 * 24; // first body row's top pixel
const TEXT_X0 = 12; // text is inset one cell

function cellPixels(indices, col, rowTop = BODY_Y) {
    const out = [];
    for (let y = rowTop; y < rowTop + 24; y++) {
        for (let x = TEXT_X0 + col * 12; x < TEXT_X0 + (col + 1) * 12; x++) out.push(indices[y * 600 + x]);
    }
    return out;
}

test("a band's padding never erases the character right before a tag", () => {
    const { indices } = renderFrame(205, { page: textPage("ab{red}cd{/}ef"), liveSummaries: [{ number: 205 }] }, board({}), THEMES.dark, NOW);
    const b = cellPixels(indices, 1);
    assert.ok(b.includes(THEMES.dark.foreground), "the 'b' glyph is still drawn");
    assert.ok(!b.includes(THEMES.dark.tags.red.bg), "no red band under 'b'");
});

test("a tagged run of block characters is drawn in the tag's colour without a band", () => {
    const { indices } = renderFrame(205, { page: textPage("{red}██{/} {yellow}██{/}"), liveSummaries: [{ number: 205 }] }, board({}), THEMES.dark, NOW);
    assert.ok(cellPixels(indices, 0).every((c) => c === 4), "full block in red");
    assert.ok(cellPixels(indices, 3).every((c) => c === 5), "full block in yellow");
    assert.ok(cellPixels(indices, 2).every((c) => c === THEMES.dark.background), "the space between stays background");
});

test("a colour band bordered by spaces reaches a few pixels into them (m16)", () => {
    const page = {
        number: 205,
        sender: "hooks",
        postedDisplay: "Sat 12 Sep 14:05",
        expiresDisplay: "Sun 13 Sep 09:00",
        title: "t",
        body: "before {red}FAILED{/} after",
        layout: "text",
        image: null,
        chart: null,
    };
    const { indices } = renderFrame(205, { page, liveSummaries: [{ number: 205 }] }, board({}), THEMES.dark, NOW);
    const bodyY = 8 + 3 * 24; // BODY_ROW_START's first row
    let run = 0;
    let longestRun = 0;
    for (let x = 0; x < 600; x++) {
        if (indices[bodyY * 600 + x] === THEMES.dark.tags.red.bg) {
            run++;
            longestRun = Math.max(longestRun, run);
        } else {
            run = 0;
        }
    }
    // "FAILED" is 6 cells (72px) plus 4px of padding into each bordering space.
    assert.equal(longestRun, 6 * 12 + 2 * 4);
});

test("image-left's text-region background clear doesn't wipe out the image drawn to its left", () => {
    const width = 288;
    const height = 336;
    const pixels = new Uint8Array(width * height).fill(4); // solid red
    const page = {
        number: 205,
        sender: "hooks",
        postedDisplay: "Sat 12 Sep 14:05",
        expiresDisplay: "Sun 13 Sep 09:00",
        title: "t",
        body: "some text",
        layout: "image-left",
        image: { style: "dither", width, height, pixels },
        chart: null,
    };
    const { indices } = renderFrame(205, { page, liveSummaries: [{ number: 205 }] }, board({}), THEMES.dark, NOW);
    // Somewhere inside the image's own region (rows 3-16, cols 0-23) the
    // red fill must survive the text region's background clear.
    let sawRed = false;
    for (let y = 80; y < 80 + height; y++) {
        for (let x = 0; x < width; x++) {
            if (indices[y * 600 + x] === 4) sawRed = true;
        }
    }
    assert.ok(sawRed);
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
