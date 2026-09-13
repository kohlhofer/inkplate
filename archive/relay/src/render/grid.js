// Panel geometry: 600x448 px, 50x18 character cells at 12x24. An 8px band of
// the theme's background colour runs top and bottom — no cell height both
// divides 448 exactly and divides by 3 (needed for sextants/eighth-blocks to
// tile without rounding), so this plan takes the border over a full-bleed
// mosaic seam (see the plan's font decision).

export const PANEL_WIDTH = 600;
export const PANEL_HEIGHT = 448;
export const CELL_WIDTH = 12;
export const CELL_HEIGHT = 24;
export const COLS = PANEL_WIDTH / CELL_WIDTH; // 50
export const ROWS = 18;
export const BORDER = 8;
export const GRID_TOP = BORDER;
export const GRID_HEIGHT = ROWS * CELL_HEIGHT; // 432; BORDER + GRID_HEIGHT + BORDER == PANEL_HEIGHT

export const FRAME_BYTES = (PANEL_WIDTH * PANEL_HEIGHT) / 2; // 134400, 2px/byte

export function createFramebuffer() {
    return new Uint8Array(PANEL_WIDTH * PANEL_HEIGHT);
}

export function setPixel(fb, x, y, index) {
    if (x < 0 || x >= PANEL_WIDTH || y < 0 || y >= PANEL_HEIGHT) return;
    fb[y * PANEL_WIDTH + x] = index & 0x0f;
}

export function fillRect(fb, x, y, w, h, index) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(PANEL_WIDTH, x + w);
    const y1 = Math.min(PANEL_HEIGHT, y + h);
    for (let yy = y0; yy < y1; yy++) {
        const rowBase = yy * PANEL_WIDTH;
        fb.fill(index & 0x0f, rowBase + x0, rowBase + x1);
    }
}

// Pixel origin of grid cell (row, col), accounting for the top border.
export function cellOrigin(row, col) {
    return { x: col * CELL_WIDTH, y: GRID_TOP + row * CELL_HEIGHT };
}

// Row-major, 4 bits/pixel, 2 px/byte: byte[y*300 + floor(x/2)], high nibble
// even x, low nibble odd x. This is the fixed board<->relay frame contract.
export function packTo4bpp(fb) {
    const bytesPerRow = PANEL_WIDTH / 2;
    const out = new Uint8Array(FRAME_BYTES);
    for (let y = 0; y < PANEL_HEIGHT; y++) {
        const rowBase = y * PANEL_WIDTH;
        const outRowBase = y * bytesPerRow;
        for (let x = 0; x < PANEL_WIDTH; x += 2) {
            const hi = fb[rowBase + x] & 0x0f;
            const lo = fb[rowBase + x + 1] & 0x0f;
            out[outRowBase + x / 2] = (hi << 4) | lo;
        }
    }
    return out;
}
