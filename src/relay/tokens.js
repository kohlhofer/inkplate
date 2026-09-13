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

    #load() {
        try {
            const raw = fs.readFileSync(this.#path, "utf8");
            const parsed = JSON.parse(raw);
            if (typeof parsed !== "object" || parsed === null || typeof parsed.senders !== "object") {
                throw new Error("malformed tokens file");
            }
            this.#data = parsed;
            this.#mtimeMs = fs.statSync(this.#path).mtimeMs;
            this.#corrupt = false;
        } catch (err) {
            this.#data = null;
            this.#corrupt = true;
            console.error(`videotext: tokens.json is corrupt, failing closed: ${err.message}`);
        }
    }

    #reloadIfChanged() {
        let stat;
        try {
            stat = fs.statSync(this.#path);
        } catch (err) {
            this.#data = null;
            this.#corrupt = true;
            console.error(`videotext: tokens.json unreadable, failing closed: ${err.message}`);
            return;
        }
        if (stat.mtimeMs !== this.#mtimeMs) this.#load();
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

    addSender(name, { pages, images = false, urgent = false }) {
        this.#reloadIfChanged();
        parseRange(pages); // validate before writing
        const token = randomToken();
        const data = this.#data ?? { board: null, senders: {} };
        data.senders[name] = { hash: hashToken(token), pages, images, urgent };
        this.#writeAtomic(data);
        return token;
    }

    listSenders() {
        this.#reloadIfChanged();
        return Object.entries(this.#data?.senders ?? {}).map(([name, e]) => ({
            name,
            pages: e.pages,
            images: !!e.images,
            urgent: !!e.urgent,
        }));
    }

    revokeSender(name) {
        this.#reloadIfChanged();
        const data = this.#data ?? { board: null, senders: {} };
        if (!(name in data.senders)) return false;
        delete data.senders[name];
        this.#writeAtomic(data);
        return true;
    }

    // The only path to the board token's plaintext: no separate "show", no
    // auto-print on first run.
    rotateBoardToken() {
        this.#reloadIfChanged();
        const token = randomToken();
        const data = this.#data ?? { board: null, senders: {} };
        data.board = { hash: hashToken(token), name: "board" };
        this.#writeAtomic(data);
        return token;
    }
}
