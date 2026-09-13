import http from "node:http";
import { PNG } from "pngjs";
import { loadConfig, MAX_REQUEST_BYTES, REQUEST_TIMEOUT_MS, MAX_CONNECTIONS, WRITE_RATE_LIMIT, FRAME_RATE_LIMIT } from "./config.js";
import { sendError, ValidationError } from "./httpError.js";
import { TokenStore } from "./tokens.js";
import { Store, formatDisplay } from "./store.js";
import { Board } from "./board.js";
import { RateLimiter } from "./ratelimit.js";
import { validatePagePost, validatePageRange, validateFrameTelemetry, PAGE_ROUTE, PREVIEW_ROUTE } from "./validate.js";
import { resolvePage, shouldCoalesce, isUrgentBypassActive, pollHint } from "../render/view.js";
import { renderFrame } from "../render/frame.js";
import { lint } from "../render/lint.js";
import { themeFor } from "../render/theme.js";
import { regionsFor } from "../render/layout.js";
import { PANEL_WIDTH, PANEL_HEIGHT } from "../render/grid.js";
import { PALETTE } from "../render/palette.js";
import { decodeImage } from "../image/decode.js";
import { computeFit, resample } from "../image/fit.js";
import { ditherFloydSteinberg } from "../image/dither.js";
import { quantizeBlocks } from "../image/blocks.js";

// Auth-before-body ordering (2.2) is load-bearing: an unauthenticated 2MiB
// POST returns 401, never 413, because we never start reading the body
// until auth+role+rate-limit have all passed.
let uncaughtHandlerInstalled = false;
function installUncaughtExceptionHandler() {
    if (uncaughtHandlerInstalled) return;
    uncaughtHandlerInstalled = true;
    process.on("uncaughtException", (err) => {
        console.error(`videotext: uncaught exception: ${err.stack ?? err}`);
    });
}

function readBody(req, cap) {
    return new Promise((resolve, reject) => {
        let total = 0;
        let over = false;
        const chunks = [];
        req.on("data", (chunk) => {
            if (over) return;
            total += chunk.length;
            if (total > cap) {
                over = true;
                // Let the rest of the body drain rather than destroying the
                // shared socket, so the 413 response can still be flushed.
                reject(Object.assign(new Error("payload too large"), { tooLarge: true }));
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (!over) resolve(Buffer.concat(chunks));
        });
        req.on("error", reject);
    });
}

function buildPreviewPng(indices) {
    const png = new PNG({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
    for (let i = 0; i < indices.length; i++) {
        const [r, g, b] = PALETTE[indices[i]].rgb;
        png.data[i * 4] = r;
        png.data[i * 4 + 1] = g;
        png.data[i * 4 + 2] = b;
        png.data[i * 4 + 3] = 255;
    }
    return PNG.sync.write(png);
}

export function createServer(config = loadConfig()) {
    installUncaughtExceptionHandler();

    const maxRequestBytes = config.maxRequestBytes ?? MAX_REQUEST_BYTES;
    const tokens = new TokenStore(config.dataDir);
    const store = new Store(config.dataDir);
    const board = new Board(config.dataDir);
    const theme = themeFor(config.theme);
    const writeLimiter = new RateLimiter(WRITE_RATE_LIMIT.windowMs, WRITE_RATE_LIMIT.max);
    const frameLimiter = new RateLimiter(FRAME_RATE_LIMIT.windowMs, FRAME_RATE_LIMIT.max);

    function authenticate(req) {
        const header = req.headers["authorization"];
        if (!header || !header.startsWith("Bearer ")) return null;
        const token = header.slice("Bearer ".length).trim();
        if (!token) return null;
        return tokens.authenticate(token);
    }

    // A record's `image` field is only {style,width,height}; the pixels live
    // in a separate sidecar file. Resolve it here (never in frame.js, which
    // stays a pure pixel compositor) so a missing/truncated sidecar renders
    // the page without the image instead of 500ing (finding B1).
    function loadRenderPage(n, now) {
        const record = store.getLive(n, now);
        if (!record) return null;
        return { ...record, image: store.loadImage(record) };
    }

    function handleFrame(req, res, url) {
        const now = Date.now();
        if (!frameLimiter.check("board", now)) {
            sendError(res, 429, "rate_limited", "too many /frame requests; try again shortly");
            return;
        }

        const telemetry = validateFrameTelemetry({
            battery: url.searchParams.get("battery"),
            rssi: url.searchParams.get("rssi"),
            fw: url.searchParams.get("fw"),
        });
        const reason = url.searchParams.get("reason") ?? "boot";
        const parsedPage = Number(url.searchParams.get("page"));
        const requestedPage = Number.isInteger(parsedPage) ? parsedPage : 100;

        board.recordFetch({ ...telemetry, page: requestedPage, reason }, now);

        const boardSnapshot = board.snapshot();
        const liveSummaries = store.liveSummaries(now);
        const urgentBypassActive = isUrgentBypassActive(liveSummaries, boardSnapshot, now);

        if (shouldCoalesce({ reason }, boardSnapshot, urgentBypassActive, now)) {
            res.writeHead(304);
            res.end();
            return;
        }

        const resolvedNumber = resolvePage({ reason, page: requestedPage }, liveSummaries, boardSnapshot, now);
        const snapshot =
            resolvedNumber === 100 ? { liveSummaries } : { page: loadRenderPage(resolvedNumber, now), liveSummaries };
        const { bytes, etag } = renderFrame(resolvedNumber, snapshot, boardSnapshot, theme);

        board.recordRedraw(now);
        if (urgentBypassActive) board.recordUrgentBypass(now);

        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { ETag: etag, "X-Page": String(resolvedNumber) });
            res.end();
            return;
        }

        const headers = {
            "Content-Type": "application/octet-stream",
            "Content-Length": bytes.length,
            ETag: etag,
            "X-Page": String(resolvedNumber),
        };
        const poll = pollHint(board.snapshot(), now);
        if (poll !== undefined) headers["X-Poll"] = String(poll);
        res.writeHead(200, headers);
        res.end(bytes);
    }

    async function handlePostPage(req, res, digits, sender) {
        let raw;
        try {
            raw = await readBody(req, maxRequestBytes);
        } catch (err) {
            if (err.tooLarge) {
                sendError(res, 413, "payload_too_large", "request body exceeds 2 MiB");
                return;
            }
            throw err;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw.toString("utf8"));
        } catch {
            sendError(res, 400, "invalid_body", "malformed JSON body");
            return;
        }

        const fields = validatePagePost(sender, digits, parsed);
        const now = Date.now();
        const lintResult = lint({ title: fields.title, body: fields.body, layout: fields.layout });

        let imageMeta = null;
        if (fields.image) {
            try {
                const decoded = decodeImage(Buffer.from(fields.image.data, "base64"));
                const regions = regionsFor(fields.layout);
                const box = regions.image ?? regions.text;
                const fit = computeFit(decoded.width, decoded.height, box.w, box.h);
                const resampled = resample(decoded.rgba, decoded.width, decoded.height, fit.width, fit.height);
                const indices =
                    fields.image.style === "blocks"
                        ? quantizeBlocks(resampled, fit.width, fit.height)
                        : ditherFloydSteinberg(resampled, fit.width, fit.height);
                store.putImage(fields.number, Buffer.from(indices));
                imageMeta = { style: fields.image.style, width: fit.width, height: fit.height };
            } catch (err) {
                err.imageError = true;
                throw err;
            }
        } else {
            store.deleteImage(fields.number);
        }

        const postedAt = now;
        const expiresAt = now + fields.ttlSeconds * 1000;
        const record = store.put(
            fields.number,
            {
                title: lintResult.title,
                body: fields.body,
                layout: fields.layout,
                sender: sender.name,
                postedAt,
                postedDisplay: formatDisplay(postedAt),
                expiresAt,
                expiresDisplay: formatDisplay(expiresAt),
                urgent: fields.urgent,
                image: imageMeta,
                chart: fields.chart,
            },
            now,
        );

        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                number: record.number,
                postedAt: record.postedAt,
                expiresAt: record.expiresAt,
                location: "listed on P100 at the next poll; full page via the button",
                preview: `/preview/${record.number}.png`,
                warnings: lintResult.warnings,
            }),
        );
    }

    function handleDeletePage(req, res, digits, sender) {
        const now = Date.now();
        const n = validatePageRange(sender, digits);
        const existed = store.remove(n, now);
        if (!existed) {
            sendError(res, 404, "not_found", `page ${n} not found`);
            return;
        }
        res.writeHead(204);
        res.end();
    }

    function handleListPages(req, res) {
        const numbers = store.liveSummaries(Date.now()).map((p) => p.number);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(numbers));
    }

    function handlePreview(req, res, digits) {
        const now = Date.now();
        const n = Number(digits);
        const liveSummaries = store.liveSummaries(now);
        let snapshot;
        if (n === 100) {
            snapshot = { liveSummaries };
        } else {
            const page = loadRenderPage(n, now);
            if (!page) {
                sendError(res, 404, "not_found", `page ${n} not found`);
                return;
            }
            snapshot = { page, liveSummaries };
        }
        const { indices } = renderFrame(n, snapshot, board.snapshot(), theme);
        const png = buildPreviewPng(indices);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length });
        res.end(png);
    }

    function handleStatus(req, res) {
        const snapshot = board.snapshot();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                board: snapshot.lastSeen === null ? null : snapshot,
                lastRedrawAt: snapshot.lastRedrawAt,
                lastButtonAt: snapshot.lastButtonAt,
                lastUrgentBypassAt: snapshot.lastUrgentBypassAt,
                livePages: store.liveSummaries(Date.now()).map((p) => p.number),
            }),
        );
    }

    const server = http.createServer(async (req, res) => {
        try {
            let url;
            try {
                url = new URL(req.url, "http://localhost");
            } catch {
                sendError(res, 400, "invalid_request", "malformed URL");
                return;
            }
            const { pathname } = url;
            const pagesMatch = PAGE_ROUTE.exec(pathname);
            const previewMatch = PREVIEW_ROUTE.exec(pathname);

            if (req.method === "GET" && pathname === "/healthz") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
                return;
            }

            let route = null;
            if (req.method === "GET" && pathname === "/frame") route = "frame";
            else if (pagesMatch && req.method === "POST") route = "postPage";
            else if (pagesMatch && req.method === "DELETE") route = "deletePage";
            else if (req.method === "GET" && pathname === "/pages") route = "listPages";
            else if (previewMatch && req.method === "GET") route = "preview";
            else if (req.method === "GET" && pathname === "/status") route = "status";

            if (route === null) {
                const knownPath = pathname === "/frame" || pathname === "/pages" || pathname === "/status" || pagesMatch || previewMatch;
                if (knownPath) {
                    sendError(res, 405, "method_not_allowed", "method not allowed");
                } else {
                    sendError(res, 404, "not_found", `path ${pathname} not found`);
                }
                return;
            }

            const auth = authenticate(req);
            if (!auth) {
                sendError(res, 401, "unauthorized", "missing or unknown token");
                return;
            }

            if (route === "frame") {
                if (auth.role !== "board") {
                    sendError(res, 403, "forbidden_role", "sender tokens may not fetch /frame");
                    return;
                }
                handleFrame(req, res, url);
                return;
            }

            if (auth.role !== "sender") {
                sendError(res, 403, "forbidden_role", "board tokens may only fetch /frame");
                return;
            }

            if (route === "postPage" || route === "deletePage") {
                if (!writeLimiter.check(auth.name, Date.now())) {
                    const retrySec = Math.ceil(writeLimiter.retryAfterMs(auth.name, Date.now()) / 1000);
                    sendError(res, 429, "rate_limited", `too many writes; try again in ${retrySec}s`);
                    return;
                }
            }

            if (route === "postPage") await handlePostPage(req, res, pagesMatch[1], auth);
            else if (route === "deletePage") handleDeletePage(req, res, pagesMatch[1], auth);
            else if (route === "listPages") handleListPages(req, res);
            else if (route === "preview") handlePreview(req, res, previewMatch[1]);
            else if (route === "status") handleStatus(req, res);
        } catch (err) {
            if (err instanceof ValidationError) {
                sendError(res, err.status, err.code, err.message);
                return;
            }
            // decodeImage/fit/dither/blocks throw plain Errors on bad or
            // oversized image input; everything else is a genuine bug.
            const isImageError = err.imageError === true;
            console.error(`videotext: request error: ${err.stack ?? err}`);
            try {
                if (isImageError) {
                    sendError(res, 400, "unsupported_image", err.message);
                } else {
                    sendError(res, 500, "internal_error", "internal error");
                }
            } catch {
                // response already sent
            }
        }
    });

    server.headersTimeout = REQUEST_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.maxConnections = MAX_CONNECTIONS;

    // A client that keeps writing after we respond and close (the 401-
    // before-reading-the-body case) can EPIPE/ECONNRESET the socket; that's
    // an ordinary disconnect, not a server bug, so it must not crash us.
    server.on("connection", (socket) => socket.on("error", () => {}));

    return server;
}
