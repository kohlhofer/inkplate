import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePage, shouldCoalesce, pollHint, isUrgentBypassActive, MIN_REDRAW_INTERVAL_MS } from "../src/render/view.js";

const live = (numbers) => numbers.map((number) => ({ number, urgent: false, urgentSince: null }));
const now = 1_000_000;
const boardBase = { lastRedrawAt: 0, lastButtonAt: 0, lastUrgentBypassAt: null };

test("button cycles through [100, ...live pages ascending], wrapping", () => {
    const summaries = live([101, 205, 300]);
    assert.equal(resolvePage({ reason: "button", page: 100 }, summaries, boardBase, now), 101);
    assert.equal(resolvePage({ reason: "button", page: 101 }, summaries, boardBase, now), 205);
    assert.equal(resolvePage({ reason: "button", page: 300 }, summaries, boardBase, now), 100);
});

test("button on an expired/unknown page lands on the first live page after it", () => {
    const summaries = live([101, 205, 300]);
    assert.equal(resolvePage({ reason: "button", page: 150 }, summaries, boardBase, now), 205);
});

test("button on an unknown page past every live page wraps to the lowest live page", () => {
    const summaries = live([101, 205]);
    assert.equal(resolvePage({ reason: "button", page: 900 }, summaries, boardBase, now), 101);
});

test("button on an unknown page falls back to 100 when nothing is live", () => {
    assert.equal(resolvePage({ reason: "button", page: 150 }, [], boardBase, now), 100);
});

test("timer/boot show the page if still live, else 100", () => {
    const summaries = live([205]);
    const board = { ...boardBase, lastButtonAt: now };
    assert.equal(resolvePage({ reason: "timer", page: 205 }, summaries, board, now), 205);
    assert.equal(resolvePage({ reason: "timer", page: 999 }, summaries, board, now), 100);
    assert.equal(resolvePage({ reason: "boot", page: 205 }, summaries, board, now), 205);
});

test("timer forces 100 after more than 10 minutes since the last button press", () => {
    const summaries = live([205]);
    const board = { ...boardBase, lastButtonAt: now - 11 * 60 * 1000 };
    assert.equal(resolvePage({ reason: "timer", page: 205 }, summaries, board, now), 100);
});

test("a newly-urgent page forces 100 for timer/boot but not button", () => {
    const summaries = [{ number: 205, urgent: true, urgentSince: now - 1000 }];
    const board = { ...boardBase, lastRedrawAt: now - 5000, lastButtonAt: now };
    assert.equal(resolvePage({ reason: "timer", page: 999 }, summaries, board, now), 100);
    assert.equal(resolvePage({ reason: "boot", page: 999 }, summaries, board, now), 100);
    // button ignores urgency entirely; it just cycles
    assert.equal(resolvePage({ reason: "button", page: 100 }, summaries, board, now), 205);
});

test("a second newly-urgent event within 10 minutes of the last bypass does not re-force 100", () => {
    const summaries = [{ number: 205, urgent: true, urgentSince: now - 1000 }];
    const board = { ...boardBase, lastRedrawAt: now - 5000, lastButtonAt: now, lastUrgentBypassAt: now - 60_000 };
    assert.equal(isUrgentBypassActive(summaries, board, now), false);
    // the currently-shown live page stays put rather than being forced to 100
    assert.equal(resolvePage({ reason: "timer", page: 205 }, summaries, board, now), 205);
});

test("shouldCoalesce only applies to timer, never boot/button, and never during an urgent bypass", () => {
    const board = { ...boardBase, lastRedrawAt: now - 1000 };
    assert.equal(shouldCoalesce({ reason: "boot" }, board, false, now), false);
    assert.equal(shouldCoalesce({ reason: "button" }, board, false, now), false);
    assert.equal(shouldCoalesce({ reason: "timer" }, board, true, now), false);
    assert.equal(shouldCoalesce({ reason: "timer" }, board, false, now), true);
});

test("shouldCoalesce is false once the minimum redraw interval has passed", () => {
    const board = { ...boardBase, lastRedrawAt: now - MIN_REDRAW_INTERVAL_MS - 1 };
    assert.equal(shouldCoalesce({ reason: "timer" }, board, false, now), false);
});

test("pollHint returns 30 only inside the 10-minute post-bypass window", () => {
    assert.equal(pollHint({ lastUrgentBypassAt: now - 1000 }, now), 30);
    assert.equal(pollHint({ lastUrgentBypassAt: now - 11 * 60 * 1000 }, now), undefined);
    assert.equal(pollHint({ lastUrgentBypassAt: null }, now), undefined);
});
