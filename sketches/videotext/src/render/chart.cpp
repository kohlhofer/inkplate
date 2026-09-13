#include "chart.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "draw.h"

namespace vt {
namespace {

constexpr int MIN_MAX_LABEL_ROWS = 1;  // spark's label rows at the top and bottom of the rect
constexpr int BAR_GAP = 3;

// Math.round: nearest integer, ties towards +infinity, NaN stays NaN.
double jsRound(double v) {
    double r = std::floor(v);
    if (v - r >= 0.5) r += 1.0;
    return r;
}

// Math.max: NaN if either side is NaN.
double jsMax(double a, double b) {
    if (std::isnan(a) || std::isnan(b)) return NAN;
    return a > b ? a : b;
}

double jsMin(double a, double b) {
    if (std::isnan(a) || std::isnan(b)) return NAN;
    return a < b ? a : b;
}

std::vector<double> bucket(const std::vector<double>& values, std::size_t maxColumns) {
    if (values.size() <= maxColumns) return values;
    std::vector<double> out;
    out.reserve(maxColumns);
    const std::size_t n = values.size();
    for (std::size_t i = 0; i < maxColumns; i++) {
        const std::size_t start = (i * n) / maxColumns;
        const std::size_t end = std::max(start + 1, ((i + 1) * n) / maxColumns);
        double sum = 0;
        for (std::size_t j = start; j < end; j++) sum += values[j];
        out.push_back(sum / static_cast<double>(end - start));
    }
    return out;
}

// String(v) for an integral double. Below 2^53 that is the exact integer;
// above, JS prints the shortest digits that round-trip, zero-padded below
// 1e21 and in exponent form from there.
std::string jsIntegerString(double v) {
    if (v == 0) return "0";
    if (std::fabs(v) < 9007199254740992.0) return std::to_string(static_cast<long long>(v));

    char buf[40];
    for (int precision = 0; precision <= 17; precision++) {
        std::snprintf(buf, sizeof buf, "%.*e", precision, v);
        if (std::strtod(buf, nullptr) == v) break;
    }
    std::string sign;
    std::string digits;
    const char* p = buf;
    if (*p == '-') {
        sign = "-";
        p++;
    }
    for (; *p != 'e' && *p != '\0'; p++) {
        if (*p != '.') digits.push_back(*p);
    }
    const int exponent = *p == 'e' ? std::atoi(p + 1) : 0;
    while (digits.size() > 1 && digits.back() == '0') digits.pop_back();

    const int k = static_cast<int>(digits.size());
    const int n = exponent + 1;  // the value is 0.digits * 10^n
    if (k <= n && n <= 21) return sign + digits + std::string(n - k, '0');
    std::string mantissa = digits.substr(0, 1);
    if (k > 1) mantissa += "." + digits.substr(1);
    return sign + mantissa + "e" + (n - 1 >= 0 ? "+" : "-") + std::to_string(std::abs(n - 1));
}

// v.toFixed(1) for a non-integral double (so |v| < 2^52): the tenth nearest
// the exact binary value, ties to the larger magnitude. printf would round
// ties to even (0.25 -> "0.2" where JS says "0.3"), so the digit is decided
// with integer arithmetic on the fraction's exact bits.
std::string jsToFixed1(double v) {
    const bool negative = v < 0;
    const double x = negative ? -v : v;
    double whole = std::floor(x);
    const double fraction = x - whole;  // exact

    int tenths = 0;
    int exponent = 0;
    const double mantissa = std::frexp(fraction, &exponent);  // fraction = mantissa * 2^exponent
    if (fraction > 0 && exponent >= -4) {  // anything below 2^-5 rounds to .0
        const std::uint64_t m = static_cast<std::uint64_t>(std::ldexp(mantissa, 53));
        const int shift = 53 - exponent;  // fraction = m / 2^shift, shift in 53..57
        const std::uint64_t twentieths = m * 20;
        // tenths = how many of the midpoints 0.05, 0.15, ... 0.95 the fraction reaches.
        for (int d = 0; d < 10; d++) {
            if (twentieths >= (static_cast<std::uint64_t>(2 * d + 1) << shift)) tenths = d + 1;
        }
    }
    if (tenths == 10) {
        whole += 1;
        tenths = 0;
    }
    std::string out = negative ? "-" : "";
    out += std::to_string(static_cast<long long>(whole));
    out += '.';
    out += static_cast<char>('0' + tenths);
    return out;
}

}  // namespace

ChartRows splitChartRows(bool hasLabel, int naturalBodyRows, int regionRows) {
    const int labelRows = hasLabel ? 1 : 0;
    const int available = regionRows - labelRows;
    const int trailingBlank = naturalBodyRows > 0 ? 1 : 0;
    const int chartRows =
        std::max(MIN_CHART_ROWS, available - CHART_BLANK_SEPARATOR_ROWS - naturalBodyRows - trailingBlank);
    const int bodyRows = std::max(0, available - CHART_BLANK_SEPARATOR_ROWS - chartRows);
    return {labelRows, chartRows, bodyRows};
}

std::string formatChartValue(double v) {
    if (std::isfinite(v) && std::trunc(v) == v) return jsIntegerString(v);
    if (!std::isfinite(v)) return std::isnan(v) ? "NaN" : (v > 0 ? "Infinity" : "-Infinity");
    return jsToFixed1(v);
}

void drawChart(std::uint8_t* fb, int x, int y, int w, int h, const Chart& chart, const Theme& theme) {
    // The relay's API rejected non-finite values; skip any that reach here.
    std::vector<double> finite;
    finite.reserve(chart.values.size());
    for (double v : chart.values) {
        if (std::isfinite(v)) finite.push_back(v);
    }
    if (finite.empty() || w <= 0) return;

    const bool spark = !chart.bars;
    const int gap = spark ? 0 : BAR_GAP;
    const std::vector<double> values =
        bucket(finite, static_cast<std::size_t>(spark ? w : (w + gap) / (1 + gap)));
    const int n = static_cast<int>(values.size());
    if (n == 0) return;

    const int labelRows = spark ? MIN_MAX_LABEL_ROWS : 0;
    const int barTop = y + labelRows * CELL_HEIGHT;
    const int barHeight = std::max(CELL_HEIGHT, h - labelRows * 2 * CELL_HEIGHT);
    const int rows = std::max(1, static_cast<int>(jsRound(static_cast<double>(barHeight) / CELL_HEIGHT)));

    int colWidth = std::max(1, (w - gap * (n - 1)) / n);
    if (colWidth >= CELL_WIDTH) colWidth -= colWidth % CELL_WIDTH;

    double dataMin = values[0];
    double dataMax = values[0];
    for (double v : values) {
        dataMin = jsMin(dataMin, v);
        dataMax = jsMax(dataMax, v);
    }
    const double min = spark ? dataMin : jsMin(0, dataMin);
    double range = dataMax - min;
    if (range == 0 || std::isnan(range)) range = 1;  // `|| 1`

    int columnX = x;
    for (double raw : values) {
        const double fraction = (jsMax(min, raw) - min) / range;  // 0..1, or NaN if the range overflowed
        double eighths = jsRound(fraction * rows * 8);
        if (spark) eighths = jsMax(1, eighths);
        if (eighths > 0) {
            const int columnHeight = CELL_HEIGHT * static_cast<int>(std::min(eighths, rows * 8.0)) / 8;
            fillRect(fb, columnX, barTop + barHeight - columnHeight, colWidth, columnHeight, theme.accent);
        }
        columnX += colWidth + gap;
    }

    if (spark) {
        const Codepoints maxLabel = decodeUtf8(formatChartValue(dataMax));
        const Codepoints minLabel = decodeUtf8(formatChartValue(dataMin));
        drawText(fb, x + w - static_cast<int>(maxLabel.size()) * CELL_WIDTH, y, maxLabel, theme.foreground);
        drawText(fb, x + w - static_cast<int>(minLabel.size()) * CELL_WIDTH, y + h - CELL_HEIGHT, minLabel,
                 theme.foreground);
    }
}

}  // namespace vt
