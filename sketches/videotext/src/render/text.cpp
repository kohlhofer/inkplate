#include "text.h"

namespace vt {

Codepoints decodeUtf8(const std::string& bytes) {
    constexpr char32_t REPLACEMENT = 0xFFFD;
    Codepoints out;
    out.reserve(bytes.size());

    char32_t cp = 0;
    int needed = 0;
    int seen = 0;
    unsigned char lower = 0x80;
    unsigned char upper = 0xBF;

    std::size_t i = 0;
    while (i < bytes.size()) {
        const unsigned char b = static_cast<unsigned char>(bytes[i]);
        if (needed == 0) {
            if (b <= 0x7F) {
                out.push_back(b);
            } else if (b >= 0xC2 && b <= 0xDF) {
                needed = 1;
                cp = b & 0x1F;
            } else if (b >= 0xE0 && b <= 0xEF) {
                if (b == 0xE0) lower = 0xA0;  // overlong
                if (b == 0xED) upper = 0x9F;  // surrogates
                needed = 2;
                cp = b & 0x0F;
            } else if (b >= 0xF0 && b <= 0xF4) {
                if (b == 0xF0) lower = 0x90;  // overlong
                if (b == 0xF4) upper = 0x8F;  // above U+10FFFF
                needed = 3;
                cp = b & 0x07;
            } else {
                out.push_back(REPLACEMENT);
            }
            i++;
            continue;
        }
        if (b < lower || b > upper) {
            // The sequence so far is one replacement; this byte starts afresh.
            cp = 0;
            needed = 0;
            seen = 0;
            lower = 0x80;
            upper = 0xBF;
            out.push_back(REPLACEMENT);
            continue;
        }
        lower = 0x80;
        upper = 0xBF;
        cp = (cp << 6) | (b & 0x3F);
        seen++;
        i++;
        if (seen == needed) {
            out.push_back(cp);
            cp = 0;
            needed = 0;
            seen = 0;
        }
    }
    if (needed != 0) out.push_back(REPLACEMENT);
    return out;
}

std::string encodeUtf8(const Codepoints& text) {
    std::string out;
    out.reserve(text.size());
    for (char32_t c : text) {
        if (c > 0x10FFFF || (c >= 0xD800 && c <= 0xDFFF)) c = 0xFFFD;
        if (c < 0x80) {
            out.push_back(static_cast<char>(c));
        } else if (c < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (c >> 6)));
            out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
        } else if (c < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (c >> 12)));
            out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (c >> 18)));
            out.push_back(static_cast<char>(0x80 | ((c >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((c >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (c & 0x3F)));
        }
    }
    return out;
}

bool isJsWhitespace(char32_t c) {
    switch (c) {
        case 0x0009:
        case 0x000A:
        case 0x000B:
        case 0x000C:
        case 0x000D:
        case 0x0020:
        case 0x00A0:
        case 0x1680:
        case 0x2028:
        case 0x2029:
        case 0x202F:
        case 0x205F:
        case 0x3000:
        case 0xFEFF:
            return true;
        default:
            return c >= 0x2000 && c <= 0x200A;
    }
}

Codepoints trimmed(const Codepoints& text) {
    std::size_t start = 0;
    std::size_t end = text.size();
    while (start < end && isJsWhitespace(text[start])) start++;
    while (end > start && isJsWhitespace(text[end - 1])) end--;
    return text.substr(start, end - start);
}

Codepoints trimmedEnd(const Codepoints& text) {
    std::size_t end = text.size();
    while (end > 0 && isJsWhitespace(text[end - 1])) end--;
    return text.substr(0, end);
}

bool isBlank(const Codepoints& text) {
    for (char32_t c : text) {
        if (!isJsWhitespace(c)) return false;
    }
    return true;
}

Codepoints firstCodepoints(const Codepoints& text, std::size_t n) {
    return text.size() <= n ? text : text.substr(0, n);
}

Codepoints cutWithEllipsis(const Codepoints& text, std::size_t budget) {
    if (text.size() <= budget) return text;
    if (budget == 0) return Codepoints();
    Codepoints out = trimmedEnd(text.substr(0, budget - 1));
    out.push_back(0x2026);
    return out;
}

}  // namespace vt
