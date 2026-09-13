import { callRelay } from "../relayClient.js";
import { formatRelative } from "../format.js";

export async function status(args, config) {
    if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
        throw new Error("usage: vt status [--json]");
    }
    const asJson = args[0] === "--json";

    const res = await callRelay(config, "GET", "/status");
    if (res.status !== 200) {
        console.error(`vt: ${res.json?.error?.message ?? res.text}`);
        process.exitCode = 1;
        return;
    }

    if (asJson) {
        console.log(JSON.stringify(res.json, null, 2));
        return;
    }

    const { board, lastRedrawAt } = res.json;
    if (!board) {
        console.log("board has never connected");
    } else {
        const battery = board.battery === null ? "unknown" : `${board.battery.toFixed(2)}V`;
        const rssi = board.rssi === null ? "unknown" : `${board.rssi} dBm`;
        console.log(
            `board last seen ${formatRelative(board.lastSeen)}, battery ${battery}, rssi ${rssi}, showing page ${board.page ?? "unknown"}, fw ${board.fw ?? "unknown"}`,
        );
    }
    console.log(`last redraw ${lastRedrawAt ? formatRelative(lastRedrawAt) : "never"}`);
}
