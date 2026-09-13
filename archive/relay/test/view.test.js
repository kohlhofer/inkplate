import { test } from "node:test";
import assert from "node:assert/strict";
import {
    resolvePage,
    shouldCoalesce,
    isUrgentBypassActive,
    urgentAckAfterShowing,
    MIN_REDRAW_INTERVAL_MS,
} from "../src/render/view.js";

const live = (numbers) => numbers.map((number) => ({ number, urgent: false, urgentSince: null }));
const now = 1_000_000_000;
const boardBase = { lastRedrawAt: 0, lastButtonAt: 0, lastUrgentBypassAt: null, lastUrgentAckAt: null };

test("button cycles through the live pages ascending, then the index, then wraps", () => {
    const summaries = live([101, 205, 300]);
    assert.equal(resolvePage({ reason: "button", page: 101 }, summaries, boardBase, now), 205);
    assert.equal(resolvePage({ reason: "button", page: 300 }, summaries, boardBase, now), 100);
    assert.equal(resolvePage({ reason: "button", page: 100 }, summaries, boardBase, now), 101);
});

test("button on an expired/unknown page lands on the next live page, else the index", () => {
    const summaries = live([101, 205, 300]);
    assert.equal(resolvePage({ reason: "button", page: 150 }, summaries, boardBase, now), 205);
    assert.equal(resolvePage({ reason: "button", page: 900 }, summaries, boardBase, now), 100);
    assert.equal(resolvePage({ reason: "button", page: 150 }, [], boardBase, now), 100);
});

test("boot shows the first content page, or the index when nothing is live", () => {
    assert.equal(resolvePage({ reason: "boot", page: 100 }, live([205, 301]), boardBase, now), 205);
    assert.equal(resolvePage({ reason: "boot", page: 100 }, [], boardBase, now), 100);
});

test("a timer wake shows the first content page when nobody is browsing", () => {
    const board = { ...boardBase, lastButtonAt: now - 11 * 60 * 1000 };
    assert.equal(resolvePage({ reason: "timer", page: 100 }, live([205, 301]), board, now), 205);
    assert.equal(resolvePage({ reason: "timer", page: 301 }, live([205, 301]), board, now), 205);
    assert.equal(resolvePage({ reason: "timer", page: 100 }, [], board, now), 100);
});

test("a timer wake keeps the page someone pressed to within the last 10 minutes, index included", () => {
    const board = { ...boardBase, lastButtonAt: now - 60_000 };
    assert.equal(resolvePage({ reason: "timer", page: 301 }, live([205, 301]), board, now), 301);
    assert.equal(resolvePage({ reason: "timer", page: 100 }, live([205, 301]), board, now), 100);
    // a browsed page that has since expired falls back to the first content page
    assert.equal(resolvePage({ reason: "timer", page: 999 }, live([205, 301]), board, now), 205);
});

test("an unseen urgent page is shown itself on timer/boot, never forced by a button press", () => {
    const summaries = [
        { number: 150, urgent: false, urgentSince: null },
        { number: 205, urgent: true, urgentSince: now - 1000 },
    ];
    const board = { ...boardBase, lastButtonAt: now };
    assert.equal(resolvePage({ reason: "timer", page: 150 }, summaries, board, now), 205);
    assert.equal(resolvePage({ reason: "boot", page: 100 }, summaries, board, now), 205);
    assert.equal(resolvePage({ reason: "button", page: 100 }, summaries, board, now), 150);
});

test("with several unseen urgent pages the newest one is shown", () => {
    const summaries = [
        { number: 201, urgent: true, urgentSince: now - 5000 },
        { number: 202, urgent: true, urgentSince: now - 1000 },
    ];
    assert.equal(resolvePage({ reason: "timer", page: 100 }, summaries, boardBase, now), 202);
});

test("isUrgentBypassActive is reason-gated: never true for button", () => {
    const summaries = [{ number: 205, urgent: true, urgentSince: now - 1000 }];
    assert.equal(isUrgentBypassActive("button", summaries, boardBase, now), false);
    assert.equal(isUrgentBypassActive("timer", summaries, boardBase, now), true);
    assert.equal(isUrgentBypassActive("boot", summaries, boardBase, now), true);
});

test("a page already acknowledged does not re-trigger the bypass", () => {
    const summaries = [{ number: 205, urgent: true, urgentSince: now - 5000 }];
    const board = { ...boardBase, lastUrgentAckAt: now - 5000 };
    assert.equal(isUrgentBypassActive("timer", summaries, board, now), false);
});

test("a second unseen urgent page within 10 minutes of the last bypass does not force the wall", () => {
    const summaries = [
        { number: 150, urgent: false, urgentSince: null },
        { number: 205, urgent: true, urgentSince: now - 1000 },
    ];
    const board = { ...boardBase, lastButtonAt: now, lastUrgentBypassAt: now - 60_000 };
    assert.equal(isUrgentBypassActive("timer", summaries, board, now), false);
    assert.equal(resolvePage({ reason: "timer", page: 150 }, summaries, board, now), 150);
});

test("showing an urgent page, or the index carrying its banner, acknowledges it; nothing moves the ack back", () => {
    const summaries = [
        { number: 150, urgent: false, urgentSince: null },
        { number: 205, urgent: true, urgentSince: 5000 },
    ];
    assert.equal(urgentAckAfterShowing(205, summaries, boardBase), 5000);
    assert.equal(urgentAckAfterShowing(100, summaries, boardBase), 5000);
    assert.equal(urgentAckAfterShowing(150, summaries, boardBase), null);
    assert.equal(urgentAckAfterShowing(205, summaries, { ...boardBase, lastUrgentAckAt: 9000 }), null);
});

test("shouldCoalesce only applies to timer, never boot/button, and never during an urgent bypass", () => {
    const board = { ...boardBase, lastRedrawAt: now - 1000 };
    const base = { hasIfNoneMatch: true };
    assert.equal(shouldCoalesce({ reason: "boot", ...base }, board, false, now), false);
    assert.equal(shouldCoalesce({ reason: "button", ...base }, board, false, now), false);
    assert.equal(shouldCoalesce({ reason: "timer", ...base }, board, true, now), false);
    assert.equal(shouldCoalesce({ reason: "timer", ...base }, board, false, now), true);
});

test("shouldCoalesce requires If-None-Match: a bare timer request always renders", () => {
    const board = { ...boardBase, lastRedrawAt: now - 1000 };
    assert.equal(shouldCoalesce({ reason: "timer", hasIfNoneMatch: false }, board, false, now), false);
});

test("shouldCoalesce is false once the minimum redraw interval has passed", () => {
    const board = { ...boardBase, lastRedrawAt: now - MIN_REDRAW_INTERVAL_MS - 1 };
    assert.equal(shouldCoalesce({ reason: "timer", hasIfNoneMatch: true }, board, false, now), false);
});
