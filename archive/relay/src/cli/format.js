// Local formatting helpers for human-readable CLI output. The relay does
// its own display-string formatting server-side (store.js's formatDisplay)
// for what it persists; the CLI formats raw epoch-ms fields the same way,
// for values the relay only ever returns as numbers (expiresAt, lastSeen).

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDisplay(ms) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`;
}

// "2 min ago" / "3 h ago" / "just now" / "never" (for a null/0 timestamp).
export function formatRelative(ms, now = Date.now()) {
    if (!ms) return "never";
    const diffSec = Math.max(0, Math.round((now - ms) / 1000));
    if (diffSec < 5) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.round(diffMin / 60);
    return `${diffHr} h ago`;
}
