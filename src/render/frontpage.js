import { drawText } from "./glyphs.js";
import { fillRect, BORDER, COLS, CELL_WIDTH, CELL_HEIGHT } from "./grid.js";
import { HEADER_ROW, TITLE_ROW_START, TITLE_ROWS, BODY_ROW_START, BODY_ROWS, FOOTER_ROW, rowY, TEXT_X, TEXT_COLS } from "./layout.js";
import { cpLength, cpSlice, shortDayTime } from "./text.js";

// Page 100 is generated, not authored: renderFrontpage draws the whole
// thing (header, banner slot, listing, footer) as one pure function of
// live-page summaries and board state — no store/HTTP access here. `now` is
// the one extra render input beyond the determinism contract's usual two
// (expiry, batteryLow): the header's date string changes once a day, which
// is an intentional, documented part of P100's determinism (finding M8).

const ROW_WIDTH = COLS * CELL_WIDTH;
const LISTING_ROWS = BODY_ROWS - 1; // the last body row always stays blank, separating the list from the footer (m19)
const TITLE_FIELD = 34; // ~34-column title budget, M21
const TIME_FIELD = 9; // "Sat 22:51"
const RED_INDEX = 4; // palette.js's fixed red index — urgent rows are literally red, independent of theme

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(now) {
    const d = new Date(now);
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function rightAlignX(text) {
    return TEXT_X + (TEXT_COLS - cpLength(text)) * CELL_WIDTH;
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

export function footerText(bannerKind, board, liveSummaries) {
    if (board.batteryLow && bannerKind === "urgent") return "LOW BATTERY";
    if (liveSummaries.length === 0) return "no pages yet";
    const first = liveSummaries[0];
    return `next » ${first.number} ${first.title}`;
}

function drawHeader(fb, theme, now) {
    fillRect(fb, 0, rowY(HEADER_ROW), ROW_WIDTH, CELL_HEIGHT, theme.background);
    const y = rowY(HEADER_ROW);
    drawText(fb, TEXT_X, y, "P100", theme.accent);
    drawText(fb, TEXT_X + 4 * CELL_WIDTH, y, "  VIDEOTEXT", theme.foreground);
    const dateStr = formatDate(now);
    drawText(fb, rightAlignX(dateStr), y, dateStr, theme.foreground);
}

// Urgent newsflash shows "» <page>" right-aligned after the title (m18);
// the empty-P100 state (nothing posted since flashing) gets its own
// double-height message rather than silently looking like a blank/broken
// screen (M22).
function drawBanner(fb, theme, bannerKind, urgentPage) {
    const bannerY = rowY(TITLE_ROW_START);
    const bannerH = TITLE_ROWS * CELL_HEIGHT;
    if (bannerKind === "urgent") {
        fillRect(fb, 0, bannerY, ROW_WIDTH, bannerH, theme.tags.red.bg);
        const pageLabel = `» ${urgentPage.number}`;
        const titleWidth = Math.max(0, TEXT_COLS - cpLength(pageLabel) - 1);
        drawText(fb, TEXT_X, bannerY, cpSlice(urgentPage.title, 0, titleWidth), theme.tags.red.fg, { doubleHeight: true });
        drawText(fb, rightAlignX(pageLabel), bannerY, pageLabel, theme.tags.red.fg, { doubleHeight: true });
    } else if (bannerKind === "empty") {
        fillRect(fb, 0, bannerY, ROW_WIDTH, bannerH, theme.background);
        drawText(fb, TEXT_X, bannerY, "Nothing posted", theme.foreground, { doubleHeight: true });
    } else if (bannerKind === "battery") {
        fillRect(fb, 0, bannerY, ROW_WIDTH, bannerH, theme.tags.yellow.bg);
        drawText(fb, TEXT_X, bannerY, "LOW BATTERY", theme.tags.yellow.fg, { doubleHeight: true });
    } else {
        fillRect(fb, 0, bannerY, ROW_WIDTH, bannerH, theme.background);
    }
}

// A thin strip of all 7 panel colours side by side — shown once, in place
// of the (otherwise empty) listing, on a freshly-flashed board with nothing
// posted yet. Doubles as an at-a-glance colour check (M22).
function drawColorStripe(fb, y, height) {
    const segmentWidth = Math.floor(ROW_WIDTH / 7);
    let x = 0;
    for (let i = 0; i < 7; i++) {
        const w = i === 6 ? ROW_WIDTH - x : segmentWidth;
        fillRect(fb, x, y, w, height, i);
        x += w;
    }
}

// One listing row: page number in the accent colour (red if that page is
// itself urgent), title cut to 34 columns with a dot leader, posted day+time
// right-aligned in the last 9 columns (M21). No body snippet — the title is
// what shows on the front page.
function drawListingRow(fb, theme, y, page) {
    drawText(fb, TEXT_X, y, String(page.number), page.urgent ? RED_INDEX : theme.accent);

    const title = cpSlice(page.title, 0, TITLE_FIELD);
    const dots = ".".repeat(Math.max(0, TITLE_FIELD - cpLength(title)));
    drawText(fb, TEXT_X + 4 * CELL_WIDTH, y, title + dots, theme.foreground);

    const time = shortDayTime(page.postedDisplay);
    drawText(fb, TEXT_X + (TEXT_COLS - TIME_FIELD) * CELL_WIDTH, y, time, theme.foreground);
}

function drawListing(fb, theme, liveSummaries, bannerKind) {
    const overflow = liveSummaries.length > LISTING_ROWS;
    const shown = overflow ? liveSummaries.slice(0, LISTING_ROWS - 1) : liveSummaries;
    for (let i = 0; i < BODY_ROWS; i++) {
        const y = rowY(BODY_ROW_START + i);
        fillRect(fb, 0, y, ROW_WIDTH, CELL_HEIGHT, theme.background);
        if (bannerKind === "empty") {
            if (i === 0) drawColorStripe(fb, y, BORDER);
            continue;
        }
        if (i >= LISTING_ROWS) continue; // the reserved blank separator row
        if (i < shown.length) {
            drawListingRow(fb, theme, y, shown[i]);
        } else if (overflow && i === LISTING_ROWS - 1) {
            drawText(fb, TEXT_X, y, `+${liveSummaries.length - shown.length} more`, theme.foreground);
        }
    }
}

export function renderFrontpage(fb, theme, { liveSummaries, board, now }) {
    drawHeader(fb, theme, now);

    const urgentPage = bannerPage(liveSummaries);
    // Priority: an urgent newsflash or a low-battery warning are both
    // actionable and win over the purely decorative "nothing posted yet"
    // screen, which only shows when the board is otherwise unremarkable.
    const bannerKind = urgentPage ? "urgent" : board.batteryLow ? "battery" : liveSummaries.length === 0 ? "empty" : "blank";
    drawBanner(fb, theme, bannerKind, urgentPage);

    drawListing(fb, theme, liveSummaries, bannerKind);

    const footerY = rowY(FOOTER_ROW);
    fillRect(fb, 0, footerY, ROW_WIDTH, CELL_HEIGHT, theme.background);
    drawText(fb, TEXT_X, footerY, footerText(bannerKind, board, liveSummaries), theme.foreground);
}
