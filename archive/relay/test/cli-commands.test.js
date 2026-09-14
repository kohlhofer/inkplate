import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "../src/relay/server.js";
import { TokenStore } from "../src/relay/tokens.js";
import { send } from "../src/cli/commands/send.js";
import { rm } from "../src/cli/commands/rm.js";
import { ls } from "../src/cli/commands/ls.js";
import { preview } from "../src/cli/commands/preview.js";
import { status } from "../src/cli/commands/status.js";
import { token } from "../src/cli/commands/token.js";

function tmpDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function captureConsole() {
    const out = [];
    const err = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a) => out.push(a.join(" "));
    console.error = (...a) => err.push(a.join(" "));
    const restore = () => {
        console.log = origLog;
        console.error = origErr;
    };
    return { out, err, restore };
}

async function withServer(fn) {
    const dataDir = tmpDir("videotext-cli-server-");
    const tokens = new TokenStore(dataDir);
    const boardToken = tokens.rotateBoardToken();
    const senderToken = tokens.addSender("hooks", { pages: "200-299", images: true, urgent: true });
    const server = createServer({ dataDir, host: "127.0.0.1", port: 0, theme: "dark" });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const config = { relay: `http://127.0.0.1:${port}`, token: senderToken, configPath: path.join(dataDir, "config.json") };
    try {
        await fn({ config, dataDir, boardToken, senderToken });
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test("serve only offers private LAN addresses for RELAY_HOST, not VPN ones", async () => {
    const { isPrivateLan } = await import("../src/cli/commands/serve.js");
    assert.equal(isPrivateLan("192.168.1.27"), true);
    assert.equal(isPrivateLan("10.0.0.5"), true);
    assert.equal(isPrivateLan("172.20.1.1"), true);
    assert.equal(isPrivateLan("100.64.0.1"), false);
    assert.equal(isPrivateLan("172.32.0.1"), false);
});

// --- send.js: M12 strict args, M13 success message, m29 page validation ---

test("send rejects an unknown flag instead of silently dropping it (M12)", async () => {
    await withServer(async ({ config }) => {
        await assert.rejects(() => send(["205", "t", "--ttlx", "2h"], config), /unknown argument '--ttlx'/);
    });
});

test("send rejects a page argument that isn't 3 digits, before building any URL (m29)", async () => {
    await withServer(async ({ config }) => {
        await assert.rejects(() => send(["205.png#/../../etc", "t"], config), /page must be a 3-digit number/);
    });
});

test("send prints the documented success line, then each warning on its own line (M13)", async () => {
    await withServer(async ({ config }) => {
        const { out, err, restore } = captureConsole();
        try {
            await send(["205", "x".repeat(60)], config); // over the 48-char title cap -> "title cut" warning
        } finally {
            restore();
        }
        assert.equal(out.length, 1);
        assert.match(out[0], /^page 205 live until .+ · first page: on the wall within about 3 minutes · vt preview 205$/);
        assert.ok(err.some((l) => l === "warning: title cut"));
    });
});

test("send rejects a value flag followed by another flag instead of posting the flag as its value", async () => {
    await withServer(async ({ config }) => {
        await assert.rejects(() => send(["205", "t", "--body", "--urgent"], config), /--body needs a value/);
    });
});

// --- rm.js ---

test("rm rejects a malformed page argument before contacting the relay (m29)", async () => {
    await withServer(async ({ config }) => {
        await assert.rejects(() => rm(["abc"], config), /page must be a 3-digit number/);
    });
});

test("rm removes a page it just sent", async () => {
    await withServer(async ({ config }) => {
        await send(["205", "t"], config);
        const { out, restore } = captureConsole();
        try {
            await rm(["205"], config);
        } finally {
            restore();
        }
        assert.deepEqual(out, ["removed page 205"]);
    });
});

// --- preview.js ---

test("preview rejects a malformed page argument (m29)", async () => {
    await withServer(async ({ config }) => {
        await assert.rejects(() => preview(["../../etc"], config), /page must be a 3-digit number/);
    });
});

test("preview shows the relay's error message on failure, not a bare status code (m10)", async () => {
    await withServer(async ({ config }) => {
        const { err, restore } = captureConsole();
        let exitCode;
        const origExit = process.exitCode;
        try {
            await preview(["299"], config); // never posted -> 404 not_found
            exitCode = process.exitCode;
        } finally {
            restore();
            process.exitCode = origExit;
        }
        assert.equal(exitCode, 1);
        assert.ok(err.some((l) => l.includes("page 299 not found")));
    });
});

// --- ls.js ---

test("ls prints 'no pages live' when nothing is posted", async () => {
    await withServer(async ({ config }) => {
        const { out, restore } = captureConsole();
        try {
            await ls([], config);
        } finally {
            restore();
        }
        assert.deepEqual(out, ["no pages live"]);
    });
});

test("ls prints aligned number/sender/title/expiry columns (M14)", async () => {
    await withServer(async ({ config }) => {
        await send(["205", "short"], config);
        await send(["206", "a longer title"], config);
        const { out, restore } = captureConsole();
        try {
            await ls([], config);
        } finally {
            restore();
        }
        assert.equal(out.length, 2);
        for (const line of out) {
            assert.match(line, /^.20[56]\s+hooks\s+.+\s+expires .+$/);
        }
    });
});

test("ls rejects extra arguments", async () => {
    await withServer(async ({ config }) => {
        await assert.rejects(() => ls(["205"], config), /usage: vt ls/);
    });
});

// --- status.js ---

test("status prints 'board has never connected' and 'last redraw never' before any /frame fetch (M15)", async () => {
    await withServer(async ({ config }) => {
        const { out, restore } = captureConsole();
        try {
            await status([], config);
        } finally {
            restore();
        }
        assert.deepEqual(out, ["board has never connected", "last redraw never"]);
    });
});

test("status --json prints the raw response", async () => {
    await withServer(async ({ config }) => {
        const { out, restore } = captureConsole();
        try {
            await status(["--json"], config);
        } finally {
            restore();
        }
        const parsed = JSON.parse(out.join("\n"));
        assert.equal(parsed.board, null);
    });
});

// --- token.js ---

test("revoking an unknown token exits 1 (m14)", async () => {
    await withServer(async ({ dataDir, config }) => {
        const { err, restore } = captureConsole();
        const origExit = process.exitCode;
        try {
            await token(["revoke", "nope"], config, { dataDir, host: "127.0.0.1", port: 0, theme: "dark" });
        } finally {
            restore();
            var exitCode = process.exitCode;
            process.exitCode = origExit;
        }
        assert.equal(exitCode, 1);
        assert.ok(err.some((l) => l.includes("no such token")));
    });
});

// --- bin/vt.js: help/usage (spawned, since main() reads argv/exits directly) ---

const VT_BIN = new URL("../bin/vt.js", import.meta.url).pathname;

function runVt(args) {
    try {
        const out = execFileSync(process.execPath, [VT_BIN, ...args], { encoding: "utf8" });
        return { status: 0, out };
    } catch (err) {
        return { status: err.status, out: err.stdout, err: err.stderr };
    }
}

test("vt, vt help, and vt --help print usage and exit 0 (m13)", () => {
    for (const args of [[], ["help"], ["--help"]]) {
        const { status: code, out } = runVt(args);
        assert.equal(code, 0);
        assert.match(out, /^usage: vt /);
    }
});

test("an unknown command prints usage and exits 1", () => {
    const { status: code, err } = runVt(["bogus"]);
    assert.equal(code, 1);
    assert.match(err, /unknown command 'bogus'/);
});
