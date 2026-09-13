// Body markup parsing and word wrap, ported from the archived relay's
// markup.js and wrap.js.
#pragma once

#include <string>
#include <vector>

#include "text.h"
#include "theme.h"

namespace vt {

// One grid cell's worth of body text with the colour tag active over it.
struct Cell {
    char32_t codepoint;
    Tag tag;
};

using CellRow = std::vector<Cell>;

struct MarkupLine {
    bool fenced;
    CellRow cells;
};

struct Markup {
    std::vector<MarkupLine> lines;
    std::vector<std::string> warnings;  // "unknown tag {x}", once per distinct tag
};

// {red} {green} {blue} {yellow} {orange} {white} {black} set the active tag and
// {/} clears it. Unknown {word} tags stay in the text literally. Newlines are
// hard breaks; a line that trims to ``` toggles fenced (non-wrapping) mode and
// is not itself rendered. Tags still parse inside fences.
Markup parseMarkup(const Codepoints& body);

struct Wrapped {
    std::vector<CellRow> rows;          // at most maxRows
    std::size_t naturalRows = 0;        // rows before vertical truncation
    std::vector<std::string> warnings;  // "N fenced line(s) cropped", "N lines truncated"
};

// Greedy word wrap to `columns`, then truncation to `maxRows`. Fenced lines
// are cropped instead of wrapped.
Wrapped wrap(const std::vector<MarkupLine>& lines, int columns, int maxRows);

}  // namespace vt
