// PROVISIONAL: not yet checked on the physical panel; the two illegible-
// combination examples (blue-on-black, yellow-on-white) are the only inputs
// we have — retune this table after wall testing (see the brief and the
// plan's finding 28).
//
// Each tag maps to a {fg, bg} pair of palette indices (see palette.js).
// `background`/`foreground` are the theme's untagged defaults.
export const THEMES = {
    dark: {
        background: 0, // black
        foreground: 1, // white
        tags: {
            red: { fg: 1, bg: 4 },
            green: { fg: 0, bg: 2 },
            blue: { fg: 1, bg: 3 }, // blue-on-black is illegible; band it instead
            yellow: { fg: 0, bg: 5 },
            orange: { fg: 0, bg: 6 },
            white: { fg: 0, bg: 1 },
            black: { fg: 1, bg: 0 },
        },
    },
    light: {
        background: 1, // white
        foreground: 0, // black
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
