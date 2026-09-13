import http from "node:http";
import { testcard } from "../render/frame.js";

// Minimal skeleton for the thin vertical slice: healthz + an unconditional
// test-card frame, no auth. Replaced by the full routing/auth/store-backed
// server in a later commit.
export function createServer() {
    return http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");

        if (req.method === "GET" && url.pathname === "/healthz") {
            const body = JSON.stringify({ ok: true });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(body);
            return;
        }

        if (req.method === "GET" && url.pathname === "/frame") {
            const frame = testcard();
            res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": frame.length });
            res.end(frame);
            return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "not_found", message: "not found" } }));
    });
}
