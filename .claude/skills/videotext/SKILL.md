---
name: videotext
description: >
  How to put information on the teletext-style Inkplate wall display (videotext) that a
  relay on this Mac serves. Load before posting, updating or removing a page, and whenever
  someone asks to show, put, send or pin something on the wall, the display, the Inkplate
  or videotext: build or deploy status, weather, reminders, a chart, an image, a notice.
---

# Posting to the Videotext Wall

The wall is a 600x448 seven-colour e-paper panel on the Inkplate board. A relay on this Mac renders pages and the board pulls them. You post a page with the `vt` CLI in the inkplate repo, and the relay does all the layout. The full reference is the repo's README.md, and this skill is the part you need to post a good page.

## Before You Post

The CLI lives in the repo. On this Mac that is `~/Development/inkplate`, so run it as
`node ~/Development/inkplate/bin/vt.js <command>`. The examples below write `vt` for short,
which only works as-is if someone has run `npm link` in the repo. The CLI reads the relay URL
and a sender token from `~/.config/vt/config.json`.

1. `curl -s http://127.0.0.1:8080/healthz` should print `{"ok":true}`. If it doesn't, tell the person the relay isn't running (`make relay-install` in the repo starts it) instead of retrying.
2. `vt ls` shows every live page, its owner and its expiry. Reuse a page you or the person already own for the same topic, and never take over someone else's page unless asked.

## Picking the Page Number

The wall opens on the lowest-numbered live page, so the number decides what people see without pressing the button. Use the house convention unless the person says otherwise:

- 101-199: pinned by the owner, the default view. Only use these when asked.
- 200-299: agent jobs, builds, deploys.
- 300-399: home and weather.
- 400-499: calendar and reminders.
- 500-899: everything else.

100 is the generated index and can't be posted to.

## Writing the Page

```sh
vt send 301 "Cary, NC · Sunday" --ttl 1d \
  --chart "73 76 81 85 88 89 85 81 78" --chart-type spark --chart-label "°F, 7am to 11pm" \
  --body $'{yellow}Partly sunny{/}  high 90°  low 72°\nShowers possible before 7am (20%)'
```

A title holds 48 characters, and the index shows only the first 34, so lead with the subject.

The body is a 48-column grid with 14 rows on a `text` page. Write short lines with one fact each, separated by `\n`. Pipe a long body in with `--body stdin`.

Colour tags carry meaning: `{red}` needs a person, `{yellow}` means attention, `{green}` means fine and `{blue}` is information. Close a tag with `{/}`, and tag the status word rather than the whole sentence.

Lines between two ```` ``` ```` lines are never wrapped, only cropped. Use these fences for tables and for ASCII or block art (`┌─┐`, `▀▄█`, sextants). A tagged run of block characters is drawn in that colour.

The font covers ASCII, Latin-1, °, dashes, curly quotes, bullets and arrows. Emoji render as blank space, so leave them out.

Send numbers, not a picture of a chart: `--chart "1 2 3" --chart-type spark|bars --chart-label text` works on a `text` page. A spark chart scales from the lowest to the highest value, and bars start at zero.

Images use `--layout image-left|image-top|image --image file.png --style dither|blocks`, PNG or JPEG up to 4 MP. `image-left` leaves 24 columns for text, `image-top` leaves 6 rows, and `image` leaves a one-line caption.

Set `--ttl` to how long the information stays true (`90m`, `2h`, `1d`, at most `7d`). Without it a page lasts one day.

## Checking Your Work

`send` prints where the page landed and any warnings. Fix every warning (cut title, truncated lines, cropped fence lines, unknown tag) and send again. Then render it:

```sh
vt preview 301 --out /tmp/vt-301.png
```

Open the PNG and look at it before telling anyone the page is up. The preview is the exact frame the board will draw, apart from the panel's duller colours.

## Being a Good Neighbour

- Every redraw flashes the whole panel for about 30 seconds, and the board may be on battery. Update a page when its content changes, not on a timer, and batch several changes into one `send`.
- `--urgent` puts the page on the wall at the next poll and shows a newsflash band. Keep it for things that need a person now, like a failed deploy or a broken build someone is waiting on. The relay allows it at most once every 10 minutes.
- `vt rm <page>` removes a page as soon as it's no longer true, instead of letting it sit until it expires.
- A `409 page_taken` error means another sender owns that page. Pick another number, or ask the person before retrying with `--replace`.
- The sender token's name appears in the page header, so everything you post is attributed on the wall.

## When Something Fails

Errors print the relay's message, which says what to change. `forbidden_range` means the token can't write that page number, `forbidden_images` or `forbidden_urgent` means the token lacks that permission, and `no relay at ...` means the relay is down. `vt status` shows when the board last fetched and what it's showing. If the board hasn't been seen for a long time, the Mac may have been asleep. Tell the person rather than posting again.
