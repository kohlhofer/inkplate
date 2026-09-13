// Teletext-style renderer for the single videotext screen. Pure C++17 over a
// palette-index framebuffer: no Arduino headers, so the same code builds on the
// board and on the Mac for `make test-native`.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace vt {

constexpr int PANEL_WIDTH = 600;
constexpr int PANEL_HEIGHT = 448;
constexpr int FRAME_PIXELS = PANEL_WIDTH * PANEL_HEIGHT;
constexpr int CELL_WIDTH = 12;
constexpr int CELL_HEIGHT = 24;
constexpr int TEXT_COLS = 48;
constexpr int BODY_ROWS = 14;
constexpr std::size_t MAX_TITLE_CHARS = 48;
constexpr std::size_t MAX_BODY_BYTES = 8192;
constexpr std::size_t MAX_CHART_VALUES = 600;

// Inkplate 6COLOR palette indices.
enum Color : std::uint8_t { BLACK = 0, WHITE = 1, GREEN = 2, BLUE = 3, RED = 4, YELLOW = 5, ORANGE = 6 };

struct Chart {
    bool present = false;
    bool bars = false;  // false: spark
    std::vector<double> values;
    std::string label;  // UTF-8, may be empty
};

struct Screen {
    std::string title;        // UTF-8, required by the API, cut to MAX_TITLE_CHARS codepoints
    std::string body;         // UTF-8 markup: {red}...{/} tags, ``` fences
    Chart chart;
    bool lightTheme = false;
    std::string headerLeft;   // drawn in the accent style, e.g. "VIDEOTEXT"
    std::string headerRight;  // right-aligned, e.g. "updated Sun 13 Sep 14:05"; empty draws nothing
    std::string footer;       // plain text on the last row; empty draws nothing
};

// Renders `screen` into `pixels` (FRAME_PIXELS palette indices, row-major) and
// returns the warnings a sender should see, worded like the archived relay's lint:
// "title cut", "N lines truncated", "N fenced line(s) cropped", "unknown tag {x}".
std::vector<std::string> renderScreen(std::uint8_t* pixels, const Screen& screen);

// The same warnings without drawing anything.
std::vector<std::string> lintScreen(const Screen& screen);

}  // namespace vt
