import fs from "node:fs";
import path from "node:path";
import { regionsFor } from "../render/layout.js";
import { ValidationError } from "./httpError.js";

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

    // Reads and JSON-parses the record with no schema check — put() needs
    // this to tell "unknown schema version, refuse to overwrite" (m2) apart
    // from "missing/corrupt, fine to overwrite".
    #readRawRecord(n) {
        let raw;
        try {
            raw = fs.readFileSync(this.#pagePath(n), "utf8");
        } catch (err) {
            if (err.code === "ENOENT") return null;
            console.error(`videotext: skipping unreadable page ${n}: ${err.message}`);
            return null;
        }
        try {
            return JSON.parse(raw);
        } catch (err) {
            console.error(`videotext: skipping corrupt page ${n}: ${err.message}`);
            return null;
        }
    }

    get(n) {
        const record = this.#readRawRecord(n);
        if (!record) return null;
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

    // Ascending [{number, title, sender, layout, postedAt, postedDisplay,
    // expiresAt, urgent, urgentSince}]. No body snippet (round-2 fix, M21):
    // the title is what appears on P100, and a truncated snippet only ever
    // bought confusable, mid-word cruft. sender/layout/postedAt/expiresAt
    // aren't used by the render pipeline but are cheap to carry here too,
    // since GET /pages (finding M14) needs them for `vt ls` and has no
    // other reason to re-read every record a second time.
    liveSummaries(now) {
        const summaries = [];
        for (const n of this.listNumbers()) {
            const record = this.getLive(n, now);
            if (!record) continue;
            summaries.push({
                number: record.number,
                title: record.title,
                sender: record.sender,
                layout: record.layout,
                postedAt: record.postedAt,
                postedDisplay: record.postedDisplay,
                expiresAt: record.expiresAt,
                urgent: !!record.urgent,
                urgentSince: record.urgentSince ?? null,
            });
        }
        return summaries;
    }

    // Writes a full replacement record. `urgentSince` is set on a false->true
    // transition or on first creation, and left unchanged on a re-post of an
    // already-urgent page (finding 5 / 2.3's on-disk schema). Refuses to
    // overwrite a record written by a schema version this code doesn't
    // understand, rather than silently destroying whatever that newer
    // schema's fields meant (finding m2) — a corrupt/unparseable file is a
    // different case and is still fine to overwrite.
    assertWritable(n) {
        const existingRaw = this.#readRawRecord(n);
        if (existingRaw && existingRaw.v !== SCHEMA_VERSION) {
            throw new ValidationError(
                409,
                "schema_conflict",
                `page ${n} on disk has an unknown schema version (v=${existingRaw.v}); refusing to overwrite`,
            );
        }
        return existingRaw;
    }

    put(n, fields, now) {
        const existingRaw = this.assertWritable(n);
        const existing = existingRaw && existingRaw.expiresAt > now ? existingRaw : null;
        const urgent = !!fields.urgent;
        const urgentSince = urgent ? (existing?.urgent ? existing.urgentSince : now) : null;
        const record = { v: SCHEMA_VERSION, ...fields, number: n, urgent, urgentSince };
        const pagePath = this.#pagePath(n);
        fs.writeFileSync(pagePath, JSON.stringify(record, null, 2), { mode: 0o600 });
        fs.chmodSync(pagePath, 0o600); // writeFileSync's mode is only honoured when the file didn't already exist
        return record;
    }

    // 204/true whenever a file actually existed to delete — live, expired,
    // or an unknown schema version — 404/false only when there was nothing
    // there at all (finding m2: this used to delete-but-404 on anything
    // that wasn't currently live).
    remove(n) {
        let existed = true;
        try {
            fs.unlinkSync(this.#pagePath(n));
        } catch (err) {
            if (err.code !== "ENOENT") throw err;
            existed = false;
        }
        this.deleteImage(n);
        return existed;
    }

    putImage(n, buffer) {
        const imagePath = this.#imagePath(n);
        fs.writeFileSync(imagePath, buffer, { mode: 0o600 });
        fs.chmodSync(imagePath, 0o600);
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

    // Reads and validates a page's image sidecar against its stored meta
    // (finding B1): only returns pixel data when the sidecar's length
    // matches width*height, every byte is a valid palette index, and the
    // image fits its layout's image region. A missing/truncated/oversized
    // sidecar logs once and returns null so the caller renders the page
    // without the image instead of crashing frame.js's blit.
    loadImage(record) {
        if (!record.image) return null;
        const { style, width, height } = record.image;
        const buffer = this.getImage(record.number);
        if (!buffer) {
            console.error(`videotext: page ${record.number} is missing its image sidecar`);
            return null;
        }
        if (buffer.length !== width * height) {
            console.error(
                `videotext: page ${record.number} image sidecar size mismatch (expected ${width * height}, got ${buffer.length})`,
            );
            return null;
        }
        for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] > 6) {
                console.error(`videotext: page ${record.number} image sidecar has an invalid palette index`);
                return null;
            }
        }
        const region = regionsFor(record.layout).image;
        if (!region || width > region.w || height > region.h) {
            console.error(`videotext: page ${record.number} image ${width}x${height} doesn't fit its layout region`);
            return null;
        }
        return { style, width, height, pixels: buffer };
    }
}
