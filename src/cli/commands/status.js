import { callRelay } from "../relayClient.js";

export async function status(args, config) {
    const res = await callRelay(config, "GET", "/status");
    if (res.status !== 200) {
        console.error(`vt: ${res.json?.error?.message ?? res.text}`);
        process.exitCode = 1;
        return;
    }
    console.log(JSON.stringify(res.json, null, 2));
}
