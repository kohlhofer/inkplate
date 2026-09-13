import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES, themeFor } from "../src/render/theme.js";

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

test("themeFor falls back to dark for an unknown name", () => {
    assert.equal(themeFor("nope"), THEMES.dark);
    assert.equal(themeFor("light"), THEMES.light);
});
