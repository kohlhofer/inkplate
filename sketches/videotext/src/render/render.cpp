// The single videotext screen. Title and body follow the archived relay's
// real-page `text` layout exactly (frame.js renderRealPage); the header and
// footer rows are this display's own. Everything here works on locals and
// const tables only, so two tasks may render at once.
//
// Grid: 50x18 cells of 12x24 px under an 8 px border top and bottom. Text is
// inset one cell from each side (columns 1-48) so glyphs never touch the
// bezel; bands may still reach into the margin.

#include <algorithm>

#include "chart.h"
#include "draw.h"
#include "markup.h"
#include "render.h"
#include "text.h"
#include "theme.h"

namespace vt {
namespace {

constexpr int BORDER = 8;
constexpr int HEADER_ROW = 0;
constexpr int TITLE_ROW_START = 1;
constexpr int BODY_ROW_START = 3;  // rows 3-16
constexpr int FOOTER_ROW = 17;
constexpr int TEXT_X = CELL_WIDTH;
constexpr int TEXT_WIDTH = TEXT_COLS * CELL_WIDTH;

// How far a band reaches into a neighbouring space. Less than half a cell, so
// two banded words one space apart keep a visible gap.
constexpr int BAND_PAD = 4;

constexpr std::size_t HEADER_GAP_CELLS = 2;

int rowY(int row) {
    return BORDER + row * CELL_HEIGHT;
}

int rightAlignX(const Codepoints& text) {
    return TEXT_X + (TEXT_COLS - static_cast<int>(text.size())) * CELL_WIDTH;
}

struct BodyLayout {
    bool hasChart = false;
    Codepoints chartLabel;
    int chartRows = 0;
    int textRowStart = BODY_ROW_START;
    std::vector<CellRow> rows;
    std::vector<std::string> warnings;
};

// A chart claims its rows before the body gets any, so the body is wrapped
// against what is left and truncation warnings reflect the rows it really gets.
BodyLayout layoutBody(const Screen& screen) {
    BodyLayout layout;
    const Codepoints body = decodeUtf8(screen.body);
    Markup markup = parseMarkup(body);

    int rowBudget = BODY_ROWS;
    if (screen.chart.present) {
        const bool hasLabel = !screen.chart.label.empty();
        const int naturalBodyRows =
            isBlank(body) ? 0 : static_cast<int>(wrap(markup.lines, TEXT_COLS, BODY_ROWS).rows.size());
        const ChartRows split = splitChartRows(hasLabel, naturalBodyRows, BODY_ROWS);
        layout.hasChart = true;
        if (hasLabel) layout.chartLabel = firstCodepoints(decodeUtf8(screen.chart.label), TEXT_COLS);
        layout.chartRows = split.chartRows;
        layout.textRowStart = BODY_ROW_START + split.labelRows + split.chartRows + CHART_BLANK_SEPARATOR_ROWS;
        rowBudget = split.bodyRows;
        // A chart with no text leaves no body rows, and wrapping the empty line
        // against that would report a truncation that loses nothing.
        if (isBlank(body)) {
            layout.warnings = std::move(markup.warnings);
            return layout;
        }
    }

    Wrapped wrapped = wrap(markup.lines, TEXT_COLS, rowBudget);
    layout.rows = std::move(wrapped.rows);
    layout.warnings = std::move(markup.warnings);
    layout.warnings.insert(layout.warnings.end(), wrapped.warnings.begin(), wrapped.warnings.end());
    return layout;
}

std::vector<std::string> collectWarnings(const Codepoints& title, const BodyLayout& body) {
    std::vector<std::string> warnings;
    if (title.size() > MAX_TITLE_CHARS) warnings.push_back("title cut");
    warnings.insert(warnings.end(), body.warnings.begin(), body.warnings.end());
    return warnings;
}

struct Run {
    std::size_t start;
    std::size_t end;
    Tag tag;
    bool graphic;
};

// A tagged run of text gets a band in the tag's colour; a tagged run made
// only of block, box or sextant characters (spaces aside) is drawn in the
// tag's colour on the page background instead. All bands are painted before
// any glyph, so padding can never erase a neighbouring character, and padding
// only reaches into a bordering untagged space or past the row's ends.
void drawRow(std::uint8_t* fb, int x0, int y, const CellRow& row, const Theme& theme) {
    std::vector<Run> runs;
    for (std::size_t i = 0; i < row.size();) {
        std::size_t j = i;
        while (j < row.size() && row[j].tag == row[i].tag) j++;
        Run run{i, j, row[i].tag, false};
        if (run.tag != NO_TAG) {
            bool sawGraphic = false;
            bool onlyGraphic = true;
            for (std::size_t k = i; k < j && onlyGraphic; k++) {
                if (row[k].codepoint == U' ') continue;
                onlyGraphic = isProceduralCodepoint(row[k].codepoint);
                sawGraphic = true;
            }
            run.graphic = sawGraphic && onlyGraphic;
        }
        runs.push_back(run);
        i = j;
    }

    for (std::size_t i = 0; i < runs.size(); i++) {
        const Run& run = runs[i];
        if (run.tag == NO_TAG || run.graphic) continue;
        const bool spaceBefore = i == 0 || (runs[i - 1].tag == NO_TAG && row[runs[i - 1].end - 1].codepoint == U' ');
        const bool spaceAfter =
            i + 1 == runs.size() || (runs[i + 1].tag == NO_TAG && row[runs[i + 1].start].codepoint == U' ');
        const int padLeft = spaceBefore ? BAND_PAD : 0;
        const int padRight = spaceAfter ? BAND_PAD : 0;
        const int x = x0 + static_cast<int>(run.start) * CELL_WIDTH;
        const int width = static_cast<int>(run.end - run.start) * CELL_WIDTH;
        fillRect(fb, x - padLeft, y, width + padLeft + padRight, CELL_HEIGHT, theme.tags[run.tag].bg);
    }

    for (const Run& run : runs) {
        std::uint8_t color = theme.foreground;
        if (run.graphic) {
            color = static_cast<std::uint8_t>(run.tag);  // a tag's id is its palette index
        } else if (run.tag != NO_TAG) {
            color = theme.tags[run.tag].fg;
        }
        for (std::size_t k = run.start; k < run.end; k++) {
            const int x = x0 + static_cast<int>(k) * CELL_WIDTH;
            if (!drawProcedural(fb, x, y, row[k].codepoint, color)) {
                drawGlyph(fb, x, y, row[k].codepoint, color, false);
            }
        }
    }
}

// headerLeft in the accent style at the left, headerRight right-aligned to
// the end of the text area. When they would meet, headerRight stays whole and
// headerLeft is cut with an ellipsis, two blank cells short of it. Only a
// headerRight wider than the whole text area is itself cut.
void drawHeader(std::uint8_t* fb, const Theme& theme, const Screen& screen) {
    const Codepoints right = cutWithEllipsis(decodeUtf8(screen.headerRight), TEXT_COLS);
    std::size_t leftBudget = TEXT_COLS;
    if (!right.empty()) {
        leftBudget = right.size() + HEADER_GAP_CELLS >= TEXT_COLS ? 0 : TEXT_COLS - right.size() - HEADER_GAP_CELLS;
    }
    const Codepoints left = cutWithEllipsis(decodeUtf8(screen.headerLeft), leftBudget);

    const int y = rowY(HEADER_ROW);
    if (!left.empty()) drawAccentText(fb, TEXT_X, y, left, theme);
    if (!right.empty()) drawText(fb, rightAlignX(right), y, right, theme.foreground);
}

void drawFooter(std::uint8_t* fb, const Theme& theme, const Screen& screen) {
    const Codepoints footer = cutWithEllipsis(decodeUtf8(screen.footer), TEXT_COLS);
    drawText(fb, TEXT_X, rowY(FOOTER_ROW), footer, theme.foreground);
}

}  // namespace

std::vector<std::string> renderScreen(std::uint8_t* pixels, const Screen& screen) {
    if (pixels == nullptr) return lintScreen(screen);

    const Theme& theme = screen.lightTheme ? LIGHT_THEME : DARK_THEME;
    std::fill(pixels, pixels + FRAME_PIXELS, theme.background);

    drawHeader(pixels, theme, screen);

    const Codepoints title = decodeUtf8(screen.title);
    drawAccentText(pixels, TEXT_X, rowY(TITLE_ROW_START), firstCodepoints(title, MAX_TITLE_CHARS), theme, true);

    const BodyLayout body = layoutBody(screen);
    if (body.hasChart) {
        int chartY = rowY(BODY_ROW_START);
        if (!body.chartLabel.empty()) {
            drawText(pixels, TEXT_X, chartY, body.chartLabel, theme.foreground);
            chartY += CELL_HEIGHT;
        }
        drawChart(pixels, TEXT_X, chartY, TEXT_WIDTH, body.chartRows * CELL_HEIGHT, screen.chart, theme);
    }
    for (std::size_t i = 0; i < body.rows.size(); i++) {
        drawRow(pixels, TEXT_X, rowY(body.textRowStart + static_cast<int>(i)), body.rows[i], theme);
    }

    drawFooter(pixels, theme, screen);

    return collectWarnings(title, body);
}

std::vector<std::string> lintScreen(const Screen& screen) {
    return collectWarnings(decodeUtf8(screen.title), layoutBody(screen));
}

}  // namespace vt
