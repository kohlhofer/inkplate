#!/usr/bin/env node
// Proves the board's C++ renderer pixel-exact against the archived Node relay.
//
//   node test/native/compare.mjs [path/to/render_main]    (or: make test-native)
//
// Each fixture screen is rendered twice. The JS side is the archived
// renderFrame() on a synthetic text-layout page, which owns rows 1-16 (title
// and body, y 32-415), plus a small reference implementation of the
// single-screen header and footer drawn with the archived glyph primitives.
// The C++ frame must match that whole expected frame byte for byte, its
// warnings must equal the archived lint()'s, and the header and footer are
// also checked directly against the layout rules, so a misreading shared by
// the reference and the port can't pass. A failing fixture leaves
// expected/actual/diff PNGs in a temp directory.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { renderFrame } from "../../archive/relay/src/render/frame.js";
import { lint } from "../../archive/relay/src/render/lint.js";
import { THEMES } from "../../archive/relay/src/render/theme.js";
import { drawText, drawAccentText } from "../../archive/relay/src/render/glyphs.js";
import { createFramebuffer, PANEL_WIDTH, PANEL_HEIGHT } from "../../archive/relay/src/render/grid.js";
import { cpLength, cpSlice } from "../../archive/relay/src/render/text.js";
import { PALETTE } from "../../archive/relay/src/render/palette.js";
import { GLYPHS } from "../../archive/relay/font/font-data.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = path.resolve(process.argv[2] ?? path.join(root, "build", "native", "render_main"));
const work = mkdtempSync(path.join(os.tmpdir(), "vt-native-"));

const TEXT_X = 12;
const TEXT_COLS = 48;
const HEADER_Y = 8;
const FOOTER_Y = 8 + 17 * 24; // 416
const BODY_TOP = 32; // title and body rows, compared against renderFrame
const BODY_BOTTOM = 416; // exclusive
const TEXT_END_X = TEXT_X + TEXT_COLS * 12; // 588
const ELLIPSIS = "…";

// ---------------------------------------------------------------- fixtures

const HEADER = { headerLeft: "VIDEOTEXT", headerRight: "updated Sun 13 Sep 14:05", footer: "wall display · 192.168.1.40" };

const FENCED_ART = [
    "```",
    "┌────┬────┐ ┏━━┳━━┓",
    "│ {green}ok{/} │ {red}no{/} │ ┃{yellow}██{/}┃{blue}▓▓{/}┃",
    "├────┼────┤ ┣━━╋━━┫",
    "└────┴────┘ ┗━━┻━━┛ ═║╭╱",
    "{red}███{/} {yellow}▀▄▌▐{/} {green}░▒▓{/} {blue}▁▂▃▅▆▇{/} {orange}▉▊▋▍▎▏▔▕{/}",
    "{white}▖▗▘▙▚▛▜▝▞▟{/} {black}██{/} █ plain {red}██ mixed{/}",
    "{orange}" + Array.from({ length: 60 }, (_, i) => String.fromCodePoint(0x1fb00 + i)).join("").slice(0, 60) + "{/}",
    "{green}\u{1fb00}\u{1fb01}\u{1fb02} \u{1fb3b}\u{1fb3a}{/} {red}\u{1fb3c}\u{1fbff}{/} \u{1f600}",
    "|{red}    {/}|{blue} {/} {yellow}  {/}  spaces-only tagged runs are banded",
    "```",
    "after the fence {red}██{/} {yellow}██{/}",
].join("\n");

const LONG_BODY = [
    "This paragraph is deliberately long so that greedy word wrap has to break it across several rows of the forty-eight column text area, including a {yellow}multi word band that crosses a row break{/} and a hard-broken word: supercalifragilisticexpialidociousandthensomemorecharactersbeyondonerow.",
    "",
    "   ",
    ...Array.from({ length: 20 }, (_, i) => `line ${i + 1} of the list {green}ok{/}`),
].join("\n");

const WAVE = Array.from({ length: 600 }, (_, i) => Math.round((Math.sin(i / 23) * 40 + Math.cos(i / 7) * 9 + i * 0.05) * 1000) / 1000);

const fixtures = [
    {
        name: "plain text",
        screen: { ...HEADER, title: "Deploy finished", body: "all tests passed\nsee the log for details" },
    },
    {
        name: "every colour tag, multi-word bands, punctuation",
        screen: {
            ...HEADER,
            title: "Colour tags",
            body: [
                "{red}red{/} {green}green{/} {blue}blue{/} {yellow}yellow{/} {orange}orange{/} {white}white{/} {black}black{/}",
                "{yellow}Partly sunny{/} high 90, {blue}light rain later{/} tonight",
                "({red}FAILED{/}), {green}ok{/}. {blue}note{/}: ab{red}cd{/}ef \"{orange}quoted{/}\"",
                "before {red}FAILED{/} after {green}two words{/}{yellow}adjacent{/} end",
                "{red}starts the row{/}                     {green}ends it{/}",
                "{red}  padded inside  {/} and {yellow}{/}empty tag",
            ].join("\n"),
        },
    },
    {
        name: "all 7 tags on one line",
        screen: {
            ...HEADER,
            title: "Seven",
            body: "{black}k{/}{white}w{/}{green}g{/}{blue}b{/}{red}r{/}{yellow}y{/}{orange}o{/} {black}black {white}white {green}green {blue}blue {red}red {yellow}yellow {orange}orange{/}",
        },
    },
    {
        name: "long body truncates",
        screen: { ...HEADER, title: "Long body", body: LONG_BODY },
    },
    {
        name: "fenced box drawing, blocks, sextants",
        screen: { ...HEADER, title: "Mosaic", body: `${FENCED_ART}\n\`\`\`\n${"x".repeat(60)}\n  \`\`\`  \nunclosed below\n\`\`\`\n{red}${"─".repeat(50)}` },
    },
    {
        name: "fenced art, light theme",
        screen: { ...HEADER, theme: "light", title: "Mosaic light", body: FENCED_ART },
    },
    {
        name: "punctuation and accents",
        screen: {
            ...HEADER,
            title: "“Quotes” – dashes — and …",
            body: [
                "“double” ‘single’ en–dash em—dash ellipsis… 72°F",
                "Über Größe naïve café Ångström æø £€ · • ½ ©",
                "no\u00a0break soft\u00adhyphen tab\there cr\r\n\u{1f600} emoji {red}äöü{/}",
            ].join("\n"),
        },
    },
    {
        name: "unknown tags",
        screen: { ...HEADER, title: "Unknown", body: "{foo} and {foo} and {bar} {} {Red} {red {/}\n{{red}}nested{/} {/ } {yellow}still {nope} yellow{/}" },
    },
    {
        name: "spark chart with label and body",
        screen: {
            ...HEADER,
            title: "Rainfall",
            body: "steady all week\n{blue}peak Thursday{/}",
            chart: { type: "spark", values: [1, 4, 2, 8, 3, 2.25, 7.75, 0.5], label: "rain mm/hr" },
        },
    },
    {
        name: "flat spark",
        screen: { ...HEADER, title: "Flat", body: "nothing moved", chart: { type: "spark", values: [4, 4, 4] } },
    },
    {
        name: "bars chart",
        screen: {
            ...HEADER,
            title: "Builds per day",
            body: "last seven days",
            chart: { type: "bars", values: [3, 7, 0, 12, 5, 9, 1], label: "builds" },
        },
    },
    {
        name: "bars with negatives, bucketed",
        screen: {
            ...HEADER,
            title: "Balance",
            body: "",
            chart: { type: "bars", values: Array.from({ length: 200 }, (_, i) => Math.round(Math.sin(i / 9) * 50) / 10) },
        },
    },
    {
        name: "600-value spark",
        screen: { ...HEADER, title: "Six hundred", body: "bucketed to the 576 px text width", chart: { type: "spark", values: WAVE, label: "wave" } },
    },
    {
        name: "600-value spark, light theme",
        screen: { ...HEADER, theme: "light", title: "Six hundred light", body: "", chart: { type: "spark", values: WAVE } },
    },
    {
        // toFixed(1) rounds ties away from zero where printf rounds to even: 0.25 is "0.3", 3.25 is "3.3".
        name: "spark labels: toFixed ties",
        screen: { ...HEADER, title: "Ties", body: "b", chart: { type: "spark", values: [0.25, 1.5, 3.25] } },
    },
    {
        name: "spark labels: negative ties, exponent form, squeezed body",
        screen: {
            ...HEADER,
            title: "Labels",
            body: "tall body\n".repeat(16),
            chart: { type: "spark", values: [-0.25, 2.75, 1e21, -3.75], label: "x".repeat(60) },
        },
    },
    {
        name: "spark labels: negative near zero",
        screen: { ...HEADER, title: "Near zero", body: "", chart: { type: "spark", values: [-0.04, -0.01, -0.02], label: "°C" } },
    },
    {
        name: "spark labels: big integers",
        screen: { ...HEADER, title: "Big", body: "b", chart: { type: "spark", values: [2 ** 60, 123456789, 9007199254740993, 0.05] } },
    },
    {
        name: "light theme text",
        screen: {
            ...HEADER,
            theme: "light",
            title: "Light theme",
            body: "{red}red{/} {green}green{/} {blue}blue{/} {yellow}Partly sunny{/} {orange}orange{/} {white}white{/} {black}black{/}\nplain line",
        },
    },
    {
        name: "over-long title",
        screen: { ...HEADER, title: "This title is far too long to fit the forty-eight columns of the screen", body: "short" },
    },
    {
        name: "over-long title, light theme",
        screen: { ...HEADER, theme: "light", title: "\u{1fb00}█ title of many codepoints that runs well past forty-eight", body: "short" },
    },
    {
        name: "header collision, long footer",
        screen: {
            theme: "light",
            headerLeft: "VIDEOTEXT · kitchen wall display in the hallway",
            headerRight: "updated Sun 13 Sep 14:05",
            footer: "a footer line that is much longer than the forty-eight cells of the text area",
            title: "Collision",
            body: "body",
        },
    },
    {
        name: "header collision, dark",
        screen: {
            headerLeft: "VIDEOTEXT KITCHEN WALL DISPLAY ABCDEFGHIJKLMNOP",
            headerRight: "updated Sun 13 Sep 14:05",
            footer: `${"f".repeat(46)}  tail`,
            title: "Collision",
            body: "body",
        },
    },
    {
        name: "empty header and footer",
        screen: { title: "Bare", body: "no header, no footer" },
    },
    {
        name: "header right only, full width",
        screen: { theme: "light", headerRight: "r".repeat(47) + "9", footer: "x".repeat(48), title: "Right", body: "" },
    },
    {
        name: "chart with whitespace-only body",
        screen: { ...HEADER, title: "Blank body", body: "  \n\u00a0\n\t", chart: { type: "bars", values: [2, 3], label: "l" } },
    },
    {
        name: "chart without body",
        screen: { ...HEADER, title: "Chart only", body: "", chart: { type: "spark", values: [5, 1, 9] } },
    },
    {
        name: "invalid UTF-8",
        screen: { ...HEADER, title: "Bad @B1@ bytes", body: "a@B1@b@B2@c@B3@d\n{red}x@B4@y{/}@B5@" },
        rawBytes: {
            "@B1@": [0xff],
            "@B2@": [0xe2, 0x82], // truncated euro sign
            "@B3@": [0xed, 0xa0, 0x80], // encoded surrogate
            "@B4@": [0xc0, 0xaf], // overlong slash
            "@B5@": [0xf0, 0x9f, 0x98], // truncated at the end
        },
    },
];

// ------------------------------------------------------------- JS reference

function jsChart(chart) {
    if (!chart) return null;
    return { type: chart.type, values: chart.values, label: chart.label };
}

function cutWithEllipsis(text, budget) {
    if (cpLength(text) <= budget) return text;
    if (budget <= 0) return "";
    return `${cpSlice(text, 0, budget - 1).trimEnd()}${ELLIPSIS}`;
}

function headerTexts(screen) {
    const right = cutWithEllipsis(screen.headerRight ?? "", TEXT_COLS);
    const leftBudget = right ? Math.max(0, TEXT_COLS - cpLength(right) - 2) : TEXT_COLS;
    const left = cutWithEllipsis(screen.headerLeft ?? "", leftBudget);
    return { left, right, footer: cutWithEllipsis(screen.footer ?? "", TEXT_COLS) };
}

function expectedFrame(screen) {
    const theme = THEMES[screen.theme ?? "dark"];
    const page = {
        number: 205,
        sender: "x",
        postedDisplay: "Sun 13 Sep 14:05",
        expiresDisplay: "Mon 14 Sep 14:05",
        title: screen.title,
        body: screen.body,
        layout: "text",
        image: null,
        chart: jsChart(screen.chart),
    };
    const { indices } = renderFrame(205, { page, liveSummaries: [{ number: 205, title: screen.title }] }, {}, theme, 0);

    const fb = createFramebuffer();
    fb.fill(theme.background);
    fb.set(indices.subarray(BODY_TOP * PANEL_WIDTH, BODY_BOTTOM * PANEL_WIDTH), BODY_TOP * PANEL_WIDTH);

    const { left, right, footer } = headerTexts(screen);
    if (left) drawAccentText(fb, TEXT_X, HEADER_Y, left, theme);
    if (right) drawText(fb, TEXT_X + (TEXT_COLS - cpLength(right)) * 12, HEADER_Y, right, theme.foreground);
    drawText(fb, TEXT_X, FOOTER_Y, footer, theme.foreground);

    const { warnings } = lint({ title: screen.title, body: screen.body, layout: "text", chart: jsChart(screen.chart) });
    return { fb, warnings, theme };
}

// ------------------------------------------------------------------ C++ run

function screenFileBytes(fixture) {
    const { screen } = fixture;
    const forCpp = { ...screen, chart: screen.chart ? { ...screen.chart, values: screen.chart.values.map(String) } : undefined };
    let bytes = Buffer.from(JSON.stringify(forCpp), "utf8");
    for (const [marker, raw] of Object.entries(fixture.rawBytes ?? {})) {
        const parts = [];
        let at = 0;
        for (let i = bytes.indexOf(marker, at); i !== -1; i = bytes.indexOf(marker, at)) {
            parts.push(bytes.subarray(at, i), Buffer.from(raw));
            at = i + marker.length;
        }
        parts.push(bytes.subarray(at));
        bytes = Buffer.concat(parts);
    }
    return bytes;
}

function renderCpp(fixture, slug) {
    const bytes = screenFileBytes(fixture);
    const screenPath = path.join(work, `${slug}.json`);
    const pixelsPath = path.join(work, `${slug}.bin`);
    const resultPath = path.join(work, `${slug}.result.json`);
    writeFileSync(screenPath, bytes);
    execFileSync(binary, ["--bench", "50", screenPath, pixelsPath, resultPath], { stdio: ["ignore", "inherit", "inherit"] });
    // The JS side decodes the very same bytes, the way the relay's JSON body parser would.
    const jsScreen = JSON.parse(new TextDecoder().decode(bytes));
    if (jsScreen.chart) jsScreen.chart.values = jsScreen.chart.values.map(Number);
    return { screenPath, pixels: new Uint8Array(readFileSync(pixelsPath)), result: JSON.parse(readFileSync(resultPath, "utf8")), jsScreen };
}

// ------------------------------------------------------------ direct checks

const px = (fb, x, y) => fb[y * PANEL_WIDTH + x];

function inkBounds(fb, y0, y1, background, x0 = 0, x1 = PANEL_WIDTH) {
    let min = Infinity;
    let max = -Infinity;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            if (px(fb, x, y) !== background) {
                min = Math.min(min, x);
                max = Math.max(max, x);
            }
        }
    }
    return { min, max };
}

function colorsIn(fb, x0, x1, y0, y1) {
    const set = new Set();
    for (let y = y0; y < y1; y++) for (let x = Math.max(0, x0); x < Math.min(PANEL_WIDTH, x1); x++) set.add(px(fb, x, y));
    return set;
}

// The cell's pixels match `codepoint`'s font bitmap in `fg` over `bg`.
function cellIsGlyph(fb, cellX, cellY, codepoint, fg, bg) {
    const rows = GLYPHS[codepoint];
    for (let ry = 0; ry < 24; ry++) {
        for (let rx = 0; rx < 12; rx++) {
            const on = (rows[ry] >> (11 - rx)) & 1;
            if (px(fb, cellX + rx, cellY + ry) !== (on ? fg : bg)) return false;
        }
    }
    return true;
}

function directChecks(fb, screen, theme) {
    const failures = [];
    const bg = theme.background;
    const { left, right, footer } = headerTexts(screen);
    const accentFg = theme.accentBand ? theme.accentBand.fg : theme.accent;
    const accentBg = theme.accentBand ? theme.accentBand.bg : bg;

    if (colorsIn(fb, 0, PANEL_WIDTH, 0, HEADER_Y).size !== 1 || !colorsIn(fb, 0, PANEL_WIDTH, 0, HEADER_Y).has(bg)) {
        failures.push("top border is not plain background");
    }
    if (colorsIn(fb, 0, PANEL_WIDTH, 440, PANEL_HEIGHT).size !== 1 || !colorsIn(fb, 0, PANEL_WIDTH, 440, PANEL_HEIGHT).has(bg)) {
        failures.push("bottom border is not plain background");
    }

    const header = inkBounds(fb, HEADER_Y, HEADER_Y + 24, bg);
    if (!left && !right && header.min !== Infinity) failures.push("empty header drew something");
    if (left) {
        const leftEnd = TEXT_X + cpLength(left) * 12;
        if (header.min < TEXT_X - 4) failures.push(`header ink starts at x=${header.min}, left of x=8`);
        const colors = colorsIn(fb, TEXT_X, leftEnd, HEADER_Y, HEADER_Y + 24);
        if (!colors.has(accentFg) && !theme.accentBand) failures.push("headerLeft has no accent-coloured pixels");
        for (const c of colors) {
            if (c !== accentFg && c !== accentBg) failures.push(`headerLeft uses colour ${c}, not the accent style`);
        }
        if (theme.accentBand) {
            const bandColumn = colorsIn(fb, TEXT_X - 4, TEXT_X - 3, HEADER_Y, HEADER_Y + 24);
            if (bandColumn.size !== 1 || !bandColumn.has(accentBg)) failures.push("headerLeft accent band does not start at x=8");
        }
        if (cpLength(screen.headerLeft) > cpLength(left)) {
            const lastCell = TEXT_X + (cpLength(left) - 1) * 12;
            if (!cellIsGlyph(fb, lastCell, HEADER_Y, 0x2026, accentFg, accentBg)) failures.push("cut headerLeft does not end in an ellipsis");
        }
    }
    if (right) {
        const rightStart = TEXT_END_X - cpLength(right) * 12;
        const rightInk = inkBounds(fb, HEADER_Y, HEADER_Y + 24, bg, rightStart, PANEL_WIDTH);
        if (rightInk.max >= TEXT_END_X) failures.push(`headerRight ink reaches x=${rightInk.max}, past x=587`);
        if (rightInk.max < TEXT_END_X - 12) failures.push(`headerRight ends at x=${rightInk.max}, not in the last text cell`);
        const colors = colorsIn(fb, rightStart, TEXT_END_X, HEADER_Y, HEADER_Y + 24);
        for (const c of colors) if (c !== bg && c !== theme.foreground) failures.push(`headerRight uses colour ${c}`);
        if (left) {
            const gap = colorsIn(fb, TEXT_X + cpLength(left) * 12 + (theme.accentBand ? 4 : 0), rightStart, HEADER_Y, HEADER_Y + 24);
            if (gap.size !== 1 || !gap.has(bg)) failures.push("no blank gap between headerLeft and headerRight");
            if (cpLength(screen.headerLeft) > cpLength(left) && rightStart - (TEXT_X + cpLength(left) * 12) !== 24) {
                failures.push("cut headerLeft does not stop two cells short of headerRight");
            }
        }
    }

    const footerInk = inkBounds(fb, FOOTER_Y, FOOTER_Y + 24, bg);
    if (!footer && footerInk.min !== Infinity) failures.push("empty footer drew something");
    if (footer) {
        if (footerInk.min < TEXT_X) failures.push(`footer ink starts at x=${footerInk.min}`);
        if (footerInk.max >= TEXT_END_X) failures.push(`footer ink reaches x=${footerInk.max}`);
        if (cpLength(screen.footer) > TEXT_COLS) {
            if (cpLength(footer) > TEXT_COLS) failures.push("footer longer than 48 cells");
            const lastCell = TEXT_X + (cpLength(footer) - 1) * 12;
            if (!cellIsGlyph(fb, lastCell, FOOTER_Y, 0x2026, theme.foreground, bg)) failures.push("cut footer does not end in an ellipsis");
        }
    }
    return failures;
}

// -------------------------------------------------------------- PNG output

function writePng(file, fb, colorOf) {
    const png = new PNG({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
    for (let i = 0; i < fb.length; i++) {
        const [r, g, b] = colorOf(i);
        png.data[i * 4] = r;
        png.data[i * 4 + 1] = g;
        png.data[i * 4 + 2] = b;
        png.data[i * 4 + 3] = 255;
    }
    writeFileSync(file, PNG.sync.write(png));
}

function writeDiffImages(slug, expected, actual) {
    const rgb = (index) => PALETTE[index]?.rgb ?? [255, 0, 255];
    writePng(path.join(work, `${slug}-expected.png`), expected, (i) => rgb(expected[i]));
    writePng(path.join(work, `${slug}-actual.png`), actual, (i) => rgb(actual[i]));
    writePng(path.join(work, `${slug}-diff.png`), expected, (i) => {
        if (expected[i] !== actual[i]) return [255, 0, 255];
        const [r, g, b] = rgb(expected[i]);
        return [(r + 510) / 3, (g + 510) / 3, (b + 510) / 3];
    });
}

// -------------------------------------------------------------------- main

function sameArray(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

function checkFont() {
    const dumpPath = path.join(work, "font.json");
    try {
        execFileSync(binary, ["--dump-font", dumpPath], { stdio: ["ignore", "inherit", "inherit"] });
    } catch {
        return ["render_main --dump-font reported lookup errors"];
    }
    const { glyphs } = JSON.parse(readFileSync(dumpPath, "utf8"));
    const failures = [];
    const cppKeys = Object.keys(glyphs).sort();
    const jsKeys = Object.keys(GLYPHS).sort();
    if (!sameArray(cppKeys, jsKeys)) {
        const onlyCpp = cppKeys.filter((k) => !(k in GLYPHS));
        const onlyJs = jsKeys.filter((k) => !(k in glyphs));
        failures.push(`codepoint sets differ: only in font_data.h [${onlyCpp}], only in font-data.js [${onlyJs}]`);
    }
    for (const key of jsKeys) {
        if (glyphs[key] && !sameArray(glyphs[key], GLYPHS[key])) failures.push(`glyph U+${Number(key).toString(16)} differs`);
    }
    return { failures, count: cppKeys.length };
}

let failed = 0;

const font = checkFont();
if (font.failures.length === 0) {
    console.log(`PASS  font_data.h: all ${font.count} glyphs match font-data.js`);
} else {
    failed++;
    console.log("FAIL  font_data.h");
    for (const f of font.failures.slice(0, 20)) console.log(`        ${f}`);
}

const timings = [];
const screenPaths = [];
for (const fixture of fixtures) {
    const slug = fixture.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const { screenPath, pixels, result, jsScreen } = renderCpp(fixture, slug);
    screenPaths.push(screenPath);
    const { fb: expected, warnings, theme } = expectedFrame(jsScreen);
    const failures = [];

    let bodyDiff = 0;
    let headerFooterDiff = 0;
    for (let i = 0; i < expected.length; i++) {
        if (expected[i] === pixels[i]) continue;
        const y = Math.floor(i / PANEL_WIDTH);
        if (y >= BODY_TOP && y < BODY_BOTTOM) bodyDiff++;
        else headerFooterDiff++;
    }
    if (bodyDiff > 0) failures.push(`${bodyDiff} pixels differ from renderFrame in the title and body (y 32-415)`);
    if (headerFooterDiff > 0) failures.push(`${headerFooterDiff} pixels differ from the header/footer reference`);
    if (!sameArray(result.warnings, warnings)) {
        failures.push(`warnings ${JSON.stringify(result.warnings)}, JS lint says ${JSON.stringify(warnings)}`);
    }
    if (!sameArray(result.lintWarnings, warnings)) {
        failures.push(`lintScreen warnings ${JSON.stringify(result.lintWarnings)}, JS lint says ${JSON.stringify(warnings)}`);
    }
    failures.push(...directChecks(pixels, jsScreen, theme));

    timings.push(result.bench.meanMicros);
    const timing = `${(result.bench.meanMicros / 1000).toFixed(3)} ms`;
    const warned = warnings.length ? `  warnings: ${warnings.join("; ")}` : "";
    if (failures.length === 0) {
        console.log(`PASS  ${fixture.name}  (${timing})${warned}`);
    } else {
        failed++;
        writeDiffImages(slug, expected, pixels);
        console.log(`FAIL  ${fixture.name}  (${timing})`);
        for (const f of failures) console.log(`        ${f}`);
        console.log(`        images: ${path.join(work, `${slug}-{expected,actual,diff}.png`)}`);
    }
}

// Two board tasks render at once, so every fixture is also rendered and
// linted concurrently and must match its serial output.
try {
    const out = execFileSync(binary, ["--concurrent", "4", "20", ...screenPaths], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    console.log(`PASS  reentrancy: ${out.trim()}`);
} catch (error) {
    failed++;
    console.log(`FAIL  reentrancy: ${String(error.stdout ?? error.message).trim()}`);
}

const checks = fixtures.length + 2;
const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
console.log(`\nrenderScreen on this host: mean ${(mean / 1000).toFixed(3)} ms, slowest fixture ${(Math.max(...timings) / 1000).toFixed(3)} ms`);
if (failed > 0) {
    console.log(`${failed} of ${checks} checks failed; inputs and images in ${work}`);
    process.exit(1);
}
console.log(`all ${checks} checks passed`);
