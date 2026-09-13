import { createHash } from "node:crypto";
import { PANEL_WIDTH, PANEL_HEIGHT, COLS, CELL_WIDTH, CELL_HEIGHT, createFramebuffer, fillRect, packTo4bpp } from "./grid.js";
import { drawText, drawGlyph } from "./glyphs.js";
import { drawProcedural } from "./procedural.js";
import { parse as parseMarkup } from "./markup.js";
import { wrap } from "./wrap.js";
import { regionsFor, rowY, HEADER_ROW, TITLE_ROW_START, TITLE_ROWS, BODY_ROW_START, FOOTER_ROW } from "./layout.js";
import { renderFrontpage } from "./frontpage.js";
import { drawChart } from "./chart.js";

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
// Not specified by the plan beyond "chart requires layout:text": a fixed
// band at the top of the text region is reserved for the chart (plus its
// optional label), and wrapped body text fills the rows below it.
const CHART_ROWS = 4;

function fillRow(fb, row, height, colorIndex) {
    fillRect(fb, 0, rowY(row), ROW_WIDTH, height, colorIndex);
}

// Draws one wrapped row of markup spans, resolving each span's colour tag
// against the theme and falling back from procedural mosaic glyphs to font
// glyphs per character.
function drawSpans(fb, x0, y, spans, theme, options = {}) {
    let x = x0;
    const height = options.doubleHeight ? CELL_HEIGHT * 2 : CELL_HEIGHT;
    for (const span of spans) {
        const tagColor = span.tag ? theme.tags[span.tag] : null;
        const fg = tagColor ? tagColor.fg : theme.foreground;
        if (tagColor) fillRect(fb, x, y, span.text.length * CELL_WIDTH, height, tagColor.bg);
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

function renderRealPage(fb, theme, page, liveSummaries) {
    fillRow(fb, HEADER_ROW, CELL_HEIGHT, theme.background);
    drawText(fb, 0, rowY(HEADER_ROW), `${page.number}  ${page.sender}  ${page.postedDisplay}`, theme.foreground);

    fillRow(fb, TITLE_ROW_START, TITLE_ROWS * CELL_HEIGHT, theme.background);
    drawText(fb, 0, rowY(TITLE_ROW_START), page.title, theme.foreground, { doubleHeight: true });

    const regions = regionsFor(page.layout);
    if (regions.image) drawImage(fb, regions.image, page.image);

    if (page.layout === "image") {
        fillRow(fb, regions.caption.rowStart, CELL_HEIGHT, theme.background);
        const captionLine = (page.body.split("\n")[0] ?? "").slice(0, COLS);
        drawText(fb, 0, rowY(regions.caption.rowStart), captionLine, theme.foreground);
    } else if (regions.text) {
        for (let i = 0; i < regions.text.rowSpan; i++) {
            fillRow(fb, regions.text.rowStart + i, CELL_HEIGHT, theme.background);
        }
        let textRowStart = regions.text.rowStart;
        let textRows = regions.text.rowSpan;
        if (page.chart) {
            const chartRowStart = regions.text.rowStart;
            let chartY = rowY(chartRowStart);
            let chartRows = CHART_ROWS;
            if (page.chart.label) {
                drawText(fb, regions.text.x, chartY, page.chart.label.slice(0, regions.text.colSpan), theme.foreground);
                chartY += CELL_HEIGHT;
                chartRows -= 1;
            }
            drawChart(
                fb,
                { x: regions.text.x, y: chartY, w: regions.text.w, h: chartRows * CELL_HEIGHT },
                page.chart,
                theme.foreground,
            );
            textRowStart = chartRowStart + CHART_ROWS;
            textRows = regions.text.rowSpan - CHART_ROWS;
        }
        const { lines } = parseMarkup(page.body);
        const { rows } = wrap(lines, regions.text.colSpan, Math.max(0, textRows));
        for (let i = 0; i < rows.length; i++) {
            drawSpans(fb, regions.text.x, rowY(textRowStart + i), rows[i], theme);
        }
    }

    const footerY = rowY(FOOTER_ROW);
    fillRow(fb, FOOTER_ROW, CELL_HEIGHT, theme.background);
    const position = liveSummaries.findIndex((p) => p.number === page.number) + 1;
    const footer = `${position}/${liveSummaries.length} · button: next · until ${page.expiresDisplay}`;
    drawText(fb, 0, footerY, footer, theme.foreground);
}

// renderFrame(pageNumber, storeSnapshot, boardSnapshot, theme, now) is pure
// given fixed inputs: `now` only reaches this function indirectly, through
// which pages storeSnapshot.liveSummaries already considers live and
// boardSnapshot.batteryLow's current value (both decided upstream by
// store.js/board.js) — see the plan's determinism contract (2.7).
export function renderFrame(pageNumber, storeSnapshot, boardSnapshot, theme) {
    const fb = createFramebuffer();
    fb.fill(theme.background);

    if (pageNumber === 100) {
        renderFrontpage(fb, theme, { liveSummaries: storeSnapshot.liveSummaries, board: boardSnapshot });
    } else {
        renderRealPage(fb, theme, storeSnapshot.page, storeSnapshot.liveSummaries);
    }

    const bytes = packTo4bpp(fb);
    const etag = createHash("sha256").update(bytes).digest("hex");
    return { bytes, etag };
}
