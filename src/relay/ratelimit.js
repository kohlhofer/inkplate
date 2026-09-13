// Generic in-memory sliding-window limiter, keyed by whatever the caller
// wants (a token name, "board", ...). Shared by the write limiter and the
// /frame-specific limiter, which never touch each other's state.
export class RateLimiter {
    #windowMs;
    #max;
    #hits = new Map();

    constructor(windowMs, max) {
        this.#windowMs = windowMs;
        this.#max = max;
    }

    check(key, now) {
        const hits = (this.#hits.get(key) ?? []).filter((t) => now - t < this.#windowMs);
        const allowed = hits.length < this.#max;
        if (allowed) hits.push(now);
        this.#hits.set(key, hits);
        return allowed;
    }

    retryAfterMs(key, now) {
        const hits = this.#hits.get(key) ?? [];
        if (hits.length === 0) return 0;
        return Math.max(0, this.#windowMs - (now - Math.min(...hits)));
    }
}
