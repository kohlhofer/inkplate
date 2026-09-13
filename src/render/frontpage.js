import { drawText } from "./glyphs.js";
import { fillRect, COLS, CELL_WIDTH, CELL_HEIGHT } from "./grid.js";
import { HEADER_ROW, TITLE_ROW_START, TITLE_ROWS, BODY_ROW_START, BODY_ROWS, FOOTER_ROW, rowY } from "./layout.js";

// Page 100 is generated, not authored: renderFrontpage draws the whole
// thing (header, banner slot, listing, footer) as one pure function of
// live-page summaries and board state — no store/HTTP access here.

const WIDTHS = { number: 3, title: 20, body: 19, time: 5 };
const ROW_WIDTH = COLS * CELL_WIDTH;

function truncate(str, width) {
    return str.length > width ? str.slice(0, width) : str;
}

function pad(str, width) {
    return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}

// The P100 newsflash banner is a pure function of the live page set (finding
// B3): the live urgent page with the newest urgentSince, shown for as long
// as it stays live and urgent — no board/redraw state involved, so it can't
// disappear on the next timer redraw the way it did when this was gated on
// urgentSince > lastRedrawAt.
export function bannerPage(liveSummaries) {
    let best = null;
    for (const page of liveSummaries) {
        if (page.urgent && page.urgentSince && (!best || page.urgentSince > best.urgentSince)) best = page;
    }
    return best;
}

function listingRow(page) {
    const number = pad(String(page.number), WIDTHS.number);
    const title = pad(truncate(page.title, WIDTHS.title), WIDTHS.title);
    const body = pad(truncate(page.bodyStart ?? "", WIDTHS.body), WIDTHS.body);
    const time = page.postedDisplay.slice(-WIDTHS.time);
    return `${number} ${title} ${body} ${time}`;
}

export function footerText(bannerKind, board, hasLivePages) {
    if (board.batteryLow && bannerKind === "urgent") return "LOW BATTERY";
    return hasLivePages ? "button: next page" : "no other pages";
}

export function renderFrontpage(fb, theme, { liveSummaries, board }) {
    const bg = theme.background;
    const fg = theme.foreground;

    fillRect(fb, 0, rowY(HEADER_ROW), ROW_WIDTH, CELL_HEIGHT, bg);
    drawText(fb, 0, rowY(HEADER_ROW), "100", fg);

    const urgentPage = bannerPage(liveSummaries);
    const bannerKind = urgentPage ? "urgent" : board.batteryLow ? "battery" : "blank";
    const bannerY = rowY(TITLE_ROW_START);
    const bannerH = TITLE_ROWS * CELL_HEIGHT;
    if (bannerKind === "urgent") {
        fillRect(fb, 0, bannerY, ROW_WIDTH, bannerH, theme.tags.red.bg);
        drawText(fb, 0, bannerY, truncate(urgentPage.title, COLS), theme.tags.red.fg, { doubleHeight: true });
    } else if (bannerKind === "battery") {
        fillRect(fb, 0, bannerY, ROW_WIDTH, bannerH, theme.tags.yellow.bg);
        drawText(fb, 0, bannerY, "LOW BATTERY", theme.tags.yellow.fg, { doubleHeight: true });
    } else {
        fillRect(fb, 0, bannerY, ROW_WIDTH, bannerH, bg);
    }

    const overflow = liveSummaries.length > BODY_ROWS;
    const shown = overflow ? liveSummaries.slice(0, BODY_ROWS - 1) : liveSummaries;
    for (let i = 0; i < BODY_ROWS; i++) {
        const y = rowY(BODY_ROW_START + i);
        fillRect(fb, 0, y, ROW_WIDTH, CELL_HEIGHT, bg);
        if (i < shown.length) {
            drawText(fb, 0, y, listingRow(shown[i]), fg);
        } else if (overflow && i === BODY_ROWS - 1) {
            drawText(fb, 0, y, `+${liveSummaries.length - shown.length} more`, fg);
        }
    }

    const footerY = rowY(FOOTER_ROW);
    fillRect(fb, 0, footerY, ROW_WIDTH, CELL_HEIGHT, bg);
    drawText(fb, 0, footerY, footerText(bannerKind, board, liveSummaries.length > 0), fg);
}
