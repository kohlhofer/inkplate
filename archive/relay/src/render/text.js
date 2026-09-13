// Codepoint-aware length/slice. `for...of` and the spread operator iterate
// JS strings by Unicode codepoint, not UTF-16 code unit, so these are what
// keep an astral character (a sextant/mosaic glyph, U+1FB00+, encoded as a
// surrogate pair) counting and slicing as the one grid cell it actually
// occupies, instead of two (finding M3/m4).
export function cpLength(str) {
    return [...str].length;
}

export function cpSlice(str, start, end) {
    return [...str].slice(start, end).join("");
}

// "Sat 12 Sep 14:05" -> "Sat 14:05": day + time only, dropping the month/day
// number to fit a tight column budget (the P100 listing, M21; the real-page
// footer's expiry, M17). store.js's formatDisplay is always this fixed
// ASCII shape, so plain UTF-16 slicing is safe here.
export function shortDayTime(display) {
    return `${display.slice(0, 3)} ${display.slice(-5)}`;
}
