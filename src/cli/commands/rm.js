import { callRelay } from "../relayClient.js";

export async function rm(args, config) {
    const [page] = args;
    if (!page) throw new Error("usage: vt rm <page>");

    const res = await callRelay(config, "DELETE", `/pages/${page}`);
    if (res.status === 204) {
        console.log(`removed page ${page}`);
        return;
    }
    console.error(`vt: ${res.json?.error?.message ?? res.text}`);
    process.exitCode = 1;
}
