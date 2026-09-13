import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, parseTtl, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS } from "../src/relay/store.js";

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "videotext-store-"));
}

test("parseTtl accepts bare seconds, and 'Nm'/'Nh'/'Nd' suffixes", () => {
    assert.equal(parseTtl("30"), 30);
    assert.equal(parseTtl("90m"), 90 * 60);
    assert.equal(parseTtl("2h"), 2 * 3600);
    assert.equal(parseTtl("1d"), 86400);
});

test("parseTtl defaults to 86400s and rejects anything over the 7-day cap", () => {
    assert.equal(parseTtl(undefined), DEFAULT_TTL_SECONDS);
    assert.throws(() => parseTtl("8d"));
    assert.equal(parseTtl("7d"), MAX_TTL_SECONDS);
    assert.throws(() => parseTtl("not-a-ttl"));
});

test("put/getLive round-trips a page while it hasn't expired", () => {
    const store = new Store(tmpDir());
    const now = 1000;
    store.put(205, { title: "t", body: "b", postedDisplay: "x", expiresAt: now + 1000 }, now);
    assert.ok(store.getLive(205, now + 500));
    assert.equal(store.getLive(205, now + 2000), null);
});

test("a page record with an unknown schema version is excluded and does not throw", () => {
    const dir = tmpDir();
    const store = new Store(dir);
    fs.writeFileSync(
        path.join(dir, "pages", "205.json"),
        JSON.stringify({ v: 2, number: 205, expiresAt: Date.now() + 100000 }),
    );
    assert.equal(store.get(205), null);
    assert.equal(store.getLive(205, Date.now()), null);
});

test("a corrupt page JSON file is skipped, not thrown", () => {
    const dir = tmpDir();
    const store = new Store(dir);
    fs.writeFileSync(path.join(dir, "pages", "205.json"), "{not json");
    assert.equal(store.get(205), null);
});

test("a missing or corrupt image sidecar is skipped, not thrown", () => {
    const store = new Store(tmpDir());
    assert.equal(store.getImage(205), null);
    store.putImage(205, Buffer.from([1, 2, 3]));
    assert.deepEqual(store.getImage(205), Buffer.from([1, 2, 3]));
    store.deleteImage(205);
    assert.equal(store.getImage(205), null);
});

test("urgentSince is preserved across a re-post of an already-urgent page", () => {
    const store = new Store(tmpDir());
    const now = 1000;
    const first = store.put(205, { title: "t", body: "", postedDisplay: "x", expiresAt: now + 1000, urgent: true }, now);
    assert.equal(first.urgentSince, now);

    const later = now + 500;
    const second = store.put(
        205,
        { title: "t2", body: "", postedDisplay: "x", expiresAt: later + 1000, urgent: true },
        later,
    );
    assert.equal(second.urgentSince, now);
});

test("urgentSince resets to null when urgent flips to false", () => {
    const store = new Store(tmpDir());
    const now = 1000;
    store.put(205, { title: "t", body: "", postedDisplay: "x", expiresAt: now + 1000, urgent: true }, now);
    const record = store.put(205, { title: "t", body: "", postedDisplay: "x", expiresAt: now + 1000, urgent: false }, now);
    assert.equal(record.urgentSince, null);
});

test("liveSummaries lists only live pages, ascending", () => {
    const store = new Store(tmpDir());
    const now = 1000;
    store.put(300, { title: "c", body: "", postedDisplay: "x", expiresAt: now + 1000 }, now);
    store.put(200, { title: "a", body: "", postedDisplay: "x", expiresAt: now - 1 }, now); // already expired
    store.put(250, { title: "b", body: "", postedDisplay: "x", expiresAt: now + 1000 }, now);
    const numbers = store.liveSummaries(now).map((p) => p.number);
    assert.deepEqual(numbers, [250, 300]);
});

test("remove deletes a live page and reports whether one existed", () => {
    const store = new Store(tmpDir());
    const now = 1000;
    store.put(205, { title: "t", body: "", postedDisplay: "x", expiresAt: now + 1000 }, now);
    assert.equal(store.remove(205, now), true);
    assert.equal(store.remove(205, now), false);
});
