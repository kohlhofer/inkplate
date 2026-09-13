import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/render/markup.js";

test("plain text with no tags is one untagged span", () => {
    const { lines, warnings } = parse("hello");
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].spans, [{ text: "hello", tag: null }]);
    assert.deepEqual(warnings, []);
});

test("colour tags set the active tag until {/} resets it", () => {
    const { lines } = parse("plain{red}danger{/}plain again");
    assert.deepEqual(lines[0].spans, [
        { text: "plain", tag: null },
        { text: "danger", tag: "red" },
        { text: "plain again", tag: null },
    ]);
});

test("newlines are hard breaks producing separate lines", () => {
    const { lines } = parse("one\ntwo");
    assert.equal(lines.length, 2);
    assert.equal(lines[0].spans[0].text, "one");
    assert.equal(lines[1].spans[0].text, "two");
});

test("unknown tags render literally, with braces, and warn once per unique tag", () => {
    const { lines, warnings } = parse("{foo} is unknown, {foo} again, {bar} too");
    const text = lines[0].spans.map((s) => s.text).join("");
    assert.equal(text, "{foo} is unknown, {foo} again, {bar} too");
    assert.deepEqual(warnings, ["unknown tag {foo}", "unknown tag {bar}"]);
});

test("fenced blocks toggle non-wrapping mode and still parse colour tags", () => {
    const { lines } = parse("before\n```\n{red}fenced{/}\n```\nafter");
    assert.equal(lines.length, 3);
    assert.equal(lines[0].fenced, false);
    assert.equal(lines[1].fenced, true);
    assert.equal(lines[2].fenced, false);
    assert.deepEqual(lines[1].spans, [{ text: "fenced", tag: "red" }]);
});
