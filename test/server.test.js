import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/relay/server.js";
import { FRAME_BYTES } from "../src/render/grid.js";

async function withServer(fn) {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test("GET /healthz needs no auth and returns ok", async () => {
    await withServer(async (base) => {
        const res = await fetch(`${base}/healthz`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true });
    });
});

test("GET /frame returns exactly one frame's worth of bytes", async () => {
    await withServer(async (base) => {
        const res = await fetch(`${base}/frame`);
        assert.equal(res.status, 200);
        const body = new Uint8Array(await res.arrayBuffer());
        assert.equal(body.length, FRAME_BYTES);
    });
});

test("unknown path 404s", async () => {
    await withServer(async (base) => {
        const res = await fetch(`${base}/nope`);
        assert.equal(res.status, 404);
    });
});
