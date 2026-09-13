// Colour themes, ported from the archived relay's theme.js. Every fg/bg pair
// was picked there for contrast on the ACeP panel (black or white, whichever
// reads better on the band colour).
#pragma once

#include <cstdint>

#include "render.h"

namespace vt {

// A markup tag's id is the palette index its name refers to, so {red} is 4.
using Tag = std::int8_t;
constexpr Tag NO_TAG = -1;
constexpr int TAG_COUNT = 7;

struct ColorPair {
    std::uint8_t fg;
    std::uint8_t bg;
};

struct Theme {
    std::uint8_t background;
    std::uint8_t foreground;
    std::uint8_t accent;  // titles, header, chart columns
    // A theme whose accent is too close to its text colour to read as an
    // accent draws accent text as fg on a band of bg instead.
    bool hasAccentBand;
    ColorPair accentBand;
    ColorPair tags[TAG_COUNT];  // indexed by Tag
};

inline constexpr Theme DARK_THEME = {
    BLACK,
    WHITE,
    YELLOW,
    false,
    {WHITE, BLACK},
    {
        {WHITE, BLACK},   // black
        {BLACK, WHITE},   // white
        {WHITE, GREEN},   // green: white reads far better than black on it
        {WHITE, BLUE},    // blue text on black is illegible, so it is banded
        {WHITE, RED},     // red
        {BLACK, YELLOW},  // yellow
        {WHITE, ORANGE},  // orange
    },
};

inline constexpr Theme LIGHT_THEME = {
    WHITE,
    BLACK,
    BLUE,
    true,  // blue text is about as dark as black on the panel
    {WHITE, BLUE},
    {
        {WHITE, BLACK},   // black
        {BLACK, WHITE},   // white
        {WHITE, GREEN},   // green
        {WHITE, BLUE},    // blue
        {WHITE, RED},     // red
        {BLACK, YELLOW},  // yellow text on white is illegible, so it is banded
        {WHITE, ORANGE},  // orange
    },
};

}  // namespace vt
