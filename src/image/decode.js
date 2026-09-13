import { PNG } from "pngjs";
import jpeg from "jpeg-js";

// The relay never fetches URLs and only ever decodes what a sender POSTs, but
// a sender-supplied image is still untrusted input: cap decoded resolution
// to guard against decompression bombs. PNG's IHDR is peeked directly out of
// the buffer (no allocation) before pngjs does the real decode, so an
// oversized PNG is rejected before any decompression work happens; jpeg-js
// enforces its own cap during decode via maxResolutionInMP.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_MEGAPIXELS = 4;
const MAX_JPEG_MEMORY_MB = 512;

function isPng(buf) {
    return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isJpeg(buf) {
    return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

function peekPngDimensions(buf) {
    if (buf.length < 24) throw new Error("truncated PNG");
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function assertWithinCaps(width, height) {
    const megapixels = (width * height) / 1_000_000;
    if (megapixels > MAX_MEGAPIXELS) {
        throw new Error(`image exceeds ${MAX_MEGAPIXELS} megapixels`);
    }
}

export function decodeImage(buffer) {
    if (isPng(buffer)) {
        const peeked = peekPngDimensions(buffer);
        assertWithinCaps(peeked.width, peeked.height);
        const png = PNG.sync.read(buffer);
        return { width: png.width, height: png.height, rgba: png.data };
    }
    if (isJpeg(buffer)) {
        const raw = jpeg.decode(buffer, {
            maxResolutionInMP: MAX_MEGAPIXELS,
            maxMemoryUsageInMB: MAX_JPEG_MEMORY_MB,
            useTArray: true,
        });
        assertWithinCaps(raw.width, raw.height);
        return { width: raw.width, height: raw.height, rgba: raw.data };
    }
    throw new Error("unsupported image format (expected PNG or JPEG)");
}
