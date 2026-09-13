// Tags cost no columns: markup parsing already stripped them, so only
// visible codepoints count toward a row's width.

#include <string>

#include "markup.h"

namespace vt {
namespace {

// Keeps the first maxRows rows and counts the rest, so a long body never
// holds more than a screenful of rows in memory.
struct RowSink {
    int maxRows;
    std::vector<CellRow> rows;
    std::size_t count = 0;

    void push(CellRow&& row) {
        if (count < static_cast<std::size_t>(maxRows)) rows.push_back(std::move(row));
        count++;
    }
};

struct Word {
    std::size_t start;
    std::size_t length;
};

std::vector<Word> splitWords(const CellRow& cells) {
    std::vector<Word> words;
    std::size_t start = 0;
    for (std::size_t i = 0; i <= cells.size(); i++) {
        if (i == cells.size() || cells[i].codepoint == U' ') {
            if (i > start) words.push_back({start, i - start});
            start = i + 1;
        }
    }
    return words;
}

void packWords(const CellRow& cells, const std::vector<Word>& words, std::size_t columns, RowSink& sink) {
    std::size_t emitted = 0;
    CellRow currentRow;
    std::size_t currentWidth = 0;
    auto emit = [&](CellRow&& row) {
        sink.push(std::move(row));
        emitted++;
    };

    for (Word word : words) {
        // A word wider than the row is hard-broken onto rows of its own.
        while (word.length > columns) {
            if (!currentRow.empty()) {
                emit(std::move(currentRow));
                currentRow = CellRow();
                currentWidth = 0;
            }
            emit(CellRow(cells.begin() + word.start, cells.begin() + word.start + columns));
            word.start += columns;
            word.length -= columns;
        }
        if (word.length == 0) continue;

        const std::size_t neededWidth = currentWidth == 0 ? word.length : currentWidth + 1 + word.length;
        if (neededWidth > columns) {
            emit(std::move(currentRow));
            currentRow.assign(cells.begin() + word.start, cells.begin() + word.start + word.length);
            currentWidth = word.length;
        } else {
            // The space between words is untagged at a tag boundary, so a band
            // gets even padding on both sides, but keeps the tag when both
            // words share it, so "{yellow}Partly sunny{/}" is one band, not two.
            if (currentWidth > 0) {
                const Tag prevTag = currentRow.back().tag;
                currentRow.push_back({U' ', prevTag == cells[word.start].tag ? prevTag : NO_TAG});
            }
            currentRow.insert(currentRow.end(), cells.begin() + word.start, cells.begin() + word.start + word.length);
            currentWidth = neededWidth;
        }
    }
    if (!currentRow.empty() || emitted == 0) emit(std::move(currentRow));
}

}  // namespace

Wrapped wrap(const std::vector<MarkupLine>& lines, int columns, int maxRows) {
    if (columns < 1) columns = 1;
    if (maxRows < 0) maxRows = 0;
    const std::size_t cols = static_cast<std::size_t>(columns);

    RowSink sink{maxRows, {}, 0};
    std::size_t croppedFences = 0;

    for (const MarkupLine& line : lines) {
        if (line.fenced) {
            if (line.cells.size() > cols) {
                sink.push(CellRow(line.cells.begin(), line.cells.begin() + columns));
                croppedFences++;
            } else {
                sink.push(CellRow(line.cells));
            }
        } else {
            packWords(line.cells, splitWords(line.cells), cols, sink);
        }
    }

    Wrapped result;
    if (croppedFences > 0) result.warnings.push_back(std::to_string(croppedFences) + " fenced line(s) cropped");
    if (sink.count > static_cast<std::size_t>(maxRows)) {
        result.warnings.push_back(std::to_string(sink.count - maxRows) + " lines truncated");
    }
    result.rows = std::move(sink.rows);
    result.naturalRows = sink.count;
    return result;
}

}  // namespace vt
