import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePage, shouldCoalesce, isUrgentBypassActive, MIN_REDRAW_INTERVAL_MS } from "../src/render/view.js";

const live = (numbers) => numbers.map((number) => ({ number, urgent: false, urgentSince: null }));
const now = 1_000_000;
const boardBase = { lastRedrawAt: 0, lastButtonAt: 0, lastUrgentBypassAt: null, lastUrgentAckAt: null };

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

test("an unseen urgent page forces 100 for timer/boot but not button", () => {
    const summaries = [{ number: 205, urgent: true, urgentSince: now - 1000 }];
    const board = { ...boardBase, lastButtonAt: now, lastUrgentAckAt: null };
    assert.equal(resolvePage({ reason: "timer", page: 999 }, summaries, board, now), 100);
    assert.equal(resolvePage({ reason: "boot", page: 999 }, summaries, board, now), 100);
    // button ignores urgency entirely; it just cycles, and never lands on
    // 100 here since 100 isn't next after page 100 in a 2-entry cycle
    assert.equal(resolvePage({ reason: "button", page: 100 }, summaries, board, now), 205);
});

test("isUrgentBypassActive is reason-gated: never true for button", () => {
    const summaries = [{ number: 205, urgent: true, urgentSince: now - 1000 }];
    assert.equal(isUrgentBypassActive("button", summaries, boardBase, now), false);
    assert.equal(isUrgentBypassActive("timer", summaries, boardBase, now), true);
    assert.equal(isUrgentBypassActive("boot", summaries, boardBase, now), true);
});

test("a page already acknowledged (urgentSince <= lastUrgentAckAt) does not re-trigger the bypass", () => {
    const summaries = [{ number: 205, urgent: true, urgentSince: now - 5000 }];
    const board = { ...boardBase, lastUrgentAckAt: now - 5000 };
    assert.equal(isUrgentBypassActive("timer", summaries, board, now), false);
});

test("a second unseen-urgent event within 10 minutes of the last bypass does not re-force 100", () => {
    const summaries = [{ number: 205, urgent: true, urgentSince: now - 1000 }];
    const board = { ...boardBase, lastButtonAt: now, lastUrgentBypassAt: now - 60_000, lastUrgentAckAt: null };
    assert.equal(isUrgentBypassActive("timer", summaries, board, now), false);
    // the currently-shown live page stays put rather than being forced to 100
    assert.equal(resolvePage({ reason: "timer", page: 205 }, summaries, board, now), 205);
});

test("shouldCoalesce only applies to timer, never boot/button, and never during an urgent bypass", () => {
    const board = { ...boardBase, lastRedrawAt: now - 1000 };
    const base = { hasIfNoneMatch: true };
    assert.equal(shouldCoalesce({ reason: "boot", ...base }, board, false, now), false);
    assert.equal(shouldCoalesce({ reason: "button", ...base }, board, false, now), false);
    assert.equal(shouldCoalesce({ reason: "timer", ...base }, board, true, now), false);
    assert.equal(shouldCoalesce({ reason: "timer", ...base }, board, false, now), true);
});

test("shouldCoalesce requires If-None-Match: a bare timer request always renders (B2)", () => {
    const board = { ...boardBase, lastRedrawAt: now - 1000 };
    assert.equal(shouldCoalesce({ reason: "timer", hasIfNoneMatch: false }, board, false, now), false);
});

test("shouldCoalesce is false once the minimum redraw interval has passed", () => {
    const board = { ...boardBase, lastRedrawAt: now - MIN_REDRAW_INTERVAL_MS - 1 };
    assert.equal(shouldCoalesce({ reason: "timer", hasIfNoneMatch: true }, board, false, now), false);
});
