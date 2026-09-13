import { parse } from "./markup.js";
import { wrap } from "./wrap.js";
import { regionsFor } from "./layout.js";

// Runs the theme-independent parts of the render pipeline once, at POST
// time, to produce the 201 response's warnings[] — wrapping/truncation
// don't depend on theme colours, so one pass covers both themes. Not
// persisted: a viewer can always re-derive it from the stored page.
export const TITLE_MAX = 50;

export function lint({ title, body, layout }) {
    const warnings = [];

    let cutTitle = title;
    if (cutTitle.length > TITLE_MAX) {
        cutTitle = cutTitle.slice(0, TITLE_MAX);
        warnings.push("title cut");
    }

    const regions = regionsFor(layout);
    if (layout === "image") {
        // Only a 1-line caption is kept; anything past the first line, or a
        // first line wider than the panel, is silently dropped at render time.
        const lines = body.split("\n");
        if (lines.length > 1 || lines[0].length > 50) {
            warnings.push("extra body lines dropped (image layout keeps only a caption)");
        }
    } else if (regions.text) {
        const { lines, warnings: markupWarnings } = parse(body);
        const { warnings: wrapWarnings } = wrap(lines, regions.text.colSpan, regions.text.rowSpan);
        warnings.push(...markupWarnings, ...wrapWarnings);
    }

    return { title: cutTitle, warnings };
}
