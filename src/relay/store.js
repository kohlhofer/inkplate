import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const DEFAULT_TTL_SECONDS = 86400;
export const MAX_TTL_SECONDS = 7 * 86400;

const TTL_UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

// "90m"/"2h"/"1d" or bare seconds; throws on anything else, including a
// value over the 7-day cap (validate.js/server.js map that to invalid_ttl).
export function parseTtl(input) {
    if (input === undefined || input === null) return DEFAULT_TTL_SECONDS;
    const match = /^(\d+)(s|m|h|d)?$/.exec(String(input).trim());
    if (!match) throw new Error("invalid ttl");
    const seconds = Number(match[1]) * TTL_UNITS[match[2] ?? "s"];
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TTL_SECONDS) {
        throw new Error("invalid ttl");
    }
    return seconds;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Sat 12 Sep 14:05" — computed once at POST time and stored verbatim
// (postedDisplay/expiresDisplay), never recomputed relative to "today" at
// render time (2.7's determinism contract).
export function formatDisplay(ms) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`;
}

// Page CRUD on $VT_DATA/pages/<n>.json (+ <n>.image.bin sidecar). A corrupt
// record, a stale schema version, or a missing/corrupt sidecar are skipped
// (and logged), never fatal — see finding 5 and the plan's determinism
// contract (expiry is the only clock input, decided here via `now`).
export class Store {
    #pagesDir;

    constructor(dataDir) {
        this.#pagesDir = path.join(dataDir, "pages");
        fs.mkdirSync(this.#pagesDir, { recursive: true, mode: 0o700 });
    }

    #pagePath(n) {
        return path.join(this.#pagesDir, `${n}.json`);
    }

    #imagePath(n) {
        return path.join(this.#pagesDir, `${n}.image.bin`);
    }

    get(n) {
        let raw;
        try {
            raw = fs.readFileSync(this.#pagePath(n), "utf8");
        } catch (err) {
            if (err.code === "ENOENT") return null;
            console.error(`videotext: skipping unreadable page ${n}: ${err.message}`);
            return null;
        }
        let record;
        try {
            record = JSON.parse(raw);
        } catch (err) {
            console.error(`videotext: skipping corrupt page ${n}: ${err.message}`);
            return null;
        }
        if (record.v !== SCHEMA_VERSION) {
            console.error(`videotext: skipping page ${n}: unknown schema v=${record.v}`);
            return null;
        }
        return record;
    }

    getLive(n, now) {
        const record = this.get(n);
        return record && record.expiresAt > now ? record : null;
    }

    listNumbers() {
        let files;
        try {
            files = fs.readdirSync(this.#pagesDir);
        } catch {
            return [];
        }
        const numbers = [];
        for (const f of files) {
            const match = /^(\d+)\.json$/.exec(f);
            if (match) numbers.push(Number(match[1]));
        }
        return numbers.sort((a, b) => a - b);
    }

    // Ascending [{number, title, bodyStart, postedDisplay, urgent, urgentSince}].
    liveSummaries(now) {
        const summaries = [];
        for (const n of this.listNumbers()) {
            const record = this.getLive(n, now);
            if (!record) continue;
            // Strips colour tags for the P100 listing snippet only; the
            // stored body (and the real page's own render) keep them.
            const plainBody = (record.body ?? "").replace(/\{[a-z/]*\}/gi, "");
            summaries.push({
                number: record.number,
                title: record.title,
                bodyStart: plainBody.split("\n")[0].slice(0, 40),
                postedDisplay: record.postedDisplay,
                urgent: !!record.urgent,
                urgentSince: record.urgentSince ?? null,
            });
        }
        return summaries;
    }

    // Writes a full replacement record. `urgentSince` is set on a false->true
    // transition or on first creation, and left unchanged on a re-post of an
    // already-urgent page (finding 5 / 2.3's on-disk schema).
    put(n, fields, now) {
        const existing = this.getLive(n, now);
        const urgent = !!fields.urgent;
        const urgentSince = urgent ? (existing?.urgent ? existing.urgentSince : now) : null;
        const record = { v: SCHEMA_VERSION, ...fields, number: n, urgent, urgentSince };
        fs.writeFileSync(this.#pagePath(n), JSON.stringify(record, null, 2));
        return record;
    }

    remove(n, now) {
        const existed = !!this.getLive(n, now);
        try {
            fs.unlinkSync(this.#pagePath(n));
        } catch {
            // already gone
        }
        this.deleteImage(n);
        return existed;
    }

    putImage(n, buffer) {
        fs.writeFileSync(this.#imagePath(n), buffer);
    }

    getImage(n) {
        try {
            return fs.readFileSync(this.#imagePath(n));
        } catch {
            return null;
        }
    }

    deleteImage(n) {
        try {
            fs.unlinkSync(this.#imagePath(n));
        } catch {
            // no sidecar to remove
        }
    }
}
