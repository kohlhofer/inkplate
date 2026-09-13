import { callRelay } from "../relayClient.js";

export async function ls(args, config) {
    const res = await callRelay(config, "GET", "/pages");
    if (res.status !== 200) {
        console.error(`vt: ${res.json?.error?.message ?? res.text}`);
        process.exitCode = 1;
        return;
    }
    for (const number of res.json) console.log(number);
}
