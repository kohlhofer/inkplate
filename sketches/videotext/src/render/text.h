// Codepoint strings and the few JavaScript string semantics the renderer
// depends on. The archived relay worked on JS strings iterated by codepoint;
// here every input is decoded from UTF-8 once, up front, so lengths, slices
// and grid cells all count codepoints the same way.
#pragma once

#include <string>

namespace vt {

using Codepoints = std::u32string;

// Invalid or truncated sequences become U+FFFD, one per maximal invalid
// subpart (the WHATWG decoder Node uses), so a bad byte costs one blank cell
// and never a crash.
Codepoints decodeUtf8(const std::string& bytes);
std::string encodeUtf8(const Codepoints& text);

// String.prototype.trim()'s whitespace set.
bool isJsWhitespace(char32_t c);
Codepoints trimmed(const Codepoints& text);
Codepoints trimmedEnd(const Codepoints& text);
bool isBlank(const Codepoints& text);

// cpSlice(text, 0, n): the first n codepoints, or all of them.
Codepoints firstCodepoints(const Codepoints& text, std::size_t n);

// Fits `text` into `budget` cells: unchanged when it fits, otherwise cut to
// budget-1 codepoints, trailing whitespace dropped, and an ellipsis added.
Codepoints cutWithEllipsis(const Codepoints& text, std::size_t budget);

}  // namespace vt
