// Pure view resolution: no HTTP, no filesystem, no Date.now()/Math.random().
// board.js/server.js supply `now` and plain snapshots; see the plan's
// determinism contract (2.7) for why that split matters.
//
// `lastRedrawAt` and "urgent acknowledged" are deliberately two different
// timestamps (round-2 fix, finding B2/B3/M1/M2): lastRedrawAt is set only
// when the relay actually sends a 200 frame, for any reason, and drives
// nothing but coalescing. lastUrgentAckAt is the urgentSince of the newest
// urgent page that has actually been shown on page 100, and drives nothing
// but the bypass. An honest 304 (etag already matches) touches neither.

const TEN_MIN_MS = 10 * 60 * 1000;
export const MIN_REDRAW_INTERVAL_MS = 180000;

// The bypass forces page 100 onto the wall for an urgent page the board
// hasn't shown yet. Only a timer/boot wake can trigger it — a button press
// never triggers or consumes it (M1) — and it's throttled to once per 10
// minutes so a burst of urgent posts doesn't hammer the board.
export function isUrgentBypassActive(reason, liveSummaries, board, now) {
    if (reason !== "timer" && reason !== "boot") return false;
    const lastAck = board.lastUrgentAckAt ?? 0;
    const hasUnseenUrgent = liveSummaries.some((p) => p.urgent && p.urgentSince && p.urgentSince > lastAck);
    const cooling = board.lastUrgentBypassAt && now - board.lastUrgentBypassAt < TEN_MIN_MS;
    return hasUnseenUrgent && !cooling;
}

export function resolvePage({ reason, page }, liveSummaries, board, now) {
    if (reason === "button") {
        const numbers = liveSummaries.map((p) => p.number);
        const cycle = [100, ...numbers];
        const idx = cycle.indexOf(page);
        if (idx === -1) {
            // Expired/unknown page: land on the first live page after it,
            // wrapping to the lowest live page, else the front page.
            const next = numbers.find((m) => m > page);
            return next ?? numbers[0] ?? 100;
        }
        return cycle[(idx + 1) % cycle.length];
    }

    // timer or boot
    if (isUrgentBypassActive(reason, liveSummaries, board, now)) return 100;
    if (reason === "timer" && now - board.lastButtonAt > TEN_MIN_MS) return 100;
    return liveSummaries.some((p) => p.number === page) ? page : 100;
}

// Coalescing only ever skips a *timer* wake, and only when the board itself
// signals it already has the current frame (If-None-Match present) within
// the minimum redraw interval — a request with no If-None-Match (fresh
// board, just-cleared etag, etc.) always gets a rendered response (B2).
export function shouldCoalesce({ reason, hasIfNoneMatch }, board, urgentBypassActive, now) {
    if (reason !== "timer") return false;
    if (!hasIfNoneMatch) return false;
    if (urgentBypassActive) return false;
    return now - board.lastRedrawAt < MIN_REDRAW_INTERVAL_MS;
}
