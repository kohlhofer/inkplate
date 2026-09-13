# Agent Guide

This repo is the firmware for a teletext-style wall display on a Soldered Inkplate 6COLOR. The board serves one screen over HTTP and MCP on the local network.

To put something on the wall, connect to the board's MCP server and follow its instructions, or read `GET /` on the board. [README.md](README.md) explains how to connect and lists the HTTP API.

To change the firmware, read [CLAUDE.md](CLAUDE.md) first. It has the hardware gotchas, the build and flash workflow, and the checks to run on the board. `make test-native` must pass. The board's secrets live in the gitignored `sketches/videotext/config.h`, which must never be committed.
