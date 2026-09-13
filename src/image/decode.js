import { PNG } from "pngjs";
import jpeg from "jpeg-js";

// The relay never fetches URLs and only ever decodes what a sender POSTs, but
// a sender-supplied image is still untrusted input: cap decoded resolution
// to guard against decompression bombs. The PNG chunk table is walked
// directly out of the buffer (length/type only, no decompression) before
// pngjs does the real decode, so an oversized, interlaced, or IHDR-spoofing
// PNG is rejected before any decompression work happens; jpeg-js enforces
// its own resolution/memory caps during decode.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_MEGAPIXELS = 4;
const MAX_JPEG_MEMORY_MB = 64;

// Only ever thrown with one of the fixed messages below — server.js maps
// this to a 400 with the message as-is, so it must never carry raw fs paths
// or other decoder internals (finding m25).
export class ImageError extends Error {}

function isPng(buf) {
    return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isJpeg(buf) {
    return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

function assertWithinCaps(width, height) {
    const megapixels = (width * height) / 1_000_000;
    if (megapixels > MAX_MEGAPIXELS) {
        throw new ImageError(`image exceeds ${MAX_MEGAPIXELS} megapixels`);
    }
}

// Walks chunk headers (8-byte length+type, skipping each chunk's data+CRC by
// pointer arithmetic only — no allocation, no inflate) to find the IHDR
// dimensions/interlace flag without ever handing pngjs a crafted file: pngjs
// itself decodes the *last* IHDR it sees, so a second IHDR after a small
// declared one is finding B5(a)'s 4MP-cap bypass unless rejected here first.
function peekPngIHDR(buf) {
    if (buf.length < 8 + 8 + 8) throw new ImageError("truncated PNG");
    let offset = 8;
    let sawIhdr = false;
    let dims = null;
    while (offset + 8 <= buf.length) {
        const length = buf.readUInt32BE(offset);
        const type = buf.toString("ascii", offset + 4, offset + 8);
        if (offset === 8 && type !== "IHDR") throw new ImageError("PNG must start with an IHDR chunk");
        if (type === "IHDR") {
            if (sawIhdr) throw new ImageError("PNG has more than one IHDR chunk");
            sawIhdr = true;
            const dataStart = offset + 8;
            if (dataStart + 8 > buf.length) throw new ImageError("truncated PNG");
            const width = buf.readUInt32BE(dataStart);
            const height = buf.readUInt32BE(dataStart + 4);
            assertWithinCaps(width, height);
            if (dataStart + 13 <= buf.length && buf.readUInt8(dataStart + 12) !== 0) {
                throw new ImageError("interlaced PNG is not supported");
            }
            dims = { width, height };
        }
        if (type === "IEND") break;
        const next = offset + 8 + length + 4;
        if (next <= offset || next > buf.length) break; // nothing more we can safely skip to
        offset = next;
    }
    if (!dims) throw new ImageError("PNG is missing an IHDR chunk");
    return dims;
}

export function decodeImage(buffer) {
    if (isPng(buffer)) {
        const peeked = peekPngIHDR(buffer);
        let png;
        try {
            png = PNG.sync.read(buffer);
        } catch {
            throw new ImageError("could not decode PNG");
        }
        if (png.width !== peeked.width || png.height !== peeked.height) {
            throw new ImageError("PNG dimensions changed between header and decode");
        }
        return { width: png.width, height: png.height, rgba: png.data };
    }
    if (isJpeg(buffer)) {
        let raw;
        try {
            raw = jpeg.decode(buffer, {
                maxResolutionInMP: MAX_MEGAPIXELS,
                maxMemoryUsageInMB: MAX_JPEG_MEMORY_MB,
                useTArray: true,
            });
        } catch {
            throw new ImageError("could not decode JPEG");
        }
        assertWithinCaps(raw.width, raw.height);
        return { width: raw.width, height: raw.height, rgba: raw.data };
    }
    throw new ImageError("unsupported image format (expected PNG or JPEG)");
}
