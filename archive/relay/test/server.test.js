import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { PNG } from "pngjs";
import { createServer } from "../src/relay/server.js";
import { TokenStore } from "../src/relay/tokens.js";
import { Board } from "../src/relay/board.js";
import { FRAME_BYTES, PANEL_WIDTH, CELL_HEIGHT } from "../src/render/grid.js";
import { rowY, TITLE_ROW_START } from "../src/render/layout.js";
import { PALETTE } from "../src/render/palette.js";

function unpackFrameIndex(bytes, x, y) {
    const byte = bytes[y * (PANEL_WIDTH / 2) + Math.floor(x / 2)];
    return x % 2 === 0 ? byte >> 4 : byte & 0x0f;
}

// True if palette index `index`'s RGB appears anywhere in the banner row of
// a packed /frame buffer (indices) or a decoded /preview PNG (rgba bytes).
function bannerRowHasIndex(pixels, isPng, index) {
    const y0 = rowY(TITLE_ROW_START);
    const rgb = PALETTE[index].rgb;
    for (let y = y0; y < y0 + CELL_HEIGHT; y++) {
        for (let x = 0; x < PANEL_WIDTH; x++) {
            if (isPng) {
                const i = (y * PANEL_WIDTH + x) * 4;
                if (pixels[i] === rgb[0] && pixels[i + 1] === rgb[1] && pixels[i + 2] === rgb[2]) return true;
            } else if (unpackFrameIndex(pixels, x, y) === index) {
                return true;
            }
        }
    }
    return false;
}

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
async function withServer(fn, { theme = "dark", maxRequestBytes, frameRateLimit } = {}) {
    const dataDir = tmpDir();
    const tokens = new TokenStore(dataDir);
    const boardToken = tokens.rotateBoardToken();
    const senderToken = tokens.addSender("hooks", { pages: "200-299", images: true, urgent: true });
    const restrictedToken = tokens.addSender("readonly", { pages: "300-309" });

    const server = createServer({ dataDir, host: "127.0.0.1", port: 0, theme, maxRequestBytes, frameRateLimit });
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

test("headersTimeout/connectionsCheckingInterval are tightened; requestTimeout stays 10s (m31)", () => {
    const server = createServer({ dataDir: tmpDir(), host: "127.0.0.1", port: 0, theme: "dark" });
    assert.equal(server.headersTimeout, 5000);
    assert.equal(server.connectionsCheckingInterval, 2000);
    assert.equal(server.requestTimeout, 10000);
});

test("an invalid reason is rejected before anything is stored (m30)", async () => {
    await withServer(async ({ base, boardToken, senderToken }) => {
        const res = await fetch(`${base}/frame?reason=reboot`, { headers: auth(boardToken) });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error.code, "invalid_reason");

        const status = await (await fetch(`${base}/status`, { headers: auth(senderToken) })).json();
        assert.equal(status.board, null); // recordFetch never ran
    });
});

test("the data dir is chmod 0700 and written page/board files are 0600 (m32)", async () => {
    await withServer(async ({ base, boardToken, senderToken, dataDir }) => {
        assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);

        await fetch(`${base}/pages/205`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "t" }),
        });
        assert.equal(fs.statSync(path.join(dataDir, "pages", "205.json")).mode & 0o777, 0o600);

        await fetch(`${base}/frame`, { headers: auth(boardToken) });
        assert.equal(fs.statSync(path.join(dataDir, "status.json")).mode & 0o777, 0o600);
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

test("a timer request without If-None-Match always renders 200, even inside the coalescing window (B2)", async () => {
    await withServer(async ({ base, boardToken, dataDir }) => {
        // Simulate a redraw that "just happened" (well inside
        // MIN_REDRAW_INTERVAL_MS) directly via on-disk board state, so one
        // /frame call is enough to prove it's the missing If-None-Match —
        // not the window — that forces a render.
        new Board(dataDir).recordRedraw(Date.now());

        const res = await fetch(`${base}/frame?reason=timer`, { headers: auth(boardToken) });
        assert.equal(res.status, 200);
    });
});

test("a coalesced 304 echoes the request's If-None-Match as its ETag so the board keeps its cache", async () => {
    await withServer(
        async ({ base, boardToken }) => {
            // A real redraw puts the next timer poll inside the coalescing window.
            const first = await fetch(`${base}/frame?reason=boot`, { headers: auth(boardToken) });
            assert.equal(first.status, 200);

            // A stale ETag would normally render; coalescing answers first.
            const res = await fetch(`${base}/frame?reason=timer&page=100`, {
                headers: { ...auth(boardToken), "If-None-Match": "abc123" },
            });
            assert.equal(res.status, 304);
            assert.equal(res.headers.get("etag"), "abc123");
            assert.equal(res.headers.get("x-page"), "100");
        },
        { frameRateLimit: { windowMs: 5000, max: 2 } },
    );
});

test("an honest If-None-Match match leaves lastRedrawAt untouched, unlike a real redraw (B2/M2)", async () => {
    await withServer(
        async ({ base, boardToken, senderToken }) => {
            const first = await fetch(`${base}/frame?reason=boot`, { headers: auth(boardToken) });
            assert.equal(first.status, 200);
            const etag = first.headers.get("etag");
            const afterFirst = await (await fetch(`${base}/status`, { headers: auth(senderToken) })).json();

            // reason=boot never coalesces (shouldCoalesce only applies to
            // timer), so this exercises the etag-comparison 304 path, not
            // the coalescing short-circuit; a relaxed /frame limit lets the
            // test issue two calls without waiting out the real 5s window.
            const second = await fetch(`${base}/frame?reason=boot`, {
                headers: { ...auth(boardToken), "If-None-Match": etag },
            });
            assert.equal(second.status, 304);
            const afterSecond = await (await fetch(`${base}/status`, { headers: auth(senderToken) })).json();
            assert.equal(afterSecond.lastRedrawAt, afterFirst.lastRedrawAt);
        },
        { frameRateLimit: { windowMs: 5000, max: 2 } },
    );
});

function postPage(base, token, n, body) {
    return fetch(`${base}/pages/${n}`, {
        method: "POST",
        headers: { ...auth(token), "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

test("with no urgent page, boot shows the first content page and the index comes after the last page", async () => {
    await withServer(
        async ({ base, boardToken, senderToken }) => {
            await postPage(base, senderToken, 205, { title: "first" });
            await postPage(base, senderToken, 230, { title: "second" });

            const boot = await fetch(`${base}/frame?reason=boot&page=100`, { headers: auth(boardToken) });
            assert.equal(boot.headers.get("x-page"), "205");
            const next = await fetch(`${base}/frame?reason=button&page=230`, { headers: auth(boardToken) });
            assert.equal(next.headers.get("x-page"), "100");
        },
        { frameRateLimit: { windowMs: 5000, max: 2 } },
    );
});

test("a button press never triggers or consumes the urgent bypass (M1)", async () => {
    await withServer(async ({ base, boardToken, senderToken }) => {
        await postPage(base, senderToken, 205, { title: "normal page" });
        await postPage(base, senderToken, 250, { title: "urgent page", urgent: true });

        // From the index the button goes to the first page, not to the pending urgent one.
        const res = await fetch(`${base}/frame?reason=button&page=100`, { headers: auth(boardToken) });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-page"), "205");

        const status = await (await fetch(`${base}/status`, { headers: auth(senderToken) })).json();
        assert.equal(status.lastUrgentBypassAt, null);
        assert.equal(status.board.lastUrgentAckAt, null);
    });
});

test("an unseen urgent page is put on the wall itself on a timer wake, and showing it acknowledges it", async () => {
    await withServer(async ({ base, boardToken, senderToken }) => {
        await postPage(base, senderToken, 205, { title: "normal page" });
        await postPage(base, senderToken, 250, { title: "urgent page", urgent: true });

        const res = await fetch(`${base}/frame?reason=timer&page=205`, { headers: auth(boardToken) });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-page"), "250");

        const status = await (await fetch(`${base}/status`, { headers: auth(senderToken) })).json();
        assert.ok(status.lastUrgentBypassAt);
        assert.ok(status.board.lastUrgentAckAt);
    });
});

test("preview of page 100 shows the same urgent banner the board's /frame gets", async () => {
    await withServer(async ({ base, boardToken, senderToken }) => {
        await postPage(base, senderToken, 205, { title: "urgent page", urgent: true });

        // The button after the last page lands on the index.
        const frame = await fetch(`${base}/frame?reason=button&page=205`, { headers: auth(boardToken) });
        assert.equal(frame.status, 200);
        assert.equal(frame.headers.get("x-page"), "100");
        const frameBytes = new Uint8Array(await frame.arrayBuffer());

        const preview = await fetch(`${base}/preview/100.png`, { headers: auth(senderToken) });
        const png = PNG.sync.read(Buffer.from(await preview.arrayBuffer()));

        assert.ok(bannerRowHasIndex(frameBytes, false, 4)); // 4 == red, the urgent banner's band
        assert.ok(bannerRowHasIndex(png.data, true, 4));
    });
});

test("a second urgent page posted within the bypass cooldown still shows as the P100 banner", async () => {
    await withServer(async ({ base, boardToken, senderToken }) => {
        await fetch(`${base}/pages/205`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "first urgent", urgent: true }),
        });
        const first = await fetch(`${base}/frame?reason=timer&page=205`, { headers: auth(boardToken) });
        assert.equal(first.headers.get("x-page"), "205"); // bypass fired

        await fetch(`${base}/pages/206`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "second urgent", urgent: true }),
        });

        // The cooldown (proven at the pure view.js level) suppresses a
        // second forced bypass, but the banner itself is just bannerPage()
        // over the live set — it must still reflect the newer urgent page.
        const preview = await fetch(`${base}/preview/100.png`, { headers: auth(senderToken) });
        const png = PNG.sync.read(Buffer.from(await preview.arrayBuffer()));
        assert.ok(bannerRowHasIndex(png.data, true, 4));
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
        assert.equal(json.location, "first page: on the wall within about 3 minutes");
        assert.deepEqual(json.warnings, []);
    });
});

test("describeLocation says whether a page is first, urgent, or behind another page", async () => {
    const { describeLocation } = await import("../src/relay/server.js");
    const summaries = [{ number: 150 }, { number: 205 }];
    assert.equal(describeLocation({ number: 150, urgent: false }, summaries), "first page: on the wall within about 3 minutes");
    assert.equal(describeLocation({ number: 205, urgent: false }, summaries), "the wall shows page 150 first; press the button to reach 205");
    assert.equal(describeLocation({ number: 205, urgent: true }, summaries), "urgent: on the wall at the board's next poll");
});

test("a live page held by another sender can't be overwritten without replace, and replace warns", async () => {
    await withServer(async ({ base, dataDir, senderToken }) => {
        const other = new TokenStore(dataDir).addSender("other", { pages: "200-299", images: false, urgent: false });
        const post = (token, body) =>
            fetch(`${base}/pages/205`, {
                method: "POST",
                headers: { ...auth(token), "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

        assert.equal((await post(senderToken, { title: "mine" })).status, 201);

        const refused = await post(other, { title: "theirs" });
        assert.equal(refused.status, 409);
        const error = (await refused.json()).error;
        assert.equal(error.code, "page_taken");
        assert.match(error.message, /held by 'hooks'/);

        const replaced = await post(other, { title: "theirs", replace: true });
        assert.equal(replaced.status, 201);
        assert.ok((await replaced.json()).warnings.includes("replaced page 205 from 'hooks'"));

        // the original sender re-posting over its own page is never blocked
        assert.equal((await post(other, { title: "theirs again" })).status, 201);
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

test("rejected writes (4xx) never count toward the write rate limit, only a 2xx does (m11)", async () => {
    await withServer(async ({ base, senderToken }) => {
        // WRITE_RATE_LIMIT.max is 10; 15 rejected attempts in a row must
        // never trip it, since none of them actually wrote anything.
        for (let i = 0; i < 15; i++) {
            const res = await fetch(`${base}/pages/205`, {
                method: "POST",
                headers: { ...auth(senderToken), "Content-Type": "application/json" },
                body: JSON.stringify({ title: "" }), // invalid: title is required
            });
            assert.equal(res.status, 400);
        }
        const ok = await fetch(`${base}/pages/205`, {
            method: "POST",
            headers: { ...auth(senderToken), "Content-Type": "application/json" },
            body: JSON.stringify({ title: "valid" }),
        });
        assert.equal(ok.status, 201);
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

test("GET /pages lists live pages ascending, excluding 100, with number/title/sender/urgent/layout/postedAt/expiresAt (M14)", async () => {
    await withServer(async ({ base, senderToken }) => {
        for (const n of [250, 201]) {
            await fetch(`${base}/pages/${n}`, {
                method: "POST",
                headers: { ...auth(senderToken), "Content-Type": "application/json" },
                body: JSON.stringify({ title: `page ${n}` }),
            });
        }
        const res = await fetch(`${base}/pages`, { headers: auth(senderToken) });
        const pages = await res.json();
        assert.deepEqual(
            pages.map((p) => p.number),
            [201, 250],
        );
        for (const p of pages) {
            assert.deepEqual(Object.keys(p).sort(), ["expiresAt", "layout", "number", "postedAt", "sender", "title", "urgent"]);
            assert.equal(p.sender, "hooks");
            assert.equal(p.urgent, false);
        }
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
