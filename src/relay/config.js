import os from "node:os";
import path from "node:path";

// Tunables + env overrides. VT_DATA lets a worktree and the main checkout
// share state; VT_HOST/VT_PORT/VT_THEME are startup-time only (theme
// selection needs a relay restart to change, see the plan's key decisions).
export function loadConfig(env = process.env) {
    return {
        dataDir: env.VT_DATA ?? path.join(os.homedir(), "Library", "Application Support", "videotext"),
        host: env.VT_HOST ?? "0.0.0.0",
        port: Number(env.VT_PORT ?? 8080),
        theme: env.VT_THEME === "light" ? "light" : "dark",
    };
}

export const MAX_REQUEST_BYTES = 2 * 1024 * 1024; // 2 MiB
export const REQUEST_TIMEOUT_MS = 10000;
// A slow/idle client shouldn't be able to hold a connection open (and so
// starve /healthz and everything else on a device with no per-IP cap) for
// the full 10s requestTimeout; headers must land within 5s, and the server
// re-checks idle connections against these timeouts every 2s (finding m31).
export const HEADERS_TIMEOUT_MS = 5000;
export const CONNECTIONS_CHECKING_INTERVAL_MS = 2000;
export const MAX_CONNECTIONS = 64;

// In-memory, reset on relay restart — a home device doesn't need persistence
// here (see the plan's key decisions).
export const WRITE_RATE_LIMIT = { windowMs: 60000, max: 10 };
export const FRAME_RATE_LIMIT = { windowMs: 5000, max: 1 };
