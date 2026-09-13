// Greedy word wrap over markup.parse's spans, plus vertical truncation to a
// row budget. Tag spans cost 0 columns on their own — only the visible text
// in each span counts toward line width, since colour markers are already
// stripped out by markup.js. Fenced lines are never wrapped, only cropped.

function flattenChars(spans) {
    const chars = [];
    for (const span of spans) {
        for (const ch of span.text) chars.push({ ch, tag: span.tag });
    }
    return chars;
}

function charsToSpans(chars) {
    const spans = [];
    let current = null;
    for (const c of chars) {
        if (current && current.tag === c.tag) {
            current.text += c.ch;
        } else {
            current = { text: c.ch, tag: c.tag };
            spans.push(current);
        }
    }
    return spans;
}

function splitWords(chars) {
    const words = [];
    let current = [];
    for (const c of chars) {
        if (c.ch === " ") {
            if (current.length > 0) {
                words.push(current);
                current = [];
            }
        } else {
            current.push(c);
        }
    }
    if (current.length > 0) words.push(current);
    return words;
}

function packWords(words, columns) {
    const rows = [];
    let currentRow = [];
    let currentWidth = 0;

    for (let word of words) {
        while (word.length > columns) {
            if (currentRow.length > 0) {
                rows.push(currentRow);
                currentRow = [];
                currentWidth = 0;
            }
            rows.push(word.slice(0, columns));
            word = word.slice(columns);
        }
        if (word.length === 0) continue;

        const neededWidth = currentWidth === 0 ? word.length : currentWidth + 1 + word.length;
        if (neededWidth > columns) {
            rows.push(currentRow);
            currentRow = [...word];
            currentWidth = word.length;
        } else {
            // The inter-word space is always untagged (finding m16): it used
            // to take the *next* word's tag, which coloured one cell of
            // padding on the left of a tagged word but not the right,
            // reading as lopsided band padding.
            if (currentWidth > 0) currentRow.push({ ch: " ", tag: null });
            currentRow.push(...word);
            currentWidth = neededWidth;
        }
    }
    if (currentRow.length > 0 || rows.length === 0) rows.push(currentRow);
    return rows;
}

export function wrap(parsedLines, columns, maxRows) {
    const warnings = [];
    const outRows = [];
    let croppedFences = 0;

    for (const line of parsedLines) {
        const chars = flattenChars(line.spans);
        if (line.fenced) {
            let rowChars = chars;
            if (rowChars.length > columns) {
                rowChars = rowChars.slice(0, columns);
                croppedFences++;
            }
            outRows.push(charsToSpans(rowChars));
        } else {
            for (const rowChars of packWords(splitWords(chars), columns)) {
                outRows.push(charsToSpans(rowChars));
            }
        }
    }

    if (croppedFences > 0) warnings.push(`${croppedFences} fenced line(s) cropped`);

    let rows = outRows;
    if (rows.length > maxRows) {
        const truncated = rows.length - maxRows;
        rows = rows.slice(0, maxRows);
        warnings.push(`${truncated} lines truncated`);
    }

    return { rows, warnings };
}
