import { fillRect } from "./grid.js";

// Draws a chart into a pixel rect as solid columns in the palette —
// deliberately plain (no axes/gridlines) to stay legible at panel size.
// "spark" packs columns edge-to-edge; "bars" leaves a 1px gap between them.
// Values scale against their own max (floored at 1 to avoid div-by-zero on
// all-zero data); negative values clip to a zero-height column.
export function drawChart(fb, rect, chart, fgIndex) {
    const { values } = chart;
    const n = values.length;
    if (n === 0) return;

    const gap = chart.type === "bars" ? 1 : 0;
    const colWidth = Math.max(1, Math.floor((rect.w - gap * (n - 1)) / n));
    const max = Math.max(1, ...values);

    let x = rect.x;
    for (const raw of values) {
        const value = Math.max(0, raw);
        const height = Math.round((value / max) * rect.h);
        if (height > 0) {
            fillRect(fb, x, rect.y + rect.h - height, colWidth, height, fgIndex);
        }
        x += colWidth + gap;
    }
}
