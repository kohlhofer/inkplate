import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/relay/ratelimit.js";

test("allows up to max requests per window, then rejects", () => {
    const limiter = new RateLimiter(1000, 2);
    assert.equal(limiter.check("a", 0), true);
    assert.equal(limiter.check("a", 100), true);
    assert.equal(limiter.check("a", 200), false);
});

test("a rejected check does not consume a slot", () => {
    const limiter = new RateLimiter(1000, 1);
    assert.equal(limiter.check("a", 0), true);
    assert.equal(limiter.check("a", 100), false);
    assert.equal(limiter.check("a", 200), false);
});

test("the window slides: old hits expire", () => {
    const limiter = new RateLimiter(1000, 1);
    assert.equal(limiter.check("a", 0), true);
    assert.equal(limiter.check("a", 1001), true);
});

test("keys are independent", () => {
    const limiter = new RateLimiter(1000, 1);
    assert.equal(limiter.check("a", 0), true);
    assert.equal(limiter.check("b", 0), true);
});

test("peek reports capacity without consuming a slot; record consumes one unconditionally", () => {
    const limiter = new RateLimiter(1000, 1);
    assert.equal(limiter.peek("a", 0), true);
    assert.equal(limiter.peek("a", 100), true); // still true: peek never recorded a hit
    limiter.record("a", 100);
    assert.equal(limiter.peek("a", 200), false); // now consumed
});

test("write-limiter pattern: a peek-gated failure never counts, only a recorded success does (m11)", () => {
    const limiter = new RateLimiter(1000, 1);
    function attempt(now, succeeds) {
        if (!limiter.peek("hooks", now)) return { status: 429 };
        if (!succeeds) return { status: 400 }; // rejected write: never recorded
        limiter.record("hooks", now);
        return { status: 201 };
    }
    for (let i = 0; i < 5; i++) assert.equal(attempt(i, false).status, 400);
    assert.equal(attempt(5, true).status, 201);
    assert.equal(attempt(6, true).status, 429); // the one successful write used the only slot
});

test("a /frame-scoped limiter of 1 req/5s rejects a second request without side effects", () => {
    const limiter = new RateLimiter(5000, 1);
    let sideEffects = 0;
    function fetchFrame(now) {
        if (!limiter.check("board", now)) return { status: 429 };
        sideEffects++;
        return { status: 200 };
    }
    assert.equal(fetchFrame(0).status, 200);
    assert.equal(fetchFrame(1000).status, 429);
    assert.equal(sideEffects, 1);
});
