#!/bin/sh
# Puts the videotext wall in the tailnet as its own node, "videotext", serving
# https://videotext.<tailnet>.ts.net and forwarding to the board on the LAN. The
# ESP32 can't run Tailscale, so a machine that is always on at home runs this:
# a second tailscaled in userspace mode with its own state and socket, next to
# and independent of the Tailscale app. See README.md, "Reaching the Wall over
# Tailscale".
#
#   videotext-proxy.sh start    start the node in the background (prints a login URL the first time)
#   videotext-proxy.sh status   node state and what it serves
#   videotext-proxy.sh stop     stop the node
#   videotext-proxy.sh run      run in the foreground, for launchd
#
# Settings (environment):
#   VT_BOARD      the board's LAN URL                   default http://192.168.86.242
#   VT_TS_NAME    tailnet name for this node            default videotext
#   VT_TS_STATE   state directory                       default ~/Library/Application Support/videotext-tailnet
#   VT_TS_BIN     directory with tailscale, tailscaled  default Homebrew's tailscale formula
#   VT_EPHEMERAL  1 keeps state in memory, so the node is ephemeral and leaves the tailnet after it stops

set -eu

BOARD="${VT_BOARD:-http://192.168.86.242}"
NAME="${VT_TS_NAME:-videotext}"
STATE_DIR="${VT_TS_STATE:-$HOME/Library/Application Support/videotext-tailnet}"
BIN="${VT_TS_BIN:-$(brew --prefix tailscale 2>/dev/null)/bin}"
SOCK="$STATE_DIR/tailscaled.sock"
PIDFILE="$STATE_DIR/tailscaled.pid"
LOG="$STATE_DIR/tailscaled.log"
STATE="$STATE_DIR/tailscaled.state"
[ "${VT_EPHEMERAL:-0}" = 1 ] && STATE="mem:"

ts() { "$BIN/tailscale" --socket="$SOCK" "$@"; }

json_field() {
    ts status --json 2>/dev/null | sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | head -1
}

require_bin() {
    # macOS caps Unix socket paths at 104 bytes, and tailscaled only says "invalid argument".
    if [ "${#SOCK}" -gt 100 ]; then
        echo "socket path is too long for macOS (${#SOCK} characters): $SOCK; set a shorter VT_TS_STATE" >&2
        exit 1
    fi
    if [ ! -x "$BIN/tailscaled" ]; then
        echo "tailscaled not found in $BIN; run: brew install tailscale && brew unlink tailscale" >&2
        echo "(unlinking keeps the Tailscale app's own CLI first on PATH)" >&2
        exit 1
    fi
}

running() {
    [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

# Userspace networking needs no root and no network extension, and leaves the
# app's own tailnet connection alone. --port=0 picks a free WireGuard port.
start_tailscaled() {
    mkdir -p "$STATE_DIR"
    chmod 700 "$STATE_DIR"
    "$BIN/tailscaled" --tun=userspace-networking --socket="$SOCK" --port=0 \
        --state="$STATE" --statedir="$STATE_DIR" >"$LOG" 2>&1 &
    echo $! >"$PIDFILE"
    i=0
    until [ -n "$(json_field BackendState)" ]; do
        i=$((i + 1))
        if [ $i -gt 100 ]; then
            echo "tailscaled didn't start; see $LOG" >&2
            exit 1
        fi
        sleep 0.2
    done
}

# Joins the tailnet (the first run prints a login URL to approve), then serves the board.
configure() {
    if [ "$(json_field BackendState)" != "Running" ]; then
        # `tailscale up` has to stay running until the login completes; a client
        # that gives up early abandons the auth URL (the server answers 410).
        ts up --hostname="$NAME" --accept-dns=false --accept-routes=false >"$STATE_DIR/up.log" 2>&1 &
        shown=""
        i=0
        while [ "$(json_field BackendState)" != "Running" ]; do
            url=$(grep -o 'https://login.tailscale.com/[^ ]*' "$STATE_DIR/up.log" 2>/dev/null | head -1 || true)
            if [ -n "$url" ] && [ "$url" != "$shown" ]; then
                echo "Approve the $NAME node in your tailnet: $url"
                shown="$url"
            fi
            i=$((i + 1))
            if [ $i -gt 900 ]; then
                echo "not logged in after 15 minutes" >&2
                exit 1
            fi
            sleep 1
        done
    fi
    ts serve --bg --https=443 "$BOARD" >/dev/null
    dns=$(json_field DNSName)
    echo "serving https://${dns%.} -> $BOARD"
}

case "${1:-}" in
start)
    require_bin
    if running; then
        echo "already running (pid $(cat "$PIDFILE"))"
    else
        start_tailscaled
    fi
    configure
    ;;
run)
    require_bin
    trap 'kill "$(cat "$PIDFILE")" 2>/dev/null' TERM INT
    start_tailscaled
    configure
    wait "$(cat "$PIDFILE")"
    ;;
status)
    ts status --self --peers=false
    ts serve status
    ;;
stop)
    if running; then
        kill "$(cat "$PIDFILE")"
        rm -f "$PIDFILE"
        echo "stopped"
    else
        echo "not running"
    fi
    ;;
*)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
