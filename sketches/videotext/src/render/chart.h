// Spark and bar charts, ported from the archived relay's chart.js.
#pragma once

#include <cstdint>
#include <string>

#include "render.h"
#include "theme.h"

namespace vt {

constexpr int MIN_CHART_ROWS = 3;
constexpr int CHART_BLANK_SEPARATOR_ROWS = 1;

struct ChartRows {
    int labelRows;
    int chartRows;
    int bodyRows;
};

// Splits a text region between a chart and the body under it. The chart gets
// every row the body doesn't need, at least MIN_CHART_ROWS, with a blank
// separator row before the body and, when there is body text, one free row
// under it so the last line doesn't sit on the footer. `naturalBodyRows` is
// what the body would need with the whole region to itself.
ChartRows splitChartRows(bool hasLabel, int naturalBodyRows, int regionRows);

// Every column is one solid block of the accent colour, its height in eighths
// of a cell. Spark packs columns edge to edge and scales min to max, keeping
// the minimum as a one-eighth stub; bars stay 0-based with a 3 px gap.
// Columns snap to whole cells once they are a cell wide, and a series wider
// than the rect is averaged down to fit. Spark prints its max and min at the
// right edge of the top and bottom rows of the rect.
void drawChart(std::uint8_t* fb, int x, int y, int w, int h, const Chart& chart, const Theme& theme);

// Number.isInteger(v) ? String(v) : v.toFixed(1), digit for digit.
std::string formatChartValue(double v);

}  // namespace vt
