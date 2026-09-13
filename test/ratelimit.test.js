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
