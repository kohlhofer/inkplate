import { createHash } from "node:crypto";
import { PANEL_WIDTH, PANEL_HEIGHT, COLS, CELL_WIDTH, CELL_HEIGHT, createFramebuffer, fillRect, packTo4bpp } from "./grid.js";
import { drawText, drawGlyph } from "./glyphs.js";
import { drawProcedural, isProceduralCodepoint } from "./procedural.js";
import { parse as parseMarkup } from "./markup.js";
import { wrap } from "./wrap.js";
import { regionsFor, rowY, HEADER_ROW, TITLE_ROW_START, TITLE_ROWS, FOOTER_ROW, TEXT_X, TEXT_COLS } from "./layout.js";
import { renderFrontpage } from "./frontpage.js";
import { drawChart, splitChartRows } from "./chart.js";
import { cpLength, cpSlice, shortDayTime } from "./text.js";

// Inkplate palette order (see CLAUDE.md): 0 black, 1 white, 2 green, 3 blue,
// 4 red, 5 yellow, 6 orange. 448/7 divides exactly, so the bars are even.
const BAR_COLORS = [0, 1, 2, 3, 4, 5, 6];
const BAR_HEIGHT = PANEL_HEIGHT / BAR_COLORS.length;

// Deterministic, store-free pattern used as the /frame payload before the
// real render pipeline exists, and as the documented legibility fixture.
export function testcard() {
    const fb = createFramebuffer();
    for (let i = 0; i < BAR_COLORS.length; i++) {
        fillRect(fb, 0, i * BAR_HEIGHT, PANEL_WIDTH, BAR_HEIGHT, BAR_COLORS[i]);
    }
    return packTo4bpp(fb);
}

const ROW_WIDTH = COLS * CELL_WIDTH;

function fillRow(fb, row, height, colorIndex) {
    fillRect(fb, 0, rowY(row), ROW_WIDTH, height, colorIndex);
}

function rightAlignX(text) {
    return TEXT_X + (TEXT_COLS - cpLength(text)) * CELL_WIDTH;
}

// A tag names a panel colour; block art drawn under a tag uses that colour as
// ink rather than sitting on a band of it.
const TAG_INK = { black: 0, white: 1, green: 2, blue: 3, red: 4, yellow: 5, orange: 6 };

// Padding a band takes out of the neighbouring space cell on each side. Less
// than half a cell, so two banded words one space apart keep a visible gap.
const BAND_PAD = 4;

function isGraphicText(text) {
    let sawGraphic = false;
    for (const ch of text) {
        if (ch === " ") continue;
        if (!isProceduralCodepoint(ch.codePointAt(0))) return false;
        sawGraphic = true;
    }
    return sawGraphic;
}

// Draws one wrapped row of markup spans. A tagged span of text gets a band in
// the tag's colour; a tagged span made only of block, box or sextant
// characters is drawn in the tag's colour on the page background instead.
// All bands are painted before any glyph, so a band's padding can never erase
// a neighbouring character, and padding only reaches into a bordering space
// or past the row's ends.
function drawSpans(fb, x0, y, spans, theme, options = {}) {
    const height = options.doubleHeight ? CELL_HEIGHT * 2 : CELL_HEIGHT;
    const placed = [];
    let x = x0;
    for (const span of spans) {
        const tagColor = span.tag ? theme.tags[span.tag] : null;
        const graphic = tagColor != null && isGraphicText(span.text);
        placed.push({ span, x, tagColor, graphic });
        x += cpLength(span.text) * CELL_WIDTH;
    }

    for (let i = 0; i < placed.length; i++) {
        const { span, x: spanX, tagColor, graphic } = placed[i];
        if (!tagColor || graphic) continue;
        const prev = spans[i - 1];
        const next = spans[i + 1];
        const padLeft = !prev || (prev.tag == null && prev.text.endsWith(" ")) ? BAND_PAD : 0;
        const padRight = !next || (next.tag == null && next.text.startsWith(" ")) ? BAND_PAD : 0;
        const width = cpLength(span.text) * CELL_WIDTH;
        fillRect(fb, spanX - padLeft, y, width + padLeft + padRight, height, tagColor.bg);
    }

    for (const { span, x: spanX, tagColor, graphic } of placed) {
        const fg = graphic ? TAG_INK[span.tag] : tagColor ? tagColor.fg : theme.foreground;
        let cx = spanX;
        for (const ch of span.text) {
            const codepoint = ch.codePointAt(0);
            if (!drawProcedural(fb, cx, y, codepoint, fg)) {
                drawGlyph(fb, cx, y, codepoint, fg, options);
            }
            cx += CELL_WIDTH;
        }
    }
}

function drawImage(fb, region, image) {
    if (!image) return;
    const offsetX = region.x + Math.floor((region.w - image.width) / 2);
    const offsetY = region.y + Math.floor((region.h - image.height) / 2);
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            fb[(offsetY + y) * PANEL_WIDTH + (offsetX + x)] = image.pixels[y * image.width + x];
        }
    }
}

// Header row (M20): page number in the theme's accent colour, sender name,
// posted date/time right-aligned — all inset one cell (M19).
function drawHeader(fb, theme, page) {
    fillRow(fb, HEADER_ROW, CELL_HEIGHT, theme.background);
    const y = rowY(HEADER_ROW);
    const numberStr = String(page.number);
    drawText(fb, TEXT_X, y, numberStr, theme.accent);
    drawText(fb, TEXT_X + cpLength(numberStr) * CELL_WIDTH, y, `  ${page.sender}`, theme.foreground);
    drawText(fb, rightAlignX(page.postedDisplay), y, page.postedDisplay, theme.foreground);
}

// Footer, real pages (M17/i4/m15): left "<i>/<N> · next » <page> <title>"
// (or "next » 100 front page" past the last live page), right "expires
// <day> <HH:MM>" (the short day+time form, same as the P100 listing's
// M21 format — the full display doesn't leave enough of the 48-column
// budget for the left side on a single-page board), both cut to fit.
function drawFooter(fb, theme, page, liveSummaries) {
    fillRow(fb, FOOTER_ROW, CELL_HEIGHT, theme.background);
    const idx = liveSummaries.findIndex((p) => p.number === page.number);
    const next = liveSummaries[idx + 1];
    const nextLabel = next ? `${next.number} ${next.title}` : "100 front page";
    const rightText = `expires ${shortDayTime(page.expiresDisplay)}`;
    const leftBudget = Math.max(0, TEXT_COLS - cpLength(rightText) - 1);
    let leftText = `${idx + 1}/${liveSummaries.length} · next » ${nextLabel}`;
    if (cpLength(leftText) > leftBudget) leftText = cpSlice(leftText, 0, leftBudget);

    const y = rowY(FOOTER_ROW);
    drawText(fb, TEXT_X, y, leftText, theme.foreground);
    drawText(fb, rightAlignX(rightText), y, rightText, theme.foreground);
}

function renderRealPage(fb, theme, page, liveSummaries) {
    drawHeader(fb, theme, page);

    fillRow(fb, TITLE_ROW_START, TITLE_ROWS * CELL_HEIGHT, theme.background);
    const title = cpSlice(page.title, 0, TEXT_COLS);
    drawText(fb, TEXT_X, rowY(TITLE_ROW_START), title, theme.accent, { doubleHeight: true });

    const regions = regionsFor(page.layout);
    if (regions.image) drawImage(fb, regions.image, page.image);

    if (page.layout === "image") {
        fillRow(fb, regions.caption.rowStart, CELL_HEIGHT, theme.background);
        const captionLine = cpSlice(page.body.split("\n")[0] ?? "", 0, regions.caption.colSpan);
        drawText(fb, regions.caption.x, rowY(regions.caption.rowStart), captionLine, theme.foreground);
    } else if (regions.text) {
        // Clears only the text region's own columns, not the full row width
        // (fillRow's fillRect(0,...,ROW_WIDTH,...)): image-left's image and
        // text share the same rows, and a full-width clear here was wiping
        // out the image drawImage() had just painted to its left.
        for (let i = 0; i < regions.text.rowSpan; i++) {
            fillRect(fb, regions.text.x, rowY(regions.text.rowStart + i), regions.text.w, CELL_HEIGHT, theme.background);
        }
        let textRowStart = regions.text.rowStart;
        let textRows = regions.text.rowSpan;
        const { lines } = parseMarkup(page.body);
        if (page.chart) {
            const naturalBodyRows = page.body.trim()
                ? wrap(lines, regions.text.colSpan, regions.text.rowSpan).rows.length
                : 0;
            const { labelRows, chartRows, bodyRows } = splitChartRows({
                hasLabel: !!page.chart.label,
                naturalBodyRows,
                regionRows: regions.text.rowSpan,
            });
            let chartY = rowY(regions.text.rowStart);
            if (page.chart.label) {
                drawText(fb, regions.text.x, chartY, cpSlice(page.chart.label, 0, regions.text.colSpan), theme.foreground);
                chartY += CELL_HEIGHT;
            }
            drawChart(fb, { x: regions.text.x, y: chartY, w: regions.text.w, h: chartRows * CELL_HEIGHT }, page.chart, theme);
            textRowStart = regions.text.rowStart + labelRows + chartRows + 1; // +1: mandatory blank separator row
            textRows = bodyRows;
        }
        const { rows } = wrap(lines, regions.text.colSpan, Math.max(0, textRows));
        for (let i = 0; i < rows.length; i++) {
            drawSpans(fb, regions.text.x, rowY(textRowStart + i), rows[i], theme);
        }
    }

    drawFooter(fb, theme, page, liveSummaries);
}

// renderFrame(pageNumber, storeSnapshot, boardSnapshot, theme, now) is pure
// given fixed inputs: `now` only reaches this function indirectly, through
// which pages storeSnapshot.liveSummaries already considers live and
// boardSnapshot.batteryLow's current value (both decided upstream by
// store.js/board.js) — see the plan's determinism contract (2.7). P100's
// header additionally takes the relay's current date (see frontpage.js) —
// documented there as the one other render input besides expiry/batteryLow.
export function renderFrame(pageNumber, storeSnapshot, boardSnapshot, theme, now) {
    const fb = createFramebuffer();
    fb.fill(theme.background);

    if (pageNumber === 100) {
        renderFrontpage(fb, theme, { liveSummaries: storeSnapshot.liveSummaries, board: boardSnapshot, now });
    } else {
        renderRealPage(fb, theme, storeSnapshot.page, storeSnapshot.liveSummaries);
    }

    const bytes = packTo4bpp(fb);
    const etag = createHash("sha256").update(bytes).digest("hex");
    return { bytes, etag, indices: fb };
}
