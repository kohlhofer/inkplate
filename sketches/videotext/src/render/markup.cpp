// Tags are names, not colours: parsing is theme-independent, so one lint
// pass covers both themes. A repeated unknown tag warns only once, so a
// repeated typo doesn't spam the sender.

#include "markup.h"

namespace vt {
namespace {

// Indexed by Tag: a tag's id is the palette index of the colour it names.
constexpr const char32_t* TAG_NAMES[TAG_COUNT] = {U"black", U"white", U"green", U"blue", U"red", U"yellow", U"orange"};

Tag tagNamed(const Codepoints& word) {
    for (int i = 0; i < TAG_COUNT; i++) {
        if (word == TAG_NAMES[i]) return static_cast<Tag>(i);
    }
    return NO_TAG;
}

}  // namespace

Markup parseMarkup(const Codepoints& body) {
    Markup markup;
    std::vector<Codepoints> seenUnknown;
    Tag currentTag = NO_TAG;
    bool fenced = false;

    std::size_t lineStart = 0;
    while (true) {
        std::size_t lineEnd = body.find(U'\n', lineStart);
        if (lineEnd == Codepoints::npos) lineEnd = body.size();
        const Codepoints rawLine = body.substr(lineStart, lineEnd - lineStart);

        if (trimmed(rawLine) == U"```") {
            fenced = !fenced;  // fence marker lines are not rendered
        } else {
            MarkupLine line{fenced, {}};
            std::size_t i = 0;
            while (i < rawLine.size()) {
                if (rawLine[i] == U'{') {
                    const std::size_t end = rawLine.find(U'}', i);
                    if (end != Codepoints::npos) {
                        const Codepoints word = rawLine.substr(i + 1, end - i - 1);
                        if (word == U"/") {
                            currentTag = NO_TAG;
                            i = end + 1;
                            continue;
                        }
                        const Tag tag = tagNamed(word);
                        if (tag != NO_TAG) {
                            currentTag = tag;
                            i = end + 1;
                            continue;
                        }
                        const Codepoints literal = rawLine.substr(i, end - i + 1);
                        for (char32_t c : literal) line.cells.push_back({c, currentTag});
                        bool seen = false;
                        for (const Codepoints& s : seenUnknown) {
                            if (s == literal) seen = true;
                        }
                        if (!seen) {
                            seenUnknown.push_back(literal);
                            markup.warnings.push_back("unknown tag " + encodeUtf8(literal));
                        }
                        i = end + 1;
                        continue;
                    }
                }
                line.cells.push_back({rawLine[i], currentTag});
                i++;
            }
            markup.lines.push_back(std::move(line));
        }

        if (lineEnd == body.size()) break;
        lineStart = lineEnd + 1;
    }
    return markup;
}

}  // namespace vt
