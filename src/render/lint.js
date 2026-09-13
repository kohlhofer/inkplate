import { parse } from "./markup.js";
import { wrap } from "./wrap.js";
import { regionsFor, TEXT_COLS } from "./layout.js";
import { splitChartRows } from "./chart.js";
import { cpLength, cpSlice } from "./text.js";

// Runs the theme-independent parts of the render pipeline once, at POST
// time, to produce the 201 response's warnings[] — wrapping/truncation
// don't depend on theme colours, so one pass covers both themes. Not
// persisted: a viewer can always re-derive it from the stored page.
export const TITLE_MAX = TEXT_COLS; // 48 — the true render width (M19), not a separate storage cap

export function lint({ title, body, layout, chart }) {
    const warnings = [];

    let cutTitle = title;
    if (cpLength(cutTitle) > TITLE_MAX) {
        cutTitle = cpSlice(cutTitle, 0, TITLE_MAX);
        warnings.push("title cut");
    }

    const regions = regionsFor(layout);
    if (layout === "image") {
        // Only a 1-line caption is kept; anything past the first line, or a
        // first line wider than the caption region, is silently dropped at
        // render time.
        const lines = body.split("\n");
        if (lines.length > 1 || cpLength(lines[0]) > TEXT_COLS) {
            warnings.push("extra body lines dropped (image layout keeps only a caption)");
        }
    } else if (regions.text) {
        const { lines, warnings: markupWarnings } = parse(body);
        // A chart (if present) claims some of the region's rows before the
        // body gets any (finding m1: lint used to wrap against the full row
        // count even on chart pages, so the truncation warning never fired
        // even though the render itself gave the body far fewer rows).
        let rowBudget = regions.text.rowSpan;
        if (chart) {
            const naturalBodyRows = body.trim() ? wrap(lines, regions.text.colSpan, regions.text.rowSpan).rows.length : 0;
            ({ bodyRows: rowBudget } = splitChartRows({
                hasLabel: !!chart.label,
                naturalBodyRows,
                regionRows: regions.text.rowSpan,
            }));
        }
        const { warnings: wrapWarnings } = wrap(lines, regions.text.colSpan, rowBudget);
        warnings.push(...markupWarnings, ...wrapWarnings);
    }

    return { title: cutTitle, warnings };
}
