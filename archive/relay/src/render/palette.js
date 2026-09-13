// Perceived ACeP colours: Pimoroni inky's saturated palette for the same
// 600x448 UC8159 panel, blended with the pure palette at saturation 0.5 (see
// the brief). Used for preview PNGs and image quantization so previews
// resemble the wall. Index order matches the Inkplate palette (CLAUDE.md).
export const PALETTE = [
    { name: "black", index: 0, rgb: [57, 48, 57] },
    { name: "white", index: 1, rgb: [255, 255, 255] },
    { name: "green", index: 2, rgb: [58, 91, 70] },
    { name: "blue", index: 3, rgb: [61, 59, 94] },
    { name: "red", index: 4, rgb: [156, 72, 75] },
    { name: "yellow", index: 5, rgb: [208, 190, 71] },
    { name: "orange", index: 6, rgb: [177, 106, 73] },
];

export function nearestIndex(r, g, b) {
    let best = 0;
    let bestDist = Infinity;
    for (const { index, rgb } of PALETTE) {
        const dr = r - rgb[0];
        const dg = g - rgb[1];
        const db = b - rgb[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            best = index;
        }
    }
    return best;
}
