import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES, themeFor } from "../src/render/theme.js";
import { PALETTE } from "../src/render/palette.js";

function srgbToLinear(c) {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(indexA, indexB) {
    const la = luminance(PALETTE[indexA].rgb);
    const lb = luminance(PALETTE[indexB].rgb);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

test("dark and light themes cover all seven colour tags", () => {
    const tags = ["red", "green", "blue", "yellow", "orange", "white", "black"];
    for (const theme of [THEMES.dark, THEMES.light]) {
        for (const tag of tags) {
            assert.ok(theme.tags[tag], `missing tag ${tag}`);
            assert.ok(Number.isInteger(theme.tags[tag].fg));
            assert.ok(Number.isInteger(theme.tags[tag].bg));
        }
    }
});

test("dark theme avoids blue-on-black; light theme avoids yellow-on-white", () => {
    // blue tag bands to a blue background rather than blue text on the
    // theme's own (black) background, which would be illegible.
    assert.equal(THEMES.dark.tags.blue.bg, 3);
    assert.notEqual(THEMES.dark.tags.blue.fg, THEMES.dark.background);

    // yellow tag keeps black text and bands to yellow, rather than yellow
    // text on the theme's own (white) background.
    assert.equal(THEMES.light.tags.yellow.bg, 5);
    assert.notEqual(THEMES.light.tags.yellow.fg, THEMES.light.tags.yellow.bg);
});

test("every tag's fg is the higher-contrast choice between black and white against its bg (B6)", () => {
    for (const theme of [THEMES.dark, THEMES.light]) {
        for (const [tagName, { fg, bg }] of Object.entries(theme.tags)) {
            const blackContrast = contrast(0, bg);
            const whiteContrast = contrast(1, bg);
            const expectedFg = whiteContrast >= blackContrast ? 1 : 0;
            assert.equal(fg, expectedFg, `${tagName}: fg=${fg} but ${expectedFg} has higher contrast against bg=${bg}`);
        }
    }
});

test("each theme names an accent colour distinct from its own background (M20)", () => {
    assert.equal(THEMES.dark.accent, 5); // yellow
    assert.equal(THEMES.light.accent, 3); // blue
    assert.notEqual(THEMES.dark.accent, THEMES.dark.background);
    assert.notEqual(THEMES.light.accent, THEMES.light.background);
});

test("themeFor falls back to dark for an unknown name", () => {
    assert.equal(themeFor("nope"), THEMES.dark);
    assert.equal(themeFor("light"), THEMES.light);
});
