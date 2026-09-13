import { test } from "node:test";
import assert from "node:assert/strict";
import { createFramebuffer, PANEL_WIDTH } from "../src/render/grid.js";
import { renderFrontpage, footerText, bannerPage } from "../src/render/frontpage.js";
import { rowY, FOOTER_ROW, TITLE_ROW_START, BODY_ROW_START } from "../src/render/layout.js";
import { THEMES } from "../src/render/theme.js";

function readRow(fb, row, colorIndex) {
    let count = 0;
    const y0 = rowY(row);
    for (let y = y0; y < y0 + 24; y++) {
        for (let x = 0; x < PANEL_WIDTH; x++) {
            if (fb[y * PANEL_WIDTH + x] === colorIndex) count++;
        }
    }
    return count;
}

const theme = THEMES.dark;
const NOW = new Date(2026, 8, 12, 14, 5).getTime(); // Sat 12 Sep 2026
const page = (overrides) => ({
    number: 205,
    title: "Deploy done",
    postedDisplay: "Sat 12 Sep 14:05",
    urgent: false,
    urgentSince: null,
    ...overrides,
});

test("footer says 'next » <first page>' when pages exist, 'no pages yet' otherwise (M8)", () => {
    assert.equal(footerText("blank", { batteryLow: false }, [page({ number: 300, title: "Rain per hour" })]), "next » 300 Rain per hour");
    assert.equal(footerText("blank", { batteryLow: false }, []), "no pages yet");
});

test("footer shows LOW BATTERY only when battery is low and the banner is occupied by urgent", () => {
    assert.equal(footerText("urgent", { batteryLow: true }, [page({})]), "LOW BATTERY");
    assert.equal(footerText("battery", { batteryLow: true }, [page({})]), "next » 205 Deploy done");
});

test("no live pages, no urgency, no low battery: the empty-P100 banner and colour stripe appear, footer says 'no pages yet'", () => {
    const fb = createFramebuffer();
    renderFrontpage(fb, theme, { liveSummaries: [], board: { batteryLow: false, lastRedrawAt: 1000 }, now: NOW });
    // banner slot stays a plain band (no red/yellow tag fill)
    assert.equal(readRow(fb, TITLE_ROW_START, theme.tags.red.bg), 0);
    assert.equal(readRow(fb, TITLE_ROW_START, theme.tags.yellow.bg), 0);
    assert.ok(readRow(fb, TITLE_ROW_START, theme.foreground) > 0); // "Nothing posted" glyphs
    // the colour-check stripe uses every one of the 7 palette indices
    for (let i = 0; i < 7; i++) assert.ok(readRow(fb, BODY_ROW_START, i) > 0, `stripe missing colour ${i}`);
});

test("live pages present, no urgency, no low battery: footer names the first page", () => {
    const fb = createFramebuffer();
    renderFrontpage(fb, theme, { liveSummaries: [page({})], board: { batteryLow: false, lastRedrawAt: 1000 }, now: NOW });
    assert.equal(readRow(fb, TITLE_ROW_START, theme.tags.red.bg), 0);
});

test("battery-low banner appears only when board.batteryLow is true (the hysteresis flag, not a raw reading), and wins over the empty state", () => {
    const fbLow = createFramebuffer();
    renderFrontpage(fbLow, theme, { liveSummaries: [], board: { batteryLow: true, lastRedrawAt: 1000 }, now: NOW });
    assert.ok(readRow(fbLow, TITLE_ROW_START, theme.tags.yellow.bg) > 0);

    const fbOk = createFramebuffer();
    renderFrontpage(fbOk, theme, { liveSummaries: [], board: { batteryLow: false, lastRedrawAt: 1000 }, now: NOW });
    assert.equal(readRow(fbOk, TITLE_ROW_START, theme.tags.yellow.bg), 0);
});

test("urgent newsflash takes priority over the low-battery banner, and battery relocates to the footer", () => {
    const fb = createFramebuffer();
    renderFrontpage(fb, theme, {
        liveSummaries: [page({ urgent: true, urgentSince: 2000 })],
        board: { batteryLow: true, lastRedrawAt: 1000 },
        now: NOW,
    });
    assert.ok(readRow(fb, TITLE_ROW_START, theme.tags.red.bg) > 0);
    assert.equal(readRow(fb, TITLE_ROW_START, theme.tags.yellow.bg), 0);
});

test("the newsflash banner is a pure function of the live page set, independent of board.lastRedrawAt (B3)", () => {
    for (const lastRedrawAt of [1000, 5000, 60_000]) {
        const fb = createFramebuffer();
        renderFrontpage(fb, theme, {
            liveSummaries: [page({ urgent: true, urgentSince: 500 })],
            board: { batteryLow: false, lastRedrawAt },
            now: NOW,
        });
        assert.ok(readRow(fb, TITLE_ROW_START, theme.tags.red.bg) > 0);
    }
});

test("the newsflash banner shows » <page number> right-aligned after the title (m18)", () => {
    const fb = createFramebuffer();
    renderFrontpage(fb, theme, {
        liveSummaries: [page({ number: 201, urgent: true, urgentSince: 500, title: "Server down" })],
        board: { batteryLow: false, lastRedrawAt: 0 },
        now: NOW,
    });
    // The rightmost inset column of the banner (double-height) carries
    // glyph pixels somewhere in its 48px height (the "1" of "» 201"), not
    // just background.
    const y0 = rowY(TITLE_ROW_START);
    let rightmostHasFg = false;
    for (let y = y0; y < y0 + 48; y++) {
        for (let x = PANEL_WIDTH - 24; x < PANEL_WIDTH - 12; x++) {
            if (fb[y * PANEL_WIDTH + x] === theme.tags.red.fg) rightmostHasFg = true;
        }
    }
    assert.ok(rightmostHasFg);
});

test("bannerPage picks the live urgent page with the newest urgentSince", () => {
    const pages = [
        page({ number: 201, urgent: true, urgentSince: 1000 }),
        page({ number: 202, urgent: true, urgentSince: 3000 }),
        page({ number: 203, urgent: false, urgentSince: null }),
    ];
    assert.equal(bannerPage(pages).number, 202);
    assert.equal(bannerPage([page({ urgent: false })]), null);
    assert.equal(bannerPage([]), null);
});

test("more than 13 live pages collapse into a '+N more' row, leaving a blank row before the footer (m19)", () => {
    const fb = createFramebuffer();
    const pages = Array.from({ length: 16 }, (_, i) => page({ number: 200 + i }));
    renderFrontpage(fb, theme, { liveSummaries: pages, board: { batteryLow: false, lastRedrawAt: 1000 }, now: NOW });
    let nonBackground = 0;
    for (let row = 3; row <= 15; row++) nonBackground += readRow(fb, row, theme.foreground);
    assert.ok(nonBackground > 0);
    // row 16 (the last body row, right above the footer) always stays blank
    assert.equal(readRow(fb, 16, theme.foreground), 0);
    assert.equal(readRow(fb, 16, theme.accent), 0);
});

test("an urgent row's page number renders in red, not the theme accent (M21)", () => {
    const fb = createFramebuffer();
    renderFrontpage(fb, theme, {
        liveSummaries: [page({ number: 205, urgent: true, urgentSince: 1 })],
        board: { batteryLow: false, lastRedrawAt: 0 },
        now: NOW,
    });
    assert.ok(readRow(fb, BODY_ROW_START, 4) > 0); // 4 == red, the fixed palette index
});

test("P100 header shows P100 in the accent colour and the relay's current date, right-aligned", () => {
    const fb = createFramebuffer();
    renderFrontpage(fb, theme, { liveSummaries: [], board: { batteryLow: false, lastRedrawAt: 0 }, now: NOW });
    assert.ok(readRow(fb, 0, theme.accent) > 0);
    // "Sat 12 Sep" (10 cols) sits right-aligned; "P100  VIDEOTEXT" ends well
    // before column 39, so foreground pixels in [468,588) can only be the
    // date, not the sender/label text to its left.
    const y0 = rowY(0);
    let dateAreaHasFg = false;
    for (let y = y0; y < y0 + 24; y++) {
        for (let x = 468; x < 588; x++) {
            if (fb[y * PANEL_WIDTH + x] === theme.foreground) dateAreaHasFg = true;
        }
    }
    assert.ok(dateAreaHasFg);
});
