// Box drawing, block elements and sextants are drawn as rectangles rather
// than font bitmaps so they tile seamlessly across cells, which is the whole
// point of mosaic and ASCII-art content. Light and heavy single-weight lines,
// corners, tees and crosses only; other box-drawing variants fall through.

#include "draw.h"

namespace vt {
namespace {

constexpr int HALF_W = CELL_WIDTH / 2;
constexpr int HALF_H = CELL_HEIGHT / 2;

// Edge weights: 0 none, 1 light (2 px), 2 heavy (4 px).
struct BoxSpec {
    char32_t codepoint;
    std::uint8_t up, down, left, right;
};

constexpr BoxSpec BOX_CHARS[] = {
    {0x2500, 0, 0, 1, 1},  // ─
    {0x2502, 1, 1, 0, 0},  // │
    {0x250C, 0, 1, 0, 1},  // ┌
    {0x2510, 0, 1, 1, 0},  // ┐
    {0x2514, 1, 0, 0, 1},  // └
    {0x2518, 1, 0, 1, 0},  // ┘
    {0x251C, 1, 1, 0, 1},  // ├
    {0x2524, 1, 1, 1, 0},  // ┤
    {0x252C, 0, 1, 1, 1},  // ┬
    {0x2534, 1, 0, 1, 1},  // ┴
    {0x253C, 1, 1, 1, 1},  // ┼
    {0x2501, 0, 0, 2, 2},  // ━
    {0x2503, 2, 2, 0, 0},  // ┃
    {0x250F, 0, 2, 0, 2},  // ┏
    {0x2513, 0, 2, 2, 0},  // ┓
    {0x2517, 2, 0, 0, 2},  // ┗
    {0x251B, 2, 0, 2, 0},  // ┛
    {0x2523, 2, 2, 0, 2},  // ┣
    {0x252B, 2, 2, 2, 0},  // ┫
    {0x2533, 0, 2, 2, 2},  // ┳
    {0x253B, 2, 0, 2, 2},  // ┻
    {0x254B, 2, 2, 2, 2},  // ╋
};

int thickness(std::uint8_t weight) {
    return weight == 2 ? 4 : 2;
}

bool drawBox(std::uint8_t* fb, int x, int y, char32_t codepoint, std::uint8_t color) {
    const BoxSpec* spec = nullptr;
    for (const BoxSpec& s : BOX_CHARS) {
        if (s.codepoint == codepoint) spec = &s;
    }
    if (spec == nullptr) return false;
    const int cx = x + HALF_W;
    const int cy = y + HALF_H;
    if (spec->up) {
        const int w = thickness(spec->up);
        fillRect(fb, cx - w / 2, y, w, cy - y + w / 2, color);
    }
    if (spec->down) {
        const int w = thickness(spec->down);
        fillRect(fb, cx - w / 2, cy - w / 2, w, y + CELL_HEIGHT - (cy - w / 2), color);
    }
    if (spec->left) {
        const int w = thickness(spec->left);
        fillRect(fb, x, cy - w / 2, cx - x + w / 2, w, color);
    }
    if (spec->right) {
        const int w = thickness(spec->right);
        fillRect(fb, cx - w / 2, cy - w / 2, x + CELL_WIDTH - (cx - w / 2), w, color);
    }
    return true;
}

// Height eighths are exact (3 px); width eighths (1.5 px) round half up,
// as Math.round did. Only the sextant grid (/2, /3) is guaranteed exact.
int eighthHeight(int n) {
    return CELL_HEIGHT * n / 8;
}

int eighthWidth(int n) {
    return (CELL_WIDTH * n + 4) / 8;
}

enum Quadrant : std::uint8_t { UL = 1, UR = 2, LL = 4, LR = 8 };

void fillQuadrants(std::uint8_t* fb, int x, int y, int quadrants, std::uint8_t color) {
    if (quadrants & UL) fillRect(fb, x, y, HALF_W, HALF_H, color);
    if (quadrants & UR) fillRect(fb, x + HALF_W, y, HALF_W, HALF_H, color);
    if (quadrants & LL) fillRect(fb, x, y + HALF_H, HALF_W, HALF_H, color);
    if (quadrants & LR) fillRect(fb, x + HALF_W, y + HALF_H, HALF_W, HALF_H, color);
}

// An approximate stipple, not the Unicode shade bitmaps. 25% and 75% use a
// 2x2 ordered (Bayer) tile so they read as an even dot grid instead of
// diagonal hatching; 50% is a plain checkerboard.
void drawShade(std::uint8_t* fb, int x, int y, int percent, std::uint8_t color) {
    constexpr int BAYER_2X2[2][2] = {{0, 2}, {3, 1}};
    for (int dy = 0; dy < CELL_HEIGHT; dy++) {
        for (int dx = 0; dx < CELL_WIDTH; dx++) {
            bool on;
            if (percent == 50) {
                on = (dx + dy) % 2 == 0;
            } else {
                const int threshold = percent == 25 ? 1 : 3;  // 1 of 4 vs 3 of 4 lit
                on = BAYER_2X2[dy % 2][dx % 2] < threshold;
            }
            if (on) setPixel(fb, x + dx, y + dy, color);
        }
    }
}

bool drawBlock(std::uint8_t* fb, int x, int y, char32_t codepoint, std::uint8_t color) {
    switch (codepoint) {
        case 0x2580:  // upper half
            fillRect(fb, x, y, CELL_WIDTH, HALF_H, color);
            return true;
        case 0x2584:  // lower half
            fillRect(fb, x, y + HALF_H, CELL_WIDTH, HALF_H, color);
            return true;
        case 0x2588:  // full block
            fillRect(fb, x, y, CELL_WIDTH, CELL_HEIGHT, color);
            return true;
        case 0x258C:  // left half
            fillRect(fb, x, y, HALF_W, CELL_HEIGHT, color);
            return true;
        case 0x2590:  // right half
            fillRect(fb, x + HALF_W, y, HALF_W, CELL_HEIGHT, color);
            return true;
        case 0x2581:
        case 0x2582:
        case 0x2583:
        case 0x2585:
        case 0x2586:
        case 0x2587: {  // lower one to seven eighths
            const int h = eighthHeight(static_cast<int>(codepoint - 0x2580));
            fillRect(fb, x, y + CELL_HEIGHT - h, CELL_WIDTH, h, color);
            return true;
        }
        case 0x2589:
        case 0x258A:
        case 0x258B:
        case 0x258D:
        case 0x258E:
        case 0x258F: {  // left seven eighths down to one eighth
            const int w = eighthWidth(8 - static_cast<int>(codepoint - 0x2588));
            fillRect(fb, x, y, w, CELL_HEIGHT, color);
            return true;
        }
        case 0x2591:
            drawShade(fb, x, y, 25, color);
            return true;
        case 0x2592:
            drawShade(fb, x, y, 50, color);
            return true;
        case 0x2593:
            drawShade(fb, x, y, 75, color);
            return true;
        case 0x2594:  // upper one eighth
            fillRect(fb, x, y, CELL_WIDTH, eighthHeight(1), color);
            return true;
        case 0x2595: {  // right one eighth
            const int w = eighthWidth(1);
            fillRect(fb, x + CELL_WIDTH - w, y, w, CELL_HEIGHT, color);
            return true;
        }
        case 0x2596:
            fillQuadrants(fb, x, y, LL, color);
            return true;
        case 0x2597:
            fillQuadrants(fb, x, y, LR, color);
            return true;
        case 0x2598:
            fillQuadrants(fb, x, y, UL, color);
            return true;
        case 0x2599:
            fillQuadrants(fb, x, y, UL | LL | LR, color);
            return true;
        case 0x259A:
            fillQuadrants(fb, x, y, UL | LR, color);
            return true;
        case 0x259B:
            fillQuadrants(fb, x, y, UL | UR | LL, color);
            return true;
        case 0x259C:
            fillQuadrants(fb, x, y, UL | UR | LR, color);
            return true;
        case 0x259D:
            fillQuadrants(fb, x, y, UR, color);
            return true;
        case 0x259E:
            fillQuadrants(fb, x, y, UR | LL, color);
            return true;
        case 0x259F:
            fillQuadrants(fb, x, y, UR | LL | LR, color);
            return true;
        default:
            return false;
    }
}

// U+1FB00..U+1FB3B are the 2x3 masks 1-62 in ascending order, skipping 21
// (left column, already U+258C) and 42 (right column, already U+2590). Bits
// 0-5 run left to right, top to bottom.
bool drawSextant(std::uint8_t* fb, int x, int y, char32_t codepoint, std::uint8_t color) {
    if (codepoint < 0x1FB00 || codepoint > 0x1FB3B) return false;
    int mask = static_cast<int>(codepoint - 0x1FB00) + 1;
    if (mask >= 21) mask++;
    if (mask >= 42) mask++;
    const int w = CELL_WIDTH / 2;
    const int h = CELL_HEIGHT / 3;
    for (int bit = 0; bit < 6; bit++) {
        if (mask & (1 << bit)) fillRect(fb, x + (bit % 2) * w, y + (bit / 2) * h, w, h, color);
    }
    return true;
}

}  // namespace

bool isProceduralCodepoint(char32_t codepoint) {
    return (codepoint >= 0x1FB00 && codepoint <= 0x1FB3B) || (codepoint >= 0x2580 && codepoint <= 0x259F) ||
           (codepoint >= 0x2500 && codepoint <= 0x257F);
}

bool drawProcedural(std::uint8_t* fb, int x, int y, char32_t codepoint, std::uint8_t color) {
    if (codepoint >= 0x1FB00 && codepoint <= 0x1FB3B) return drawSextant(fb, x, y, codepoint, color);
    if (codepoint >= 0x2580 && codepoint <= 0x259F) return drawBlock(fb, x, y, codepoint, color);
    if (codepoint >= 0x2500 && codepoint <= 0x257F) return drawBox(fb, x, y, codepoint, color);
    return false;
}

}  // namespace vt
