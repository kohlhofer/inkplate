import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { PNG } from "pngjs";
import { createServer } from "../src/relay/server.js";
import { TokenStore } from "../src/relay/tokens.js";
import { FRAME_BYTES } from "../src/render/grid.js";

function makePngBase64(width, height) {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i++) {
        png.data[i * 4] = 100;
        png.data[i * 4 + 1] = 150;
        png.data[i * 4 + 2] = 200;
        png.data[i * 4 + 3] = 255;
    }
    return PNG.sync.write(png).toString("base64");
}

// Posts a large body with node:http directly (not fetch): the server is
// expected to answer before fully reading the body, and writes are paced
// with setImmediate (rather than one tight synchronous loop) so the client
// notices the early response — and stops writing — before the server's
// Connection: close would otherwise EPIPE an in-flight batched write.
function postOversized(url, headers, totalBytes) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const req = http.request(url, { method: "POST", headers }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                settled = true;
                resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
            });
        });
        req.on("error", (err) => {
            if (!settled) reject(err);
        });
        req.on("socket", (socket) => {
            // Once settled we deliberately abandon the upload; the server
            // closing mid-write can then error the socket, which is the
            // scenario under test, not a failure.
            socket.on("error", () => {
                if (!settled) reject(new Error("socket error before a response arrived"));
            });
        });
        const chunk = Buffer.alloc(8 * 1024, "x");
        let written = 0;
        const writeMore = () => {
            if (settled || written >= totalBytes) {
                if (!settled) req.end();
                return;
            }
            const remaining = totalBytes - written;
            const buf = remaining < chunk.length ? chunk.subarray(0, remaining) : chunk;
            written += buf.length;
            req.write(buf);
            setImmediate(writeMore);
        };
        writeMore();
    });
}

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "videotext-server-"));
}

// Every test gets its own dataDir and its own board/sender tokens, created
// directly via TokenStore before the server (which reads the same file) is
// constructed — this never touches the real ~/Library/Application Support.
async function withServer(fn, { theme = "dark", maxRequestBytes } = {}) {
    const dataDir = tmpDir();
    const tokens = new TokenStore(dataDir);
    const boardToken = tokens.rotateBoardToken();
    const senderToken = tokens.addSender("hooks", { pages: "200-299", images: true, urgent: true });
    const restrictedToken = tokens.addSender("readonly", { pages: "300-309" });

    const server = createServer({ dataDir, host: "127.0.0.1", port: 0, theme, maxRequestBytes });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    try {
        await fn({ base, boardToken, senderToken, restrictedToken, dataDir });
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function auth(token) {
    return { Authorization: `Bearer ${token}` };
}

test("GET /healthz needs no auth", async () => {
    await withServer(async ({ base }) => {
        const res = await fetch(`${base}/healthz`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true });
    });
});

test("GET /frame without a token is unauthorized", async () => {
    await withServer(async ({ base }) => {
        const res = await fetch(`${base}/frame`);
        assert.equal(res.status, 401);
        assert.deepEqual((await res.json()).error.code, "unauthorized");
    });
});

test("GET /frame with the board token returns a full frame with ETag and X-Page", async () => {
    await withServer(async ({ base, boardToken }) => {
        const res = await fetch(`${base}/frame?reason=boot&page=100`, { headers: auth(boardToken) });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-page"), "100");
        assert.ok(res.headers.get("etag"));
        const body = new Uint8Array(await res.arrayBuffer());
        assert.equal(body.length, FRAME_BYTES);
    });
});

test("a sender token may not fetch /frame, and the board token may not use sender routes", async () => {
    await withServer(async ({ base, boardToken, senderToken }) => {
        const senderTriesFrame = await fetch(`${base}/frame`, { headers: auth(senderToken) });
        assert.equal(senderTriesFrame.status, 403);
        assert.equal((await senderTriesFrame.json()).error.code, "forbidden_role");

        const boardTriesPages = await fetch(`${base}/pages`, { headers: auth(boardToken) });
        assert.equal(boardTriesPages.status, 403);
        assert.equal((await boardTriesPages.json()).error.code, "forbidden_role");
    });
});

test("two /frame calls inside 5s from the board token: the second is 429 and board state is unchanged", async () => {
    await withServer(async ({ base, boardToken, senderToken }) => {
        const first = await fetch(`${base}/frame?reason=timer&battery=4.0`, { headers: auth(boardToken) });
        assert.equal(first.status, 200);
        const redrawAt1 = (await (await fetch(`${base}/status`, { headers: auth(senderToken) })).json()).lastRedrawAt;

        const second = await fetch(`${base}/frame?reason=timer&battery=3.0`, { headers: auth(boardToken) });
        assert.equal(second.status, 429);

        const afterSecond = await (await fetch(`${base}/status`, { headers: auth(senderToken) })).json();
        assert.equal(afterSecond.lastRedrawAt, redrawAt1);
        assert.equal(afterSecond.board.battery, 4.0); // battery=3.0 from the 429'd call was never recorded
    });
});

test("POST /pages/:n creates a page and returns location/preview/warnings", async () => {
    await withServer(async ({ base, senderToken }) => {
        const res = await fetch(`${base}/pages/205`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Deploy done", body: "all green" }),
        });
        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.preview, "/preview/205.png");
        assert.equal(json.location, "listed on P100 at the next poll; full page via the button");
        assert.deepEqual(json.warnings, []);
    });
});

test("a 2MiB unauthenticated POST returns 401, not 413 (auth runs before the body is read)", async () => {
    await withServer(async ({ base }) => {
        const { status } = await postOversized(
            `${base}/pages/205`,
            { "Content-Type": "application/json" },
            2 * 1024 * 1024,
        );
        assert.equal(status, 401);
    });
});

test("an authenticated body over the configured cap is rejected with 413", async () => {
    // A small configured cap, well under the real 2 MiB default, keeps this
    // a small, non-racy request instead of a multi-megabyte transfer.
    await withServer(
        async ({ base, senderToken }) => {
            const res = await fetch(`${base}/pages/205`, {
                method: "POST",
                headers: { ...auth(senderToken), "Content-Type": "application/json" },
                body: JSON.stringify({ title: "t", body: "x".repeat(2000) }),
            });
            assert.equal(res.status, 413);
            assert.equal((await res.json()).error.code, "payload_too_large");
        },
        { maxRequestBytes: 1000 },
    );
});

test("POST outside the token's range is forbidden_range; urgent without capability is forbidden_urgent", async () => {
    await withServer(async ({ base, senderToken, restrictedToken }) => {
        const outOfRange = await fetch(`${base}/pages/500`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "t" }),
        });
        assert.equal(outOfRange.status, 403);
        assert.equal((await outOfRange.json()).error.code, "forbidden_range");

        const noUrgent = await fetch(`${base}/pages/305`, {
            method: "POST",
            headers: { ...auth(restrictedToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "t", urgent: true }),
        });
        assert.equal(noUrgent.status, 403);
        assert.equal((await noUrgent.json()).error.code, "forbidden_urgent");
    });
});

test("reserved and invalid page numbers 400", async () => {
    await withServer(async ({ base, senderToken }) => {
        const reserved = await fetch(`${base}/pages/100`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "t" }),
        });
        assert.equal(reserved.status, 400);
        assert.equal((await reserved.json()).error.code, "reserved_page");
    });
});

test("DELETE removes a live page (204) and 404s on a second delete", async () => {
    await withServer(async ({ base, senderToken }) => {
        await fetch(`${base}/pages/205`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "t" }),
        });
        const first = await fetch(`${base}/pages/205`, { method: "DELETE", headers: auth(senderToken) });
        assert.equal(first.status, 204);
        const second = await fetch(`${base}/pages/205`, { method: "DELETE", headers: auth(senderToken) });
        assert.equal(second.status, 404);
    });
});

test("GET /pages lists only live page numbers, ascending, excluding 100", async () => {
    await withServer(async ({ base, senderToken }) => {
        for (const n of [250, 201]) {
            await fetch(`${base}/pages/${n}`, {
                method: "POST",
                headers: { ...auth(senderToken), "Content-Type": "application/json" },
                body: JSON.stringify({ title: `page ${n}` }),
            });
        }
        const res = await fetch(`${base}/pages`, { headers: auth(senderToken) });
        assert.deepEqual(await res.json(), [201, 250]);
    });
});

test("GET /preview/100.png always renders, even with nothing live", async () => {
    await withServer(async ({ base, senderToken }) => {
        const res = await fetch(`${base}/preview/100.png`, { headers: auth(senderToken) });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "image/png");
        const bytes = new Uint8Array(await res.arrayBuffer());
        assert.equal(bytes[0], 0x89); // PNG magic byte
    });
});

test("GET /preview/:n.png 404s for a page that isn't live", async () => {
    await withServer(async ({ base, senderToken }) => {
        const res = await fetch(`${base}/preview/299.png`, { headers: auth(senderToken) });
        assert.equal(res.status, 404);
    });
});

test("GET /status reports board/livePages shape", async () => {
    await withServer(async ({ base, senderToken }) => {
        const res = await fetch(`${base}/status`, { headers: auth(senderToken) });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.board, null);
        assert.deepEqual(json.livePages, []);
        assert.ok("lastRedrawAt" in json);
    });
});

test("malformed JSON body returns a clean 400 and the server keeps answering", async () => {
    await withServer(async ({ base, senderToken }) => {
        const res = await fetch(`${base}/pages/205`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: "{not json",
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.ok(json.error.code);
        assert.ok(json.error.message);
        assert.equal(json.error.stack, undefined);

        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200);
    });
});

test("a corrupt image buffer returns a clean 4xx and the server keeps answering", async () => {
    await withServer(async ({ base, senderToken }) => {
        const res = await fetch(`${base}/pages/205`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "t", image: { style: "dither", data: "not-valid-base64-image!!" } }),
        });
        assert.ok(res.status >= 400 && res.status < 500);
        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200);
    });
});

test("bad percent-encoded URLs return a clean 4xx", async () => {
    await withServer(async ({ base }) => {
        const res = await fetch(`${base}/frame?page=%E0%A4%A`);
        assert.ok(res.status >= 400 && res.status < 500);
    });
});

test("a posted image page renders through /frame (board token) and /preview without crashing", async () => {
    // One server per combination: /frame is limited to 1 req/5s, so reusing
    // a single server across combos would race the limiter instead of
    // exercising each layout/style pair.
    for (const layout of ["image", "image-left", "image-top"]) {
        for (const style of ["dither", "blocks"]) {
            await withServer(async ({ base, senderToken, boardToken }) => {
                const posted = await fetch(`${base}/pages/210`, {
                    method: "POST",
                    headers: { ...auth(senderToken), "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: `${layout}/${style}`,
                        layout,
                        image: { data: makePngBase64(8, 8), style },
                    }),
                });
                assert.equal(posted.status, 201, `${layout}/${style} POST`);

                const frame = await fetch(`${base}/frame?reason=button&page=210`, { headers: auth(boardToken) });
                assert.equal(frame.status, 200, `${layout}/${style} /frame`);
                const bytes = new Uint8Array(await frame.arrayBuffer());
                assert.equal(bytes.length, FRAME_BYTES);

                const preview = await fetch(`${base}/preview/210.png`, { headers: auth(senderToken) });
                assert.equal(preview.status, 200, `${layout}/${style} /preview`);
                const png = new Uint8Array(await preview.arrayBuffer());
                assert.equal(png[0], 0x89);
            });
        }
    }
});

test("a filesystem error writing the image sidecar yields a generic 500, never a leaked path", async () => {
    await withServer(async ({ base, senderToken, dataDir }) => {
        // store.putImage's writeFileSync will EISDIR against a directory of
        // this name, simulating any fs-level failure unrelated to decoding.
        fs.mkdirSync(path.join(dataDir, "pages", "210.image.bin"), { recursive: true });

        const res = await fetch(`${base}/pages/210`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "t", layout: "image", image: { data: makePngBase64(8, 8), style: "dither" } }),
        });
        assert.equal(res.status, 500);
        const json = await res.json();
        assert.equal(json.error.code, "internal_error");
        assert.equal(json.error.message, "internal error");
        assert.equal(json.error.message.includes(dataDir), false);
    });
});

test("a truncated image sidecar renders the page without the image instead of 500", async () => {
    await withServer(async ({ base, senderToken, boardToken, dataDir }) => {
        const posted = await fetch(`${base}/pages/210`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "t", layout: "image", image: { data: makePngBase64(8, 8), style: "dither" } }),
        });
        assert.equal(posted.status, 201);

        fs.writeFileSync(path.join(dataDir, "pages", "210.image.bin"), Buffer.from([1, 2, 3]));

        const frame = await fetch(`${base}/frame?reason=button&page=210`, { headers: auth(boardToken) });
        assert.equal(frame.status, 200);
        assert.equal(new Uint8Array(await frame.arrayBuffer()).length, FRAME_BYTES);

        const preview = await fetch(`${base}/preview/210.png`, { headers: auth(senderToken) });
        assert.equal(preview.status, 200);
    });
});

test("unknown path 404s; known path with wrong method 405s", async () => {
    await withServer(async ({ base, senderToken }) => {
        const unknown = await fetch(`${base}/nope`);
        assert.equal(unknown.status, 404);

        const wrongMethod = await fetch(`${base}/pages`, { method: "DELETE", headers: auth(senderToken) });
        assert.equal(wrongMethod.status, 405);
    });
});
