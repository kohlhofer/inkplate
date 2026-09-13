import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// tokens.json stores hashes only, never plaintext. Reload is mtime-driven so
// `vt token add` while the relay is running takes effect on the next
// request without a restart. A corrupt file fails closed: authenticate()
// returns null for everyone rather than crashing or (worse) allowing all.
function tokensPath(dataDir) {
    return path.join(dataDir, "tokens.json");
}

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function randomToken() {
    return crypto.randomBytes(24).toString("base64url");
}

function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Parsed once at load, not on every auth check (finding 5 in the plan).
export function parseRange(rangeStr) {
    const match = /^(\d+)-(\d+)$/.exec(rangeStr);
    if (!match) throw new Error(`invalid range "${rangeStr}"`);
    return { min: Number(match[1]), max: Number(match[2]) };
}

function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

// Validates the *whole* file's shape at load, not just enough to limp
// through the current request (finding m26): a malformed `senders` entry
// used to 500 with a stack on every authenticated request instead of
// failing the file closed once. Returns the validated data, or null if
// anything at all is off.
function validateTokensShape(data) {
    if (!isPlainObject(data)) return null;
    if (data.board !== null) {
        if (!isPlainObject(data.board) || typeof data.board.hash !== "string" || !HASH_PATTERN.test(data.board.hash)) {
            return null;
        }
    }
    if (!isPlainObject(data.senders)) return null;
    for (const entry of Object.values(data.senders)) {
        if (!isPlainObject(entry)) return null;
        if (typeof entry.hash !== "string" || !HASH_PATTERN.test(entry.hash)) return null;
        if (typeof entry.pages !== "string") return null;
        try {
            parseRange(entry.pages);
        } catch {
            return null;
        }
        if (entry.images !== undefined && typeof entry.images !== "boolean") return null;
        if (entry.urgent !== undefined && typeof entry.urgent !== "boolean") return null;
    }
    return data;
}

export class TokenStore {
    #path;
    #mtimeMs = null;
    #data = null;
    #corrupt = false;

    constructor(dataDir) {
        this.#path = tokensPath(dataDir);
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        if (!fs.existsSync(this.#path)) {
            // First run only: never overwrite a file that already exists.
            this.#writeAtomic({ board: null, senders: {} });
        }
        this.#load();
    }

    #writeAtomic(data) {
        const tmp = `${this.#path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, this.#path);
        fs.chmodSync(this.#path, 0o600);
        this.#data = data;
        this.#mtimeMs = fs.statSync(this.#path).mtimeMs;
        this.#corrupt = false;
    }

    // Loads and validates the file. On any failure — unreadable, malformed
    // JSON, or a shape validateTokensShape rejects — the store fails closed
    // (#corrupt=true, #data=null) but *still records the mtime it saw*, so a
    // persistently corrupt file is parsed and logged once, not on every
    // single request (finding m27, which let relay.log grow unbounded).
    #load() {
        let stat;
        try {
            stat = fs.statSync(this.#path);
        } catch (err) {
            this.#data = null;
            this.#corrupt = true;
            this.#mtimeMs = null; // no mtime to dedupe against; the file itself is gone
            console.error(`videotext: tokens.json unreadable, failing closed: ${err.message}`);
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(this.#path, "utf8"));
        } catch (err) {
            this.#data = null;
            this.#corrupt = true;
            this.#mtimeMs = stat.mtimeMs;
            console.error(`videotext: tokens.json is corrupt, failing closed: ${err.message}`);
            return;
        }
        const validated = validateTokensShape(parsed);
        if (!validated) {
            this.#data = null;
            this.#corrupt = true;
            this.#mtimeMs = stat.mtimeMs;
            console.error("videotext: tokens.json has an invalid shape, failing closed");
            return;
        }
        this.#data = validated;
        this.#mtimeMs = stat.mtimeMs;
        this.#corrupt = false;
    }

    #reloadIfChanged() {
        let stat;
        try {
            stat = fs.statSync(this.#path);
        } catch (err) {
            this.#data = null;
            this.#corrupt = true;
            this.#mtimeMs = null;
            console.error(`videotext: tokens.json unreadable, failing closed: ${err.message}`);
            return;
        }
        if (stat.mtimeMs !== this.#mtimeMs) this.#load();
    }

    // add/revoke/rotate/list are local admin operations, not request-path
    // auth — a corrupt file must stop them cold rather than let them fall
    // back to an empty {board:null,senders:{}} skeleton and silently
    // overwrite (and thereby destroy) whatever was actually on disk
    // (finding M5).
    #assertNotCorrupt() {
        if (this.#corrupt) {
            throw new Error("tokens.json is corrupt; fix or move it aside");
        }
    }

    // { role: "board", name } | { role: "sender", name, range, images, urgent } | null
    authenticate(token) {
        this.#reloadIfChanged();
        if (this.#corrupt || !this.#data) return null;
        const hash = hashToken(token);
        const board = this.#data.board;
        if (board && board.hash && safeEqual(hash, board.hash)) {
            return { role: "board", name: board.name };
        }
        for (const [name, entry] of Object.entries(this.#data.senders)) {
            if (entry.hash && safeEqual(hash, entry.hash)) {
                return {
                    role: "sender",
                    name,
                    range: parseRange(entry.pages),
                    images: !!entry.images,
                    urgent: !!entry.urgent,
                };
            }
        }
        return null;
    }

    addSender(name, { pages, images = false, urgent = false, replace = false }) {
        this.#reloadIfChanged();
        this.#assertNotCorrupt();
        parseRange(pages); // validate before writing
        const data = this.#data ?? { board: null, senders: {} };
        if (data.senders[name] && !replace) {
            throw new Error(`token '${name}' already exists; pass --replace to overwrite it`);
        }
        const token = randomToken();
        data.senders[name] = { hash: hashToken(token), pages, images, urgent };
        this.#writeAtomic(data);
        return token;
    }

    listSenders() {
        this.#reloadIfChanged();
        this.#assertNotCorrupt();
        return Object.entries(this.#data?.senders ?? {}).map(([name, e]) => ({
            name,
            pages: e.pages,
            images: !!e.images,
            urgent: !!e.urgent,
        }));
    }

    revokeSender(name) {
        this.#reloadIfChanged();
        this.#assertNotCorrupt();
        const data = this.#data ?? { board: null, senders: {} };
        if (!(name in data.senders)) return false;
        delete data.senders[name];
        this.#writeAtomic(data);
        return true;
    }

    // Existence check only — never exposes the hash or plaintext. Used by
    // `vt serve` to warn when the board has no token yet (finding i2).
    hasBoardToken() {
        this.#reloadIfChanged();
        return !!this.#data?.board;
    }

    // The only path to the board token's plaintext: no separate "show", no
    // auto-print on first run.
    rotateBoardToken() {
        this.#reloadIfChanged();
        this.#assertNotCorrupt();
        const token = randomToken();
        const data = this.#data ?? { board: null, senders: {} };
        data.board = { hash: hashToken(token), name: "board" };
        this.#writeAtomic(data);
        return token;
    }
}
