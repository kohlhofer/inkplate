import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TokenStore } from "../src/relay/tokens.js";

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "videotext-tokens-"));
}

test("adding a sender token stores only its hash, never the plaintext", () => {
    const dir = tmpDir();
    const store = new TokenStore(dir);
    const token = store.addSender("hooks", { pages: "200-299" });
    const raw = fs.readFileSync(path.join(dir, "tokens.json"), "utf8");
    assert.equal(raw.includes(token), false);
});

test("authenticate resolves board and sender tokens with their capabilities", () => {
    const dir = tmpDir();
    const store = new TokenStore(dir);
    const boardToken = store.rotateBoardToken();
    const senderToken = store.addSender("hooks", { pages: "200-299", images: true, urgent: false });

    assert.deepEqual(store.authenticate(boardToken), { role: "board", name: "board" });
    const sender = store.authenticate(senderToken);
    assert.equal(sender.role, "sender");
    assert.equal(sender.name, "hooks");
    assert.deepEqual(sender.range, { min: 200, max: 299 });
    assert.equal(sender.images, true);
    assert.equal(sender.urgent, false);
});

test("an unknown token authenticates to null", () => {
    const store = new TokenStore(tmpDir());
    assert.equal(store.authenticate("not-a-real-token"), null);
});

test("a token added by direct file mutation is honoured on the next authenticate call (mtime reload)", () => {
    const dir = tmpDir();
    const store = new TokenStore(dir);
    const other = new TokenStore(dir);
    const token = other.addSender("hooks", { pages: "200-299" });

    // `store` never called addSender itself; it should still pick up the
    // change written to disk by `other` without being recreated.
    const sender = store.authenticate(token);
    assert.equal(sender?.name, "hooks");
});

test("a corrupted tokens file fails closed: every authenticate() call returns null", () => {
    const dir = tmpDir();
    const store = new TokenStore(dir);
    const token = store.addSender("hooks", { pages: "200-299" });
    assert.ok(store.authenticate(token));

    fs.writeFileSync(path.join(dir, "tokens.json"), "{not valid json");
    assert.equal(store.authenticate(token), null);
});

test("the tokens file is never overwritten on an existing-file first-run path", () => {
    const dir = tmpDir();
    const first = new TokenStore(dir);
    first.addSender("hooks", { pages: "200-299" });

    const second = new TokenStore(dir); // constructor must not reset the file
    assert.deepEqual(
        second.listSenders().map((s) => s.name),
        ["hooks"],
    );
});

test("board --rotate invalidates the previous board token immediately", () => {
    const store = new TokenStore(tmpDir());
    const first = store.rotateBoardToken();
    assert.ok(store.authenticate(first));

    const second = store.rotateBoardToken();
    assert.equal(store.authenticate(first), null);
    assert.ok(store.authenticate(second));
});

test("revoking a sender removes its access", () => {
    const store = new TokenStore(tmpDir());
    const token = store.addSender("hooks", { pages: "200-299" });
    assert.ok(store.authenticate(token));
    assert.equal(store.revokeSender("hooks"), true);
    assert.equal(store.authenticate(token), null);
});

test("adding a token with an existing name fails unless --replace (m9)", () => {
    const store = new TokenStore(tmpDir());
    const first = store.addSender("hooks", { pages: "200-299" });
    assert.throws(() => store.addSender("hooks", { pages: "300-399" }), /already exists/);
    assert.ok(store.authenticate(first)); // untouched by the failed attempt

    const second = store.addSender("hooks", { pages: "300-399", replace: true });
    assert.equal(store.authenticate(first), null);
    const sender = store.authenticate(second);
    assert.deepEqual(sender.range, { min: 300, max: 399 });
});

test("a corrupt tokens file causes add/revoke/rotate/list to throw and leave the file untouched (M5)", () => {
    const dir = tmpDir();
    const store = new TokenStore(dir);
    store.addSender("hooks", { pages: "200-299" });

    fs.writeFileSync(path.join(dir, "tokens.json"), "{not valid json");

    assert.throws(() => store.addSender("new", { pages: "400-499" }), /corrupt/);
    assert.throws(() => store.revokeSender("hooks"), /corrupt/);
    assert.throws(() => store.rotateBoardToken(), /corrupt/);
    assert.throws(() => store.listSenders(), /corrupt/);

    assert.equal(fs.readFileSync(path.join(dir, "tokens.json"), "utf8"), "{not valid json");
});

test("a malformed (but valid-JSON) tokens file fails closed too (m26): bad senders shape, not just bad JSON", () => {
    const dir = tmpDir();
    const store = new TokenStore(dir);
    fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ board: null, senders: { hooks: { pages: "not-a-range" } } }));
    assert.equal(store.authenticate("anything"), null);
    assert.throws(() => store.listSenders(), /corrupt/);
});

test("a persistently corrupt tokens file is only re-parsed (and logged) once per mtime, not per request (m27)", () => {
    const dir = tmpDir();
    const store = new TokenStore(dir);
    fs.writeFileSync(path.join(dir, "tokens.json"), "{not valid json");

    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.join(" "));
    try {
        store.authenticate("a");
        store.authenticate("b");
        store.authenticate("c");
    } finally {
        console.error = original;
    }
    assert.equal(lines.filter((l) => l.includes("tokens.json")).length, 1);
});
