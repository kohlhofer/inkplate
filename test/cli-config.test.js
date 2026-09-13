import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCliConfig, saveCliConfig } from "../src/cli/config.js";
import { callRelay, RelayUnreachableError } from "../src/cli/relayClient.js";
import { token } from "../src/cli/commands/token.js";

function tmpConfigPath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "videotext-cli-"));
    return path.join(dir, "config.json");
}

function captureStderr(fn) {
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.join(" "));
    try {
        fn();
    } finally {
        console.error = original;
    }
    return lines;
}

test("loadCliConfig defaults to the documented relay and env overrides win", () => {
    const configPath = tmpConfigPath();
    const config = loadCliConfig({ env: {}, configPath });
    assert.equal(config.relay, "http://127.0.0.1:8080");
    assert.equal(config.token, null);

    const overridden = loadCliConfig({ env: { VT_RELAY: "http://10.0.0.5:9090", VT_TOKEN: "abc" }, configPath });
    assert.equal(overridden.relay, "http://10.0.0.5:9090");
    assert.equal(overridden.token, "abc");
});

test("a config file mode >= 0640 triggers a stderr warning without failing", () => {
    const configPath = tmpConfigPath();
    fs.writeFileSync(configPath, JSON.stringify({ relay: "http://127.0.0.1:8080", token: "t" }), { mode: 0o644 });

    const lines = captureStderr(() => {
        const config = loadCliConfig({ env: {}, configPath });
        assert.equal(config.token, "t");
    });
    assert.ok(lines.some((l) => l.includes(configPath) && l.includes("chmod 600")));
});

test("a config file at mode 0600 produces no warning", () => {
    const configPath = tmpConfigPath();
    fs.writeFileSync(configPath, JSON.stringify({ relay: "http://127.0.0.1:8080" }), { mode: 0o600 });
    const lines = captureStderr(() => loadCliConfig({ env: {}, configPath }));
    assert.deepEqual(lines, []);
});

test("saveCliConfig writes mode 0600 and merges with any existing content", () => {
    const configPath = tmpConfigPath();
    saveCliConfig({ relay: "http://127.0.0.1:8080" }, configPath);
    saveCliConfig({ token: "abc" }, configPath);
    const written = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.deepEqual(written, { relay: "http://127.0.0.1:8080", token: "abc" });
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
});

test("the relay-unreachable message text is exact", async () => {
    await assert.rejects(
        () => callRelay({ relay: "http://127.0.0.1:1", token: null }, "GET", "/status"),
        (err) => {
            assert.ok(err instanceof RelayUnreachableError);
            assert.equal(err.message, "no relay at http://127.0.0.1:1; start it with `vt serve`");
            return true;
        },
    );
});

test("vt token add --save writes the new token into the config file", async () => {
    const configPath = tmpConfigPath();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "videotext-cli-data-"));
    const cliConfig = { relay: "http://127.0.0.1:8080", token: null, configPath };
    const relayConfig = { dataDir, host: "127.0.0.1", port: 0, theme: "dark" };

    await token(["add", "hooks", "--pages", "200-299", "--save"], cliConfig, relayConfig);

    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(typeof saved.token, "string");
    assert.ok(saved.token.length > 0);
});
