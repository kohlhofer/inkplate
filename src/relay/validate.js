import { ValidationError } from "./httpError.js";
import { parseTtl } from "./store.js";

export const PAGE_ROUTE = /^\/pages\/(\d{3})$/;
export const PREVIEW_ROUTE = /^\/preview\/(\d{3})\.png$/;
export const TOKEN_NAME_PATTERN = /^[a-z0-9-]{1,24}$/;

const C0_ALL = /[\x00-\x1f\x7f-\x9f]/g;
const C0_NO_NEWLINE = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/g;

// Strips C0/C1 control characters (keeping \n when allowNewlines is set) so
// stored text can't smuggle terminal escapes or other control bytes onto
// the board's serial log or a future viewer.
export function sanitizeText(input, { allowNewlines = false } = {}) {
    return String(input).replace(allowNewlines ? C0_NO_NEWLINE : C0_ALL, "");
}

export function validateTokenName(name) {
    if (typeof name !== "string" || !TOKEN_NAME_PATTERN.test(name)) {
        throw new ValidationError(400, "invalid_body", "token name must match ^[a-z0-9-]{1,24}$");
    }
    return name;
}

const MAX_BODY_TEXT_BYTES = 8192;
const MAX_CHART_VALUES = 600;
const VALID_LAYOUTS = new Set(["text", "image-left", "image-top", "image"]);
const VALID_IMAGE_STYLES = new Set(["dither", "blocks"]);
const VALID_CHART_TYPES = new Set(["spark", "bars"]);

function isFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
}

// GET /frame's query params: only battery/rssi/fw are optional and bounded;
// page/reason are handled by the caller (view.js needs the raw values).
export function validateFrameTelemetry({ battery, rssi, fw }) {
    const out = {};
    if (battery !== null && battery !== undefined && battery !== "") {
        const n = Number(battery);
        if (!isFiniteNumber(n) || n < 0 || n > 10) throw new ValidationError(400, "invalid_body", "invalid battery");
        out.battery = n;
    }
    if (rssi !== null && rssi !== undefined && rssi !== "") {
        const n = Number(rssi);
        if (!isFiniteNumber(n) || n < -120 || n > 0) throw new ValidationError(400, "invalid_body", "invalid rssi");
        out.rssi = n;
    }
    if (fw !== null && fw !== undefined && fw !== "") {
        const s = sanitizeText(fw).slice(0, 32);
        out.fw = s;
    }
    return out;
}

// Full validation for POST /pages/:n: page range + token range (403) +
// request body schema (400), all via one call per the plan's ordering (2.2,
// step g runs after the body is parsed).
export function validatePagePost(sender, rawDigits, body) {
    const n = Number(rawDigits);
    if (n === 100) throw new ValidationError(400, "reserved_page", "100 is the generated front page; use 101-899");
    if (n < 101 || n > 899) throw new ValidationError(400, "invalid_page", "page must be an integer 101-899");
    if (n < sender.range.min || n > sender.range.max) {
        throw new ValidationError(
            403,
            "forbidden_range",
            `token '${sender.name}' may write pages ${sender.range.min}-${sender.range.max}, got ${n}`,
        );
    }

    if (typeof body !== "object" || body === null) {
        throw new ValidationError(400, "invalid_body", "body must be a JSON object");
    }

    const title = sanitizeText(body.title ?? "", { allowNewlines: false }).trim();
    if (!title) throw new ValidationError(400, "invalid_body", "title is required");

    const bodyText = sanitizeText(body.body ?? "", { allowNewlines: true });
    if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_TEXT_BYTES) {
        throw new ValidationError(400, "invalid_body", "body exceeds 8192 bytes");
    }

    const layout = body.layout ?? "text";
    if (!VALID_LAYOUTS.has(layout)) throw new ValidationError(400, "invalid_body", "invalid layout");

    let ttlSeconds;
    try {
        ttlSeconds = parseTtl(body.ttl);
    } catch {
        throw new ValidationError(400, "invalid_ttl", "ttl must be seconds or e.g. '2h', '90m', '1d', max 7d");
    }

    const urgent = !!body.urgent;
    if (urgent && !sender.urgent) {
        throw new ValidationError(403, "forbidden_urgent", `token '${sender.name}' may not post urgent pages`);
    }

    let image = null;
    if (body.image !== undefined) {
        if (!sender.images) {
            throw new ValidationError(403, "forbidden_images", `token '${sender.name}' may not post images`);
        }
        if (typeof body.image !== "object" || body.image === null) {
            throw new ValidationError(400, "invalid_body", "invalid image");
        }
        if (!VALID_IMAGE_STYLES.has(body.image.style)) {
            throw new ValidationError(400, "invalid_body", "image style must be 'dither' or 'blocks'");
        }
        if (typeof body.image.data !== "string" || body.image.data.length === 0) {
            throw new ValidationError(400, "invalid_body", "invalid image data");
        }
        image = { style: body.image.style, data: body.image.data };
    }

    let chart = null;
    if (body.chart !== undefined) {
        if (image) throw new ValidationError(400, "invalid_body", "image and chart together are not allowed");
        if (layout !== "text") throw new ValidationError(400, "invalid_body", "chart requires layout text");
        const values = body.chart?.values;
        const valid =
            Array.isArray(values) && values.length >= 1 && values.length <= MAX_CHART_VALUES && values.every(isFiniteNumber);
        if (!valid) throw new ValidationError(400, "invalid_body", "chart values must be 1-600 numbers");
        if (!VALID_CHART_TYPES.has(body.chart.type)) {
            throw new ValidationError(400, "invalid_body", "chart type must be 'spark' or 'bars'");
        }
        chart = {
            type: body.chart.type,
            values,
            labels: Array.isArray(body.chart.labels) ? body.chart.labels.map((l) => sanitizeText(String(l))) : undefined,
            label: body.chart.label !== undefined ? sanitizeText(String(body.chart.label)) : undefined,
        };
    }

    return { number: n, title, body: bodyText, layout, urgent, ttlSeconds, image, chart };
}

export function validatePageRange(sender, rawDigits) {
    const n = Number(rawDigits);
    if (n === 100) throw new ValidationError(400, "reserved_page", "100 is the generated front page; use 101-899");
    if (n < 101 || n > 899) throw new ValidationError(400, "invalid_page", "page must be an integer 101-899");
    if (n < sender.range.min || n > sender.range.max) {
        throw new ValidationError(
            403,
            "forbidden_range",
            `token '${sender.name}' may write pages ${sender.range.min}-${sender.range.max}, got ${n}`,
        );
    }
    return n;
}
