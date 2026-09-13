import { test } from "node:test";
import assert from "node:assert/strict";
import {
    sanitizeText,
    validateTokenName,
    validateFrameTelemetry,
    validatePagePost,
    validatePageRange,
    PAGE_ROUTE,
} from "../src/relay/validate.js";
import { ValidationError } from "../src/relay/httpError.js";

test("sanitizeText strips C0/C1 control characters", () => {
    assert.equal(sanitizeText("hi\x01\x1bthere\x7f"), "hithere");
});

test("sanitizeText keeps newlines only when allowNewlines is set", () => {
    assert.equal(sanitizeText("a\nb", { allowNewlines: true }), "a\nb");
    assert.equal(sanitizeText("a\nb", { allowNewlines: false }), "ab");
});

test("validateFrameTelemetry rejects out-of-range battery and rssi", () => {
    assert.throws(() => validateFrameTelemetry({ battery: "20" }), ValidationError);
    assert.throws(() => validateFrameTelemetry({ battery: "-1" }), ValidationError);
    assert.throws(() => validateFrameTelemetry({ rssi: "5" }), ValidationError);
    assert.throws(() => validateFrameTelemetry({ rssi: "-200" }), ValidationError);
    assert.deepEqual(validateFrameTelemetry({ battery: "4.1", rssi: "-60", fw: "1.0" }), {
        battery: 4.1,
        rssi: -60,
        fw: "1.0",
    });
});

test("validateFrameTelemetry ignores absent fields", () => {
    assert.deepEqual(validateFrameTelemetry({ battery: null, rssi: undefined, fw: "" }), {});
});

test("validateTokenName enforces ^[a-z0-9-]{1,24}$", () => {
    assert.equal(validateTokenName("hooks-1"), "hooks-1");
    assert.throws(() => validateTokenName("Hooks"), ValidationError);
    assert.throws(() => validateTokenName(""), ValidationError);
    assert.throws(() => validateTokenName("a".repeat(25)), ValidationError);
});

test("the /pages/(\\d{3}) route regex rejects non-digit and path-traversal-shaped segments", () => {
    assert.ok(PAGE_ROUTE.test("/pages/205"));
    assert.equal(PAGE_ROUTE.test("/pages/20"), false);
    assert.equal(PAGE_ROUTE.test("/pages/2050"), false);
    assert.equal(PAGE_ROUTE.test("/pages/abc"), false);
    assert.equal(PAGE_ROUTE.test("/pages/../etc"), false);
    assert.equal(PAGE_ROUTE.test("/pages/205/../../etc"), false);
});

const sender = (overrides) => ({ name: "hooks", range: { min: 200, max: 299 }, images: false, urgent: false, ...overrides });

test("validatePageRange enforces the reserved/invalid page bounds and the token's range", () => {
    assert.throws(() => validatePageRange(sender(), "100"), (e) => e.code === "reserved_page");
    assert.throws(() => validatePageRange(sender(), "050"), (e) => e.code === "invalid_page");
    assert.throws(() => validatePageRange(sender(), "150"), (e) => e.code === "forbidden_range");
    assert.equal(validatePageRange(sender(), "205"), 205);
});

test("validatePagePost rejects urgent/images without the matching token capability", () => {
    assert.throws(() => validatePagePost(sender(), "205", { title: "t", urgent: true }), (e) => e.code === "forbidden_urgent");
    assert.throws(
        () => validatePagePost(sender(), "205", { title: "t", image: { style: "dither", data: "AA==" } }),
        (e) => e.code === "forbidden_images",
    );
});

test("validatePagePost rejects a missing title and an invalid ttl", () => {
    assert.throws(() => validatePagePost(sender(), "205", { title: "" }), (e) => e.code === "invalid_body");
    assert.throws(() => validatePagePost(sender(), "205", { title: "t", ttl: "8d" }), (e) => e.code === "invalid_ttl");
});

test("validatePagePost rejects image and chart together, and chart on a non-text layout", () => {
    const s = sender({ images: true });
    assert.throws(
        () =>
            validatePagePost(s, "205", {
                title: "t",
                layout: "text",
                image: { style: "dither", data: "AA==" },
                chart: { type: "spark", values: [1] },
            }),
        (e) => e.code === "invalid_body",
    );
    assert.throws(
        () => validatePagePost(sender({ images: true }), "205", { title: "t", layout: "image", chart: { type: "spark", values: [1] } }),
        (e) => e.code === "invalid_body",
    );
});
