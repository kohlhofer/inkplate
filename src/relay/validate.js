import { ValidationError } from "./httpError.js";
import { parseTtl } from "./store.js";

// Route matching (server.js's step (a), before auth) only needs to know
// "this looks like a /pages or /preview path" — matching any single path
// segment (never crossing a "/", which rules out traversal shapes) so a
// malformed page number still reaches auth/field-validation and comes back
// as 400 invalid_page instead of a bare 404 (finding M11).
export const PAGE_ROUTE = /^\/pages\/([^/]+)$/;
export const PREVIEW_ROUTE = /^\/preview\/([^/]+)$/;
export const PAGE_NUMBER_PATTERN = /^\d{3}$/;
export const TOKEN_NAME_PATTERN = /^[a-z0-9-]{1,24}$/;

const VALID_REASONS = new Set(["boot", "timer", "button"]);

// GET /frame's reason param, validated before board.recordFetch ever stores
// it (finding m30).
export function validateReason(raw) {
    const reason = raw ?? "boot";
    if (!VALID_REASONS.has(reason)) {
        throw new ValidationError(400, "invalid_reason", "reason must be boot, timer, or button");
    }
    return reason;
}

// Shared by validatePagePost/validatePageRange: the outer route regex above
// accepts any non-slash segment, so the 3-digit shape has to be checked here
// instead — Number("abc") is NaN, and NaN fails every numeric comparison,
// which would otherwise let a non-digit segment sail through unchecked.
function parsePageDigits(rawDigits) {
    if (!PAGE_NUMBER_PATTERN.test(String(rawDigits))) {
        throw new ValidationError(400, "invalid_page", "page must be an integer 101-899");
    }
    return Number(rawDigits);
}

const PREVIEW_SEGMENT_PATTERN = /^(\d{3})\.png$/;

// /preview/:n.png allows n=100 (always renders) in addition to 101-899.
export function parsePreviewNumber(rawSegment) {
    const match = PREVIEW_SEGMENT_PATTERN.exec(String(rawSegment));
    const n = match ? Number(match[1]) : NaN;
    if (!match || (n !== 100 && (n < 101 || n > 899))) {
        throw new ValidationError(400, "invalid_page", "page must be 100 or an integer 101-899, e.g. /preview/205.png");
    }
    return n;
}

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
const IMAGE_LAYOUTS = new Set(["image", "image-left", "image-top"]);
const VALID_IMAGE_STYLES = new Set(["dither", "blocks"]);
const VALID_CHART_TYPES = new Set(["spark", "bars"]);
const VALID_BODY_KEYS = ["title", "body", "ttl", "urgent", "layout", "image", "chart", "replace"];

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
    const n = parsePageDigits(rawDigits);
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

    for (const key of Object.keys(body)) {
        if (!VALID_BODY_KEYS.includes(key)) {
            throw new ValidationError(400, "invalid_body", `unknown field '${key}'; valid fields are ${VALID_BODY_KEYS.join(", ")}`);
        }
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

    let urgent = false;
    if (body.urgent !== undefined) {
        if (typeof body.urgent !== "boolean") {
            throw new ValidationError(400, "invalid_body", "urgent must be a boolean");
        }
        urgent = body.urgent;
    }
    if (urgent && !sender.urgent) {
        throw new ValidationError(403, "forbidden_urgent", `token '${sender.name}' may not post urgent pages`);
    }

    let image = null;
    if (body.image !== undefined) {
        if (!sender.images) {
            throw new ValidationError(403, "forbidden_images", `token '${sender.name}' may not post images`);
        }
        if (!IMAGE_LAYOUTS.has(layout)) {
            throw new ValidationError(400, "invalid_body", "image requires layout image, image-left or image-top");
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

    if (body.replace !== undefined && typeof body.replace !== "boolean") {
        throw new ValidationError(400, "invalid_body", "replace must be a boolean");
    }
    const replace = body.replace === true;

    return { number: n, title, body: bodyText, layout, urgent, ttlSeconds, image, chart, replace };
}

export function validatePageRange(sender, rawDigits) {
    const n = parsePageDigits(rawDigits);
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
