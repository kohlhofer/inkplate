# Agent Guide

This repo drives a teletext-style wall display on a Soldered Inkplate 6COLOR. A Node relay on the Mac renders pages, and the board pulls them over WiFi.

To put something on the wall, follow [.claude/skills/videotext/SKILL.md](.claude/skills/videotext/SKILL.md). It covers page numbers, markup, layouts, charts, images, urgent pages and how to check the rendered result. [README.md](README.md) has the complete reference and the HTTP API.

To change the relay, renderer, CLI or firmware, read [CLAUDE.md](CLAUDE.md) first. It has the hardware gotchas, the toolchain and the checks to run after flashing. `npm test` must pass, and the board's secrets live in the gitignored `sketches/videotext/config.h`, which you must never commit.
