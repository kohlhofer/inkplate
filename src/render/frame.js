import { createHash } from "node:crypto";
import { PANEL_WIDTH, PANEL_HEIGHT, COLS, CELL_WIDTH, CELL_HEIGHT, createFramebuffer, fillRect, packTo4bpp } from "./grid.js";
import { drawText, drawGlyph } from "./glyphs.js";
import { drawProcedural } from "./procedural.js";
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

// Draws one wrapped row of markup spans, resolving each span's colour tag
// against the theme and falling back from procedural mosaic glyphs to font
// glyphs per character. A tagged span's background band gets one cell of
// padding on the side(s) that border plain (untagged) text — never into a
// neighbouring *tagged* span, which would just paint over it — so an
// isolated coloured word reads as a band with breathing room instead of a
// tight box (finding m16).
function drawSpans(fb, x0, y, spans, theme, options = {}) {
    let x = x0;
    const height = options.doubleHeight ? CELL_HEIGHT * 2 : CELL_HEIGHT;
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        const tagColor = span.tag ? theme.tags[span.tag] : null;
        const fg = tagColor ? tagColor.fg : theme.foreground;
        const textWidth = cpLength(span.text) * CELL_WIDTH;
        if (tagColor) {
            const padLeft = i > 0 && spans[i - 1].tag != null ? 0 : CELL_WIDTH;
            const padRight = i < spans.length - 1 && spans[i + 1].tag != null ? 0 : CELL_WIDTH;
            fillRect(fb, x - padLeft, y, textWidth + padLeft + padRight, height, tagColor.bg);
        }
        for (const ch of span.text) {
            const codepoint = ch.codePointAt(0);
            if (!drawProcedural(fb, x, y, codepoint, fg)) {
                drawGlyph(fb, x, y, codepoint, fg, options);
            }
            x += CELL_WIDTH;
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
