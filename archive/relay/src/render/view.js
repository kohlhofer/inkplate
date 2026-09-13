// Pure view resolution: no HTTP, no filesystem, no Date.now()/Math.random().
// board.js/server.js supply `now` and plain snapshots.
//
// The wall defaults to content: the lowest-numbered live page. The index
// (page 100) comes last in the button cycle and is the default only when
// nothing is live.
//
// `lastRedrawAt` and "urgent acknowledged" are deliberately two different
// timestamps: lastRedrawAt is set only when the relay actually sends a 200
// frame and drives nothing but coalescing. lastUrgentAckAt is the newest
// urgentSince the wall has actually shown, and drives nothing but the bypass.

const TEN_MIN_MS = 10 * 60 * 1000;
export const MIN_REDRAW_INTERVAL_MS = 180000;

function newestUnseenUrgent(liveSummaries, board) {
    const lastAck = board.lastUrgentAckAt ?? 0;
    let newest = null;
    for (const p of liveSummaries) {
        if (!p.urgent || !p.urgentSince || p.urgentSince <= lastAck) continue;
        if (!newest || p.urgentSince > newest.urgentSince) newest = p;
    }
    return newest;
}

// The bypass puts an urgent page the wall hasn't shown yet onto it. Only a
// timer/boot wake can trigger it (a button press never triggers or consumes
// it), and it's throttled to once per 10 minutes so a burst of urgent posts
// doesn't hammer the board.
export function isUrgentBypassActive(reason, liveSummaries, board, now) {
    if (reason !== "timer" && reason !== "boot") return false;
    const cooling = board.lastUrgentBypassAt && now - board.lastUrgentBypassAt < TEN_MIN_MS;
    return newestUnseenUrgent(liveSummaries, board) !== null && !cooling;
}

export function resolvePage({ reason, page }, liveSummaries, board, now) {
    const numbers = liveSummaries.map((p) => p.number);
    const firstContent = numbers[0] ?? 100;

    if (reason === "button") {
        const cycle = [...numbers, 100];
        const idx = cycle.indexOf(page);
        // Expired/unknown page: the next live page after it, else the index.
        if (idx === -1) return numbers.find((m) => m > page) ?? 100;
        return cycle[(idx + 1) % cycle.length];
    }

    if (isUrgentBypassActive(reason, liveSummaries, board, now)) {
        return newestUnseenUrgent(liveSummaries, board).number;
    }
    // Stay where someone was browsing for 10 minutes after their last press,
    // as long as that page still exists; otherwise show the first content page.
    const browsing = reason === "timer" && now - board.lastButtonAt <= TEN_MIN_MS;
    if (browsing && (page === 100 || numbers.includes(page))) return page;
    return firstContent;
}

// The urgentSince to record as acknowledged after sending `pageNumber` as a
// 200: the page itself if it is urgent, or the banner's page when the index
// (which carries the newsflash) is shown. Never moves the acknowledgement back.
export function urgentAckAfterShowing(pageNumber, liveSummaries, board) {
    let shown = null;
    if (pageNumber === 100) {
        for (const p of liveSummaries) {
            if (p.urgent && p.urgentSince && (!shown || p.urgentSince > shown.urgentSince)) shown = p;
        }
    } else {
        shown = liveSummaries.find((p) => p.number === pageNumber && p.urgent && p.urgentSince) ?? null;
    }
    if (!shown) return null;
    const lastAck = board.lastUrgentAckAt ?? 0;
    return shown.urgentSince > lastAck ? shown.urgentSince : null;
}

// Coalescing only ever skips a *timer* wake, and only when the board itself
// signals it already has the current frame (If-None-Match present) within
// the minimum redraw interval; a request with no If-None-Match always gets a
// rendered response.
export function shouldCoalesce({ reason, hasIfNoneMatch }, board, urgentBypassActive, now) {
    if (reason !== "timer") return false;
    if (!hasIfNoneMatch) return false;
    if (urgentBypassActive) return false;
    return now - board.lastRedrawAt < MIN_REDRAW_INTERVAL_MS;
}
