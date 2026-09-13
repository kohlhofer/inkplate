import { fillRect, CELL_HEIGHT, CELL_WIDTH } from "./grid.js";
import { drawText } from "./glyphs.js";
import { cpLength } from "./text.js";

// Draws a chart into a pixel rect: whole CELL_HEIGHT-tall cells in the
// theme's foreground, topped by a sub-cell (eighth-height granularity)
// accent-coloured cap for the fractional remainder — cell-snapped bars read
// cleanly on the panel instead of the old pixel-exact heights, which gave a
// ragged, non-grid-aligned edge (finding M23). "spark" packs columns
// edge-to-edge and scales min→max (so a flat-ish series doesn't render as a
// solid slab); "bars" leaves a 1px gap between columns and stays 0-based,
// since a bar chart's zero baseline is meaningful in a way a line chart's
// isn't.
const MIN_MAX_LABEL_ROWS = 1; // reserved at top/bottom of the rect for spark's labels

function eighthHeight(eighths) {
    return Math.round((CELL_HEIGHT * eighths) / 8);
}

function formatChartValue(v) {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export const MIN_CHART_ROWS = 3;
export const CHART_BLANK_SEPARATOR_ROWS = 1;

// Splits a text region's rows between a chart and the body text that
// follows it: the chart gets every row the body doesn't actually need
// (finding M23's "grow into free rows", fixing a fixed 4-row chart jammed
// against the body with 9 empty rows below it), subject to a minimum chart
// height and a mandatory blank row between chart and body. Never wraps text
// itself — `naturalBodyRows` is however many rows the body would need if it
// had the *whole* region, which only the caller (frame.js/lint.js, via
// wrap.js) can compute, since that depends on the column budget.
export function splitChartRows({ hasLabel, naturalBodyRows, regionRows }) {
    const labelRows = hasLabel ? 1 : 0;
    const available = regionRows - labelRows;
    const chartRows = Math.max(MIN_CHART_ROWS, available - CHART_BLANK_SEPARATOR_ROWS - naturalBodyRows);
    const bodyRows = Math.max(0, available - CHART_BLANK_SEPARATOR_ROWS - chartRows);
    return { labelRows, chartRows, bodyRows };
}

export function drawChart(fb, rect, chart, theme) {
    const { values, type } = chart;
    const n = values.length;
    if (n === 0) return;

    const showMinMax = type === "spark";
    const labelRows = showMinMax ? MIN_MAX_LABEL_ROWS : 0;
    const barTop = rect.y + labelRows * CELL_HEIGHT;
    const barHeight = Math.max(CELL_HEIGHT, rect.h - labelRows * 2 * CELL_HEIGHT);
    const rows = Math.max(1, Math.round(barHeight / CELL_HEIGHT));

    const gap = type === "bars" ? 1 : 0;
    const colWidth = Math.max(1, Math.floor((rect.w - gap * (n - 1)) / n));

    const min = type === "spark" ? Math.min(...values) : 0;
    const max = Math.max(min + 1, ...values); // +1 floor avoids a div-by-zero on a flat series
    const range = max - min;

    let x = rect.x;
    for (const raw of values) {
        const value = Math.max(min, raw);
        const fraction = (value - min) / range; // 0..1
        const eighths = Math.round(fraction * rows * 8);
        const wholeCells = Math.floor(eighths / 8);
        const remainder = eighths % 8;

        if (wholeCells > 0) {
            fillRect(fb, x, barTop + barHeight - wholeCells * CELL_HEIGHT, colWidth, wholeCells * CELL_HEIGHT, theme.foreground);
        }
        if (remainder > 0) {
            const h = eighthHeight(remainder);
            fillRect(fb, x, barTop + barHeight - wholeCells * CELL_HEIGHT - h, colWidth, h, theme.accent);
        }
        x += colWidth + gap;
    }

    if (showMinMax) {
        const maxLabel = formatChartValue(max);
        const minLabel = formatChartValue(min);
        drawText(fb, rect.x + rect.w - cpLength(maxLabel) * CELL_WIDTH, rect.y, maxLabel, theme.foreground);
        drawText(fb, rect.x + rect.w - cpLength(minLabel) * CELL_WIDTH, rect.y + rect.h - CELL_HEIGHT, minLabel, theme.foreground);
    }
}
