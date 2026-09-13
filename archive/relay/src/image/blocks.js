import { PALETTE, nearestIndex } from "../render/palette.js";
import { CELL_WIDTH, CELL_HEIGHT } from "../render/grid.js";

// "blocks" style: sextant-shaped, 2x3 sub-cells per 12x24 character cell
// (see procedural.js's sextant grid), each cell quantized to at most two
// palette colours — a deliberately blocky look, as opposed to dither.js's
// full-resolution Floyd-Steinberg. Flattened to the same per-pixel index
// format as dither.js so frame.js has one image-blit path.
const SUB_COLS = 2;
const SUB_ROWS = 3;
const SUB_WIDTH = CELL_WIDTH / SUB_COLS; // 6
const SUB_HEIGHT = CELL_HEIGHT / SUB_ROWS; // 8

function averageRgb(rgba, width, x0, y0, x1, y1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const off = (y * width + x) * 4;
            r += rgba[off];
            g += rgba[off + 1];
            b += rgba[off + 2];
            n++;
        }
    }
    return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n];
}

function distance2(rgb, index) {
    const [pr, pg, pb] = PALETTE[index].rgb;
    const dr = rgb[0] - pr;
    const dg = rgb[1] - pg;
    const db = rgb[2] - pb;
    return dr * dr + dg * dg + db * db;
}

function paletteDistance(a, b) {
    const [ar, ag, ab] = PALETTE[a].rgb;
    const [br, bg, bb] = PALETTE[b].rgb;
    return (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
}

// Reduces up to 6 candidate indices to the 2 that are farthest apart in
// palette space, so a cell settles on one dominant pair rather than
// wandering across all 6 sub-cells' nearest colours independently.
function pickDualColors(candidates) {
    const unique = [...new Set(candidates)];
    if (unique.length <= 2) return [unique[0], unique[unique.length - 1]];
    let best = [unique[0], unique[1]];
    let bestDist = -1;
    for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
            const d = paletteDistance(unique[i], unique[j]);
            if (d > bestDist) {
                bestDist = d;
                best = [unique[i], unique[j]];
            }
        }
    }
    return best;
}

export function quantizeBlocks(rgba, width, height) {
    const out = new Uint8Array(width * height);

    for (let cy = 0; cy < height; cy += CELL_HEIGHT) {
        for (let cx = 0; cx < width; cx += CELL_WIDTH) {
            const subs = [];
            for (let row = 0; row < SUB_ROWS; row++) {
                for (let col = 0; col < SUB_COLS; col++) {
                    const x0 = cx + col * SUB_WIDTH;
                    const y0 = cy + row * SUB_HEIGHT;
                    if (x0 >= width || y0 >= height) {
                        subs.push(null);
                        continue;
                    }
                    const x1 = Math.min(x0 + SUB_WIDTH, width);
                    const y1 = Math.min(y0 + SUB_HEIGHT, height);
                    subs.push({ x0, y0, x1, y1, avg: averageRgb(rgba, width, x0, y0, x1, y1) });
                }
            }

            const candidates = subs.filter(Boolean).map((s) => nearestIndex(...s.avg));
            if (candidates.length === 0) continue;
            const [a, b] = pickDualColors(candidates);

            for (const sub of subs) {
                if (!sub) continue;
                const chosen = distance2(sub.avg, a) <= distance2(sub.avg, b) ? a : b;
                for (let y = sub.y0; y < sub.y1; y++) {
                    for (let x = sub.x0; x < sub.x1; x++) {
                        out[y * width + x] = chosen;
                    }
                }
            }
        }
    }
    return out;
}
