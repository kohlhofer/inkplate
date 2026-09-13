// Decodes the PNG app_test writes and checks every pixel against the pattern
// it drew, so the board's hand-written encoder is proven with a real decoder.
import fs from "node:fs";
import { PNG } from "pngjs";

const PALETTE = [
    [57, 48, 57],
    [255, 255, 255],
    [58, 91, 70],
    [61, 59, 94],
    [156, 72, 75],
    [208, 190, 71],
    [177, 106, 73],
];

const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
let bad = 0;
for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
        const want = PALETTE[(Math.floor(x / 7) + Math.floor(y / 5)) % 7];
        const i = (y * png.width + x) * 4;
        if (png.data[i] !== want[0] || png.data[i + 1] !== want[1] || png.data[i + 2] !== want[2]) bad++;
    }
}
if (png.width !== 600 || png.height !== 448 || bad) {
    console.log(`FAIL png decode: ${png.width}x${png.height}, ${bad} wrong pixels`);
    process.exit(1);
}
console.log("ok   PNG decodes with pngjs to the exact pattern");
