import { CELL_WIDTH, CELL_HEIGHT, fillRect, setPixel } from "./grid.js";

// Box drawing, block elements and sextants are drawn procedurally (not from
// font bitmaps) so they tile seamlessly across cells — the whole point of
// mosaic/ASCII-art content. Scope, per the plan: light and heavy single-
// weight lines/corners/tees/cross only; dashed, double, rounded and
// diagonal box-drawing variants are out of scope and fall through undrawn.

const LIGHT = 1;
const HEAVY = 2;
const THICKNESS = { [LIGHT]: 2, [HEAVY]: 4 };

// { up, down, left, right } edge weights (0 = no edge).
const BOX_CHARS = {
    0x2500: { left: LIGHT, right: LIGHT }, // ─
    0x2502: { up: LIGHT, down: LIGHT }, // │
    0x250c: { down: LIGHT, right: LIGHT }, // ┌
    0x2510: { down: LIGHT, left: LIGHT }, // ┐
    0x2514: { up: LIGHT, right: LIGHT }, // └
    0x2518: { up: LIGHT, left: LIGHT }, // ┘
    0x251c: { up: LIGHT, down: LIGHT, right: LIGHT }, // ├
    0x2524: { up: LIGHT, down: LIGHT, left: LIGHT }, // ┤
    0x252c: { down: LIGHT, left: LIGHT, right: LIGHT }, // ┬
    0x2534: { up: LIGHT, left: LIGHT, right: LIGHT }, // ┴
    0x253c: { up: LIGHT, down: LIGHT, left: LIGHT, right: LIGHT }, // ┼
    0x2501: { left: HEAVY, right: HEAVY }, // ━
    0x2503: { up: HEAVY, down: HEAVY }, // ┃
    0x250f: { down: HEAVY, right: HEAVY }, // ┏
    0x2513: { down: HEAVY, left: HEAVY }, // ┓
    0x2517: { up: HEAVY, right: HEAVY }, // ┗
    0x251b: { up: HEAVY, left: HEAVY }, // ┛
    0x2523: { up: HEAVY, down: HEAVY, right: HEAVY }, // ┣
    0x252b: { up: HEAVY, down: HEAVY, left: HEAVY }, // ┫
    0x2533: { down: HEAVY, left: HEAVY, right: HEAVY }, // ┳
    0x253b: { up: HEAVY, left: HEAVY, right: HEAVY }, // ┻
    0x254b: { up: HEAVY, down: HEAVY, left: HEAVY, right: HEAVY }, // ╋
};

function drawBox(fb, originX, originY, codepoint, fgIndex) {
    const spec = BOX_CHARS[codepoint];
    if (!spec) return false;
    const cx = originX + CELL_WIDTH / 2;
    const cy = originY + CELL_HEIGHT / 2;
    if (spec.up) {
        const w = THICKNESS[spec.up];
        fillRect(fb, cx - w / 2, originY, w, cy - originY + w / 2, fgIndex);
    }
    if (spec.down) {
        const w = THICKNESS[spec.down];
        fillRect(fb, cx - w / 2, cy - w / 2, w, originY + CELL_HEIGHT - (cy - w / 2), fgIndex);
    }
    if (spec.left) {
        const w = THICKNESS[spec.left];
        fillRect(fb, originX, cy - w / 2, cx - originX + w / 2, w, fgIndex);
    }
    if (spec.right) {
        const w = THICKNESS[spec.right];
        fillRect(fb, cx - w / 2, cy - w / 2, originX + CELL_WIDTH - (cx - w / 2), w, fgIndex);
    }
    return true;
}

const QUADRANT = {
    UL: { x: 0, y: 0 },
    UR: { x: CELL_WIDTH / 2, y: 0 },
    LL: { x: 0, y: CELL_HEIGHT / 2 },
    LR: { x: CELL_WIDTH / 2, y: CELL_HEIGHT / 2 },
};
const QUADRANT_W = CELL_WIDTH / 2;
const QUADRANT_H = CELL_HEIGHT / 2;

// Height eighths (24/8 = 3px, exact); width eighths (12/8 = 1.5px) are
// rounded since 12 doesn't divide 8 evenly — only the sextant grid (/2, /3)
// is guaranteed exact, per the plan's font/grid decision.
const eighthHeight = (n) => Math.round((CELL_HEIGHT * n) / 8);
const eighthWidth = (n) => Math.round((CELL_WIDTH * n) / 8);

function blockRects(codepoint) {
    switch (codepoint) {
        case 0x2580:
            return [{ x: 0, y: 0, w: CELL_WIDTH, h: CELL_HEIGHT / 2 }]; // upper half
        case 0x2584:
            return [{ x: 0, y: CELL_HEIGHT / 2, w: CELL_WIDTH, h: CELL_HEIGHT / 2 }]; // lower half
        case 0x2588:
            return [{ x: 0, y: 0, w: CELL_WIDTH, h: CELL_HEIGHT }]; // full block
        case 0x258c:
            return [{ x: 0, y: 0, w: CELL_WIDTH / 2, h: CELL_HEIGHT }]; // left half
        case 0x2590:
            return [{ x: CELL_WIDTH / 2, y: 0, w: CELL_WIDTH / 2, h: CELL_HEIGHT }]; // right half
        case 0x2581:
        case 0x2582:
        case 0x2583:
        case 0x2585:
        case 0x2586:
        case 0x2587: {
            const n = codepoint - 0x2580; // 1..7, one eighth to seven eighths
            const h = eighthHeight(n);
            return [{ x: 0, y: CELL_HEIGHT - h, w: CELL_WIDTH, h }];
        }
        case 0x2589:
        case 0x258a:
        case 0x258b:
        case 0x258d:
        case 0x258e:
        case 0x258f: {
            const n = 8 - (codepoint - 0x2588); // 2589->7 ... 258f->1
            const w = eighthWidth(n);
            return [{ x: 0, y: 0, w, h: CELL_HEIGHT }];
        }
        case 0x2594:
            return [{ x: 0, y: 0, w: CELL_WIDTH, h: eighthHeight(1) }]; // upper one eighth
        case 0x2595: {
            const w = eighthWidth(1);
            return [{ x: CELL_WIDTH - w, y: 0, w, h: CELL_HEIGHT }]; // right one eighth
        }
        case 0x2596:
            return [QUADRANT.LL];
        case 0x2597:
            return [QUADRANT.LR];
        case 0x2598:
            return [QUADRANT.UL];
        case 0x2599:
            return [QUADRANT.UL, QUADRANT.LL, QUADRANT.LR];
        case 0x259a:
            return [QUADRANT.UL, QUADRANT.LR];
        case 0x259b:
            return [QUADRANT.UL, QUADRANT.UR, QUADRANT.LL];
        case 0x259c:
            return [QUADRANT.UL, QUADRANT.UR, QUADRANT.LR];
        case 0x259d:
            return [QUADRANT.UR];
        case 0x259e:
            return [QUADRANT.UR, QUADRANT.LL];
        case 0x259f:
            return [QUADRANT.UR, QUADRANT.LL, QUADRANT.LR];
        default:
            return null;
    }
}

// Approximate stipple, not the real Unicode shade bitmap — deterministic and
// good enough for a teletext-style mosaic at this cell size.
function drawShade(fb, originX, originY, density, fgIndex) {
    for (let y = 0; y < CELL_HEIGHT; y++) {
        for (let x = 0; x < CELL_WIDTH; x++) {
            const on = density === 0.25 ? (x + y) % 4 === 0 : density === 0.5 ? (x + y) % 2 === 0 : (x + y) % 4 !== 0;
            if (on) setPixel(fb, originX + x, originY + y, fgIndex);
        }
    }
    return true;
}

function drawBlock(fb, originX, originY, codepoint, fgIndex) {
    if (codepoint === 0x2591) return drawShade(fb, originX, originY, 0.25, fgIndex);
    if (codepoint === 0x2592) return drawShade(fb, originX, originY, 0.5, fgIndex);
    if (codepoint === 0x2593) return drawShade(fb, originX, originY, 0.75, fgIndex);
    const rects = blockRects(codepoint);
    if (!rects) return false;
    for (const r of rects) {
        fillRect(fb, originX + r.x, originY + r.y, r.w ?? QUADRANT_W, r.h ?? QUADRANT_H, fgIndex);
    }
    return true;
}

// Sextant construction verified against the Unicode 17.0 code chart: masks
// 1-62 excluding 21 (left column, == U+258C) and 42 (right column, ==
// U+2590), ascending, mapped sequentially from U+1FB00 — lands exactly on
// U+1FB3B (60 codepoints).
export const SEXTANT_BASE = 0x1fb00;
export const SEXTANT_MASKS = buildSextantMasks();

function buildSextantMasks() {
    const masks = {};
    let codepoint = SEXTANT_BASE;
    for (let mask = 1; mask <= 62; mask++) {
        if (mask === 21 || mask === 42) continue;
        masks[codepoint] = mask;
        codepoint++;
    }
    return masks;
}

// bit -> sub-cell (2 cols x 3 rows), verified against masks 21 (bits 0,2,4 =
// left column = U+258C) and 42 (bits 1,3,5 = right column = U+2590).
const SEXTANT_CELLS = [
    { bit: 0, col: 0, row: 0 },
    { bit: 1, col: 1, row: 0 },
    { bit: 2, col: 0, row: 1 },
    { bit: 3, col: 1, row: 1 },
    { bit: 4, col: 0, row: 2 },
    { bit: 5, col: 1, row: 2 },
];

function drawSextant(fb, originX, originY, codepoint, fgIndex) {
    const mask = SEXTANT_MASKS[codepoint];
    if (mask === undefined) return false;
    const w = CELL_WIDTH / 2;
    const h = CELL_HEIGHT / 3;
    for (const cell of SEXTANT_CELLS) {
        if (mask & (1 << cell.bit)) {
            fillRect(fb, originX + cell.col * w, originY + cell.row * h, w, h, fgIndex);
        }
    }
    return true;
}

// Dispatches by codepoint range. Returns false (nothing drawn) for anything
// out of scope, so the caller can fall back to glyphs.js/blank.
export function drawProcedural(fb, originX, originY, codepoint, fgIndex) {
    if (codepoint >= 0x1fb00 && codepoint <= 0x1fb3b) return drawSextant(fb, originX, originY, codepoint, fgIndex);
    if (codepoint >= 0x2580 && codepoint <= 0x259f) return drawBlock(fb, originX, originY, codepoint, fgIndex);
    if (codepoint >= 0x2500 && codepoint <= 0x257f) return drawBox(fb, originX, originY, codepoint, fgIndex);
    return false;
}
