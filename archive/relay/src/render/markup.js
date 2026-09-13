// Body markup grammar: {red}{green}{blue}{yellow}{orange}{white}{black} set
// the active colour tag; {/} resets to the default. Unknown {word} tags are
// literal (rendered with the braces) and reported as a warning, deduplicated
// so a repeated typo doesn't spam the sender. Newlines are hard breaks.
// Fenced ``` blocks toggle a non-wrapping mode; tags still parse inside them.
// Theme-independent by design (see lint.js) — tags are names, not colours.

const COLOR_TAGS = new Set(["red", "green", "blue", "yellow", "orange", "white", "black"]);

export function parse(body) {
    const warnings = [];
    const seenUnknown = new Set();
    const lines = [];
    let currentTag = null;
    let fenced = false;
    let currentSpans = [];
    let currentText = "";

    const flushSpan = () => {
        if (currentText.length > 0) {
            currentSpans.push({ text: currentText, tag: currentTag });
            currentText = "";
        }
    };
    const flushLine = () => {
        flushSpan();
        lines.push({ fenced, spans: currentSpans });
        currentSpans = [];
    };

    for (const rawLine of body.split("\n")) {
        if (rawLine.trim() === "```") {
            fenced = !fenced;
            continue; // fence marker lines are not rendered
        }
        let i = 0;
        while (i < rawLine.length) {
            if (rawLine[i] === "{") {
                const end = rawLine.indexOf("}", i);
                if (end !== -1) {
                    const word = rawLine.slice(i + 1, end);
                    if (word === "/") {
                        flushSpan();
                        currentTag = null;
                        i = end + 1;
                        continue;
                    }
                    if (COLOR_TAGS.has(word)) {
                        flushSpan();
                        currentTag = word;
                        i = end + 1;
                        continue;
                    }
                    const literal = `{${word}}`;
                    currentText += literal;
                    if (!seenUnknown.has(literal)) {
                        seenUnknown.add(literal);
                        warnings.push(`unknown tag ${literal}`);
                    }
                    i = end + 1;
                    continue;
                }
            }
            currentText += rawLine[i];
            i++;
        }
        flushLine();
    }

    return { lines, warnings };
}
