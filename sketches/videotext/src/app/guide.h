// The words an agent or person reads to use the wall. One source for the MCP
// server instructions, the show_screen tool description and GET /, so the
// three can't drift apart.
#pragma once

namespace vt {

inline const char* const GUIDE_WALL = R"GUIDE(videotext is a wall display: a 600x448 e-paper panel in seven colours (black, white, green, blue, red, yellow, orange), drawn in the style of 1980s teletext. It shows exactly one screen at a time, and replacing it changes what everyone in the room sees.

LAYOUT (a fixed grid of 50 x 18 character cells; you never position anything)
- Top row: "VIDEOTEXT" and the time the screen was last updated. The board draws this.
- Title: double-height letters, at most 48 characters. Longer titles are cut.
- Body: 48 characters wide and 14 rows tall. Words wrap at spaces, "\n" starts a new line, and blank lines are kept. Runs of spaces collapse to one space, so use a fenced block (below) to line things up in columns. Anything past the 14th row is cut.
- Footer: optional, one line of at most 48 characters, for example a source.

BODY MARKUP
- Colour tags wrap text: {red}FAILED{/}. Meanings: red = needs a person now, yellow = attention, green = fine or done, blue = information. orange, white and black have no fixed meaning. Tagged text is drawn on a band of that colour, so tag the status word, not whole sentences.
- A line containing only ``` opens or closes a fenced block. Fenced lines are never wrapped, only cropped at 48 characters. Use fences for tables and pictures.
- Box drawing (┌─┐│└┘├┤┬┴┼ and the heavy ━┃┏┓┗┛ set), block elements (▀▄█▌▐░▒▓▁▂▃▅▆▇) and teletext sextants (U+1FB00 to U+1FB3B) each fill a whole cell and tile into pictures. A tagged run made only of these characters is drawn in that colour, for example {green}████{/}.
- The font covers ASCII, Latin-1 (é ü ß °), the dashes – —, curly quotes ‘ ’ “ ”, • … and arrows. Emoji and other scripts are not in the font and show as blank cells.
- Unknown tags such as {bold} are printed literally and reported as a warning.

CHARTS
Pass numbers in `chart`; there is no image support.
- "spark": one column per value, scaled from the lowest to the highest value, with both values printed at the right. Good for a trend.
- "bars": starts at zero. Good for comparing amounts.
- Up to 600 values; a series wider than the screen is averaged to fit. `label` is a one-line caption above the chart.
- The chart takes the body rows the text doesn't need, so keep the body to a few lines when you add one.

THEMES
"dark" is the default: black background, yellow titles. "light" is a white background with titles on blue bands.

REFRESH
The panel has no partial update. Each new screen triggers a full refresh that flashes the whole panel for about 30 seconds before the new screen is readable. If more screens arrive during a refresh, only the newest is drawn when it finishes. A screen stays until someone replaces it, and it survives power loss.

WORKING WITH THE WALL
1. Look at what is showing first (get_screen) and don't replace someone else's screen unless you were asked to.
2. Send the screen and look at the preview image that comes back. Use preview_screen first when you're unsure how the layout will come out. Fix every warning.
3. Only send when the content has changed. Several changes belong in one screen, not several calls.
4. Keep it glanceable: a title that says what this is, then the facts that matter most, one per line.

EXAMPLE
title: "Cary, NC · Sunday"
body: "{yellow}Partly sunny{/}  high 90°  low 72°\nShowers possible before 7am (20%)\nHumid morning, SW wind 6 mph"
chart: {"type": "spark", "values": [73, 76, 81, 85, 88, 89, 85, 81, 78], "label": "°F, 7am to 11pm"}
footer: "Source: National Weather Service")GUIDE";

inline const char* const GUIDE_HTTP = R"GUIDE(HTTP API
Send the key with every request except GET /: either "X-Api-Key: <key>" or "Authorization: Bearer <key>". The key is in the board's config.h and on the screen that the button on the board's side brings up. Send JSON bodies with "Content-Type: application/json".

GET    /           this guide (no key needed)
GET    /screen     the current screen as JSON, with its state and when it was updated
PUT    /screen     replace the screen; JSON body {"title", "body", "chart", "footer", "theme"}, only title is required
POST   /preview    render a screen without showing it; same JSON body; answers with a PNG and an X-Warnings header
GET    /preview    PNG of the current screen
DELETE /screen     remove the screen; the wall shows its connection details instead
GET    /status     network, battery, uptime and refresh state
POST   /mcp        Model Context Protocol endpoint (Streamable HTTP, JSON responses)

Errors come back as {"error": {"code": "...", "message": "..."}} with a message that says what to change.

CONNECTING AN AGENT
Claude Code (use the IP address; Claude Code can't resolve .local names):
  claude mcp add --transport http videotext http://<ip>/mcp --header "X-Api-Key: <key>"
Any other MCP client: a Streamable HTTP server at http://<ip>/mcp or http://videotext.local/mcp with the same header. The board shows its current IP on the screen the side button brings up.)GUIDE";

}  // namespace vt
