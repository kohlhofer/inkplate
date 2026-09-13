import { fillRect, CELL_HEIGHT, CELL_WIDTH } from "./grid.js";
import { drawText } from "./glyphs.js";
import { cpLength } from "./text.js";

// Draws a chart into a pixel rect. Every column is one solid block of the
// theme's accent colour, its height quantised to eighths of a cell. "spark"
// packs columns edge to edge and scales min→max, with the minimum kept as a
// one-eighth stub so no reading disappears; "bars" stays 0-based with a 3 px
// gap, since a bar chart's zero baseline means something. Column widths snap
// to whole cells once they are at least a cell wide, and a series wider than
// the rect is averaged down to fit.
const MIN_MAX_LABEL_ROWS = 1; // reserved at top/bottom of the rect for spark's labels
const BAR_GAP = 3;

function eighthHeight(eighths) {
    return Math.round((CELL_HEIGHT * eighths) / 8);
}

function bucket(values, maxColumns) {
    if (values.length <= maxColumns) return values;
    const out = [];
    for (let i = 0; i < maxColumns; i++) {
        const start = Math.floor((i * values.length) / maxColumns);
        const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / maxColumns));
        let sum = 0;
        for (let j = start; j < end; j++) sum += values[j];
        out.push(sum / (end - start));
    }
    return out;
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
// When there is body text, one row is also left free under it so the last body
// line doesn't sit directly on the footer.
export function splitChartRows({ hasLabel, naturalBodyRows, regionRows }) {
    const labelRows = hasLabel ? 1 : 0;
    const available = regionRows - labelRows;
    const trailingBlank = naturalBodyRows > 0 ? 1 : 0;
    const chartRows = Math.max(MIN_CHART_ROWS, available - CHART_BLANK_SEPARATOR_ROWS - naturalBodyRows - trailingBlank);
    const bodyRows = Math.max(0, available - CHART_BLANK_SEPARATOR_ROWS - chartRows);
    return { labelRows, chartRows, bodyRows };
}

export function drawChart(fb, rect, chart, theme) {
    const { type } = chart;
    if (chart.values.length === 0) return;

    const spark = type === "spark";
    const gap = spark ? 0 : BAR_GAP;
    const values = bucket(chart.values, spark ? rect.w : Math.floor((rect.w + gap) / (1 + gap)));
    const n = values.length;

    const labelRows = spark ? MIN_MAX_LABEL_ROWS : 0;
    const barTop = rect.y + labelRows * CELL_HEIGHT;
    const barHeight = Math.max(CELL_HEIGHT, rect.h - labelRows * 2 * CELL_HEIGHT);
    const rows = Math.max(1, Math.round(barHeight / CELL_HEIGHT));

    let colWidth = Math.max(1, Math.floor((rect.w - gap * (n - 1)) / n));
    if (colWidth >= CELL_WIDTH) colWidth -= colWidth % CELL_WIDTH;

    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const min = spark ? dataMin : Math.min(0, dataMin);
    const range = dataMax - min || 1;

    let x = rect.x;
    for (const raw of values) {
        const fraction = (Math.max(min, raw) - min) / range; // 0..1
        let eighths = Math.round(fraction * rows * 8);
        if (spark) eighths = Math.max(1, eighths);
        if (eighths > 0) {
            const h = eighthHeight(eighths);
            fillRect(fb, x, barTop + barHeight - h, colWidth, h, theme.accent);
        }
        x += colWidth + gap;
    }

    if (spark) {
        const maxLabel = formatChartValue(dataMax);
        const minLabel = formatChartValue(dataMin);
        drawText(fb, rect.x + rect.w - cpLength(maxLabel) * CELL_WIDTH, rect.y, maxLabel, theme.foreground);
        drawText(fb, rect.x + rect.w - cpLength(minLabel) * CELL_WIDTH, rect.y + rect.h - CELL_HEIGHT, minLabel, theme.foreground);
    }
}
