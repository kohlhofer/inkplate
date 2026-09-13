import { callRelay } from "../relayClient.js";
import { formatDisplay } from "../format.js";

export async function ls(args, config) {
    if (args.length > 0) throw new Error("usage: vt ls");

    const res = await callRelay(config, "GET", "/pages");
    if (res.status !== 200) {
        console.error(`vt: ${res.json?.error?.message ?? res.text}`);
        process.exitCode = 1;
        return;
    }

    const pages = res.json;
    if (pages.length === 0) {
        console.log("no pages live");
        return;
    }

    // Aligned columns: number, sender, title, expiry (finding M14).
    const numberW = Math.max(...pages.map((p) => String(p.number).length));
    const senderW = Math.max(...pages.map((p) => p.sender.length));
    const titleW = Math.max(...pages.map((p) => p.title.length));
    for (const p of pages) {
        const marker = p.urgent ? "!" : " ";
        console.log(
            `${marker}${String(p.number).padEnd(numberW)}  ${p.sender.padEnd(senderW)}  ${p.title.padEnd(titleW)}  expires ${formatDisplay(p.expiresAt)}`,
        );
    }
}
