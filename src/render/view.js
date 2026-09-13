// Pure view resolution: no HTTP, no filesystem, no Date.now()/Math.random().
// board.js/server.js supply `now` and plain snapshots; see the plan's
// determinism contract (2.7) for why that split matters.

const TEN_MIN_MS = 10 * 60 * 1000;
export const MIN_REDRAW_INTERVAL_MS = 180000;

// A live page counts as "newly urgent" once, right after urgentSince passes
// the last redraw — this is what makes the urgent bypass a one-shot event
// rather than re-firing on every subsequent poll.
export function isUrgentBypassActive(liveSummaries, board, now) {
    const newlyUrgent = liveSummaries.some((p) => p.urgentSince && p.urgentSince > board.lastRedrawAt);
    const bypassCooling = board.lastUrgentBypassAt && now - board.lastUrgentBypassAt < TEN_MIN_MS;
    return newlyUrgent && !bypassCooling;
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
    if (isUrgentBypassActive(liveSummaries, board, now)) return 100;
    if (reason === "timer" && now - board.lastButtonAt > TEN_MIN_MS) return 100;
    return liveSummaries.some((p) => p.number === page) ? page : 100;
}

export function shouldCoalesce({ reason }, board, urgentBypassActive, now) {
    if (reason !== "timer") return false;
    if (urgentBypassActive) return false;
    return now - board.lastRedrawAt < MIN_REDRAW_INTERVAL_MS;
}

export function pollHint(board, now) {
    return board.lastUrgentBypassAt && now - board.lastUrgentBypassAt < TEN_MIN_MS ? 30 : undefined;
}
