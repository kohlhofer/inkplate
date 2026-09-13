import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE = {
    lastSeen: null,
    battery: null,
    rssi: null,
    fw: null,
    page: null,
    reason: null,
    lastRedrawAt: 0,
    lastButtonAt: 0,
    lastUrgentBypassAt: null,
    // urgentSince of the newest urgent page already shown on page 100 —
    // distinct from lastRedrawAt (which just tracks the last 200, of any
    // page, for coalescing). See view.js's header comment (round-2 fix).
    lastUrgentAckAt: null,
    batteryLow: false,
};

// Board telemetry + relay-cycle bookkeeping, persisted to status.json so it
// survives a relay restart. Battery hysteresis is a 1-bit state machine:
// once low, stays low until >=3.6V; once ok, stays ok until <3.4V.
export class Board {
    #path;
    #state;

    constructor(dataDir) {
        this.#path = path.join(dataDir, "status.json");
        this.#state = this.#load();
    }

    #load() {
        try {
            return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(this.#path, "utf8")) };
        } catch {
            return { ...DEFAULT_STATE };
        }
    }

    #save() {
        fs.mkdirSync(path.dirname(this.#path), { recursive: true, mode: 0o700 });
        fs.writeFileSync(this.#path, JSON.stringify(this.#state, null, 2), { mode: 0o600 });
        fs.chmodSync(this.#path, 0o600); // mode above is only honoured on creation (finding m32)
    }

    snapshot() {
        return { ...this.#state };
    }

    // Called on every accepted (non-429) /frame fetch.
    recordFetch({ battery, rssi, fw, page, reason }, now) {
        this.#state.lastSeen = now;
        if (battery !== undefined) this.#state.battery = battery;
        if (rssi !== undefined) this.#state.rssi = rssi;
        if (fw !== undefined) this.#state.fw = fw;
        this.#state.page = page;
        this.#state.reason = reason;
        if (reason === "button") this.#state.lastButtonAt = now;
        if (battery !== undefined) {
            this.#state.batteryLow = this.#state.batteryLow ? battery < 3.6 : battery < 3.4;
        }
        this.#save();
    }

    // Only ever called after an actual 200 is sent (any reason) — never on a
    // coalesced or honest-match 304 (finding B2/M2).
    recordRedraw(now) {
        this.#state.lastRedrawAt = now;
        this.#save();
    }

    recordUrgentBypass(now) {
        this.#state.lastUrgentBypassAt = now;
        this.#save();
    }

    // Called whenever page 100 is sent as a 200 with an urgent banner, for
    // any reason including a button press landing on it (finding M1) — this
    // is what "brought to the wall" means, independent of the bypass.
    recordUrgentAck(urgentSince) {
        this.#state.lastUrgentAckAt = urgentSince;
        this.#save();
    }
}
