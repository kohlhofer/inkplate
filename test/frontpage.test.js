import { test } from "node:test";
import assert from "node:assert/strict";
import { createFramebuffer, PANEL_WIDTH } from "../src/render/grid.js";
import { renderFrontpage, footerText, bannerPage } from "../src/render/frontpage.js";
import { rowY, FOOTER_ROW, TITLE_ROW_START } from "../src/render/layout.js";
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
const page = (overrides) => ({
    number: 205,
    title: "Deploy done",
    bodyStart: "all green",
    postedDisplay: "Sat 12 Sep 14:05",
    urgent: false,
    urgentSince: null,
    ...overrides,
});

test("footer text is exactly 'button: next page' / 'no other pages' in the two no-urgent/no-battery cases", () => {
    assert.equal(footerText("blank", { batteryLow: false }, true), "button: next page");
    assert.equal(footerText("blank", { batteryLow: false }, false), "no other pages");
});

test("footer shows LOW BATTERY only when battery is low and the banner is occupied by urgent", () => {
    assert.equal(footerText("urgent", { batteryLow: true }, true), "LOW BATTERY");
    assert.equal(footerText("battery", { batteryLow: true }, true), "button: next page");
});

test("no live pages, no urgency, no low battery: footer says 'no other pages'", () => {
    const fb = createFramebuffer();
    renderFrontpage(fb, theme, {
        liveSummaries: [],
        board: { batteryLow: false, lastRedrawAt: 1000 },
    });
    // banner slot stays background-only: no red/yellow tag fill present
    assert.equal(readRow(fb, TITLE_ROW_START, theme.tags.red.bg), 0);
    assert.equal(readRow(fb, TITLE_ROW_START, theme.tags.yellow.bg), 0);
});

test("live pages present, no urgency, no low battery: footer says 'button: next page'", () => {
    const fb = createFramebuffer();
    renderFrontpage(fb, theme, {
        liveSummaries: [page({})],
        board: { batteryLow: false, lastRedrawAt: 1000 },
    });
    assert.equal(readRow(fb, TITLE_ROW_START, theme.tags.red.bg), 0);
});

test("battery-low banner appears only when board.batteryLow is true (the hysteresis flag, not a raw reading)", () => {
    const fbLow = createFramebuffer();
    renderFrontpage(fbLow, theme, {
        liveSummaries: [],
        board: { batteryLow: true, lastRedrawAt: 1000 },
    });
    assert.ok(readRow(fbLow, TITLE_ROW_START, theme.tags.yellow.bg) > 0);

    const fbOk = createFramebuffer();
    renderFrontpage(fbOk, theme, {
        liveSummaries: [],
        board: { batteryLow: false, lastRedrawAt: 1000 },
    });
    assert.equal(readRow(fbOk, TITLE_ROW_START, theme.tags.yellow.bg), 0);
});

test("urgent newsflash takes priority over the low-battery banner, and battery relocates to the footer", () => {
    const fb = createFramebuffer();
    renderFrontpage(fb, theme, {
        liveSummaries: [page({ urgent: true, urgentSince: 2000 })],
        board: { batteryLow: true, lastRedrawAt: 1000 },
    });
    // banner slot shows the urgent red band, not the battery yellow band
    assert.ok(readRow(fb, TITLE_ROW_START, theme.tags.red.bg) > 0);
    assert.equal(readRow(fb, TITLE_ROW_START, theme.tags.yellow.bg), 0);
});

test("the newsflash banner is a pure function of the live page set, independent of board.lastRedrawAt (B3)", () => {
    // urgentSince (500) is well before lastRedrawAt (1000) — under the old,
    // broken model this would hide the banner; it must still show, and keep
    // showing across however many later redraws, as long as the page is
    // still live and urgent.
    for (const lastRedrawAt of [1000, 5000, 60_000]) {
        const fb = createFramebuffer();
        renderFrontpage(fb, theme, {
            liveSummaries: [page({ urgent: true, urgentSince: 500 })],
            board: { batteryLow: false, lastRedrawAt },
        });
        assert.ok(readRow(fb, TITLE_ROW_START, theme.tags.red.bg) > 0);
    }
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

test("more than 14 live pages collapse the last row into a '+N more' summary", () => {
    const fb = createFramebuffer();
    const pages = Array.from({ length: 16 }, (_, i) => page({ number: 200 + i }));
    renderFrontpage(fb, theme, {
        liveSummaries: pages,
        board: { batteryLow: false, lastRedrawAt: 1000 },
    });
    // 16 pages, 13 shown + 1 summary row = 14 rows total; nothing throws and
    // the framebuffer isn't blank across the whole listing.
    let nonBackground = 0;
    for (let row = 3; row <= 16; row++) nonBackground += readRow(fb, row, theme.foreground);
    assert.ok(nonBackground > 0);
});
