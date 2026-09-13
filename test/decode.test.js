import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { decodeImage, ImageError } from "../src/image/decode.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(width, height) {
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i++) {
        png.data[i * 4] = 100;
        png.data[i * 4 + 1] = 150;
        png.data[i * 4 + 2] = 200;
        png.data[i * 4 + 3] = 255;
    }
    return PNG.sync.write(png);
}

// Just enough of a PNG for the IHDR peek: signature + chunk length + "IHDR"
// + width/height. decodeImage must reject this on declared size alone,
// never reaching pngjs's real decode (which would choke on the rest).
function fakePngHeader(width, height) {
    const buf = Buffer.alloc(24);
    PNG_SIGNATURE.copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write("IHDR", 12);
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
}

test("decodes a small PNG and returns its dimensions and RGBA data", () => {
    const { width, height, rgba } = decodeImage(makePng(4, 3));
    assert.equal(width, 4);
    assert.equal(height, 3);
    assert.equal(rgba.length, 4 * 3 * 4);
});

test("decodes a small JPEG", () => {
    const width = 4;
    const height = 4;
    const data = Buffer.alloc(width * height * 4, 128);
    const encoded = jpeg.encode({ data, width, height }, 90);
    const decoded = decodeImage(encoded.data);
    assert.equal(decoded.width, width);
    assert.equal(decoded.height, height);
});

test("a PNG whose IHDR declares more than 4 megapixels is rejected before pngjs decodes it", () => {
    assert.throws(() => decodeImage(fakePngHeader(3000, 3000)), /megapixels/);
});

test("a PNG with a zero width or height is rejected before pngjs allocates rows for it", () => {
    assert.throws(() => decodeImage(fakePngHeader(0, 100_000_000)), ImageError);
    assert.throws(() => decodeImage(fakePngHeader(100_000_000, 0)), ImageError);
});

test("unsupported formats are rejected", () => {
    assert.throws(() => decodeImage(Buffer.from("not an image")), /unsupported image format/);
});

// Full 13-byte IHDR (width/height/bitdepth/colortype/compression/filter/
// interlace) followed by a chunk header, so peekPngIHDR can walk past it.
function fakePngChunk(type, data) {
    const chunk = Buffer.alloc(8 + data.length + 4);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4);
    data.copy(chunk, 8);
    return chunk;
}

function fakeIhdrData(width, height, interlace) {
    const data = Buffer.alloc(13);
    data.writeUInt32BE(width, 0);
    data.writeUInt32BE(height, 4);
    data.writeUInt8(8, 8); // bit depth
    data.writeUInt8(2, 9); // color type: truecolor
    data.writeUInt8(0, 10); // compression
    data.writeUInt8(0, 11); // filter
    data.writeUInt8(interlace, 12);
    return data;
}

test("an interlaced PNG is rejected before pngjs decodes it", () => {
    const buf = Buffer.concat([PNG_SIGNATURE, fakePngChunk("IHDR", fakeIhdrData(4, 4, 1))]);
    assert.throws(() => decodeImage(buf), (e) => e instanceof ImageError && /interlac/.test(e.message));
});

test("a PNG with a second IHDR chunk is rejected (pngjs decodes the last IHDR it sees)", () => {
    const buf = Buffer.concat([
        PNG_SIGNATURE,
        fakePngChunk("IHDR", fakeIhdrData(4, 4, 0)),
        fakePngChunk("IHDR", fakeIhdrData(4, 4, 0)),
    ]);
    assert.throws(() => decodeImage(buf), (e) => e instanceof ImageError && /more than one IHDR/.test(e.message));
});

test("a non-interlaced, single-IHDR PNG still decodes normally", () => {
    const { width, height, rgba } = decodeImage(makePng(5, 5));
    assert.equal(width, 5);
    assert.equal(height, 5);
    assert.equal(rgba.length, 5 * 5 * 4);
});
