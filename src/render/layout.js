import { CELL_WIDTH, CELL_HEIGHT, GRID_TOP, COLS } from "./grid.js";

// Grid row map (see the plan's 2.5): header, a double-height title/banner
// slot, the body, and a footer, framed by grid.js's top/bottom border.
export const HEADER_ROW = 0;
export const TITLE_ROW_START = 1;
export const TITLE_ROWS = 2;
export const BODY_ROW_START = 3;
export const BODY_ROWS = 14; // rows 3-16
export const FOOTER_ROW = 17;

export function rowY(row) {
    return GRID_TOP + row * CELL_HEIGHT;
}

export function colX(col) {
    return col * CELL_WIDTH;
}

function rect(rowStart, rowSpan, colStart, colSpan) {
    return {
        rowStart,
        rowSpan,
        colStart,
        colSpan,
        x: colX(colStart),
        y: rowY(rowStart),
        w: colSpan * CELL_WIDTH,
        h: rowSpan * CELL_HEIGHT,
    };
}

// Per-layout body regions (pixel coords; body region = rows 3-16, y 80-415).
export function regionsFor(layout) {
    switch (layout) {
        case "image-left":
            return {
                image: rect(BODY_ROW_START, BODY_ROWS, 0, 24),
                text: rect(BODY_ROW_START, BODY_ROWS, 25, 25),
                caption: null,
            };
        case "image-top":
            return {
                image: rect(BODY_ROW_START, 7, 0, COLS),
                text: rect(BODY_ROW_START + 8, 6, 0, COLS),
                caption: null,
            };
        case "image":
            return {
                image: rect(BODY_ROW_START, 13, 0, COLS),
                text: null,
                caption: rect(BODY_ROW_START + 13, 1, 0, COLS),
            };
        case "text":
        default:
            return {
                image: null,
                text: rect(BODY_ROW_START, BODY_ROWS, 0, COLS),
                caption: null,
            };
    }
}
