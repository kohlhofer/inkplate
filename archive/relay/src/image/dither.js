import { PALETTE, nearestIndex } from "../render/palette.js";

const clamp = (v) => Math.max(0, Math.min(255, v));

function addError(err, x, y, width, height, amount) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    err[y * width + x] += amount;
}

// Floyd-Steinberg at the image's own resolution (the "full res" style, as
// opposed to blocks.js's cell-quantized style). Error diffuses per channel
// so a photo's gradients still read as gradients on a 7-colour panel.
export function ditherFloydSteinberg(rgba, width, height) {
    const errR = new Float32Array(width * height);
    const errG = new Float32Array(width * height);
    const errB = new Float32Array(width * height);
    const out = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const srcOff = i * 4;
            const r = clamp(rgba[srcOff] + errR[i]);
            const g = clamp(rgba[srcOff + 1] + errG[i]);
            const b = clamp(rgba[srcOff + 2] + errB[i]);
            const index = nearestIndex(r, g, b);
            out[i] = index;

            const [pr, pg, pb] = PALETTE[index].rgb;
            const dr = r - pr;
            const dg = g - pg;
            const db = b - pb;
            for (const [ch, d] of [
                [errR, dr],
                [errG, dg],
                [errB, db],
            ]) {
                addError(ch, x + 1, y, width, height, (d * 7) / 16);
                addError(ch, x - 1, y + 1, width, height, (d * 3) / 16);
                addError(ch, x, y + 1, width, height, (d * 5) / 16);
                addError(ch, x + 1, y + 1, width, height, (d * 1) / 16);
            }
        }
    }
    return out;
}
