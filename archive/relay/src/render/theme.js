// PROVISIONAL: not yet checked on the physical panel; retune this table
// after wall testing (see the brief and the plan's finding 28). Every fg/bg
// pair below was re-checked against the perceived palette's WCAG contrast
// ratio (relative luminance, palette.js's RGB) and set to whichever of
// black/white scores higher — round-2 fix for finding B6, which caught dark
// {green} (was black-on-green, 1.7:1) and dark {orange} (was black-on-
// orange, 3.0:1) specifically; every other pair already had its better
// option picked.
//
// Each tag maps to a {fg, bg} pair of palette indices (see palette.js).
// `background`/`foreground` are the theme's untagged defaults.
export const THEMES = {
    dark: {
        background: 0, // black
        foreground: 1, // white
        accent: 5, // yellow — page numbers, titles, chart highlights (M20)
        tags: {
            red: { fg: 1, bg: 4 },
            green: { fg: 1, bg: 2 }, // white-on-green: 7.6:1 vs black-on-green's 1.7:1 (B6)
            blue: { fg: 1, bg: 3 }, // blue-on-black is illegible; band it instead
            yellow: { fg: 0, bg: 5 },
            orange: { fg: 1, bg: 6 }, // white-on-orange: 4.2:1 vs black-on-orange's 3.0:1 (B6)
            white: { fg: 0, bg: 1 },
            black: { fg: 1, bg: 0 },
        },
    },
    light: {
        background: 1, // white
        foreground: 0, // black
        accent: 3, // blue: chart columns, and the band colour below
        // Blue text is about as dark as black text on the panel, so page
        // numbers and titles become white on a blue band instead.
        accentBand: { fg: 1, bg: 3 },
        tags: {
            red: { fg: 1, bg: 4 },
            green: { fg: 1, bg: 2 },
            blue: { fg: 1, bg: 3 },
            yellow: { fg: 0, bg: 5 }, // yellow-on-white is illegible; band it instead
            orange: { fg: 1, bg: 6 },
            white: { fg: 0, bg: 1 },
            black: { fg: 1, bg: 0 },
        },
    },
};

export function themeFor(name) {
    return THEMES[name] ?? THEMES.dark;
}
