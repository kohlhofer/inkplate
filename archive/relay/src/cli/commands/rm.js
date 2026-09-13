import { callRelay } from "../relayClient.js";
import { validatePageArg } from "../validate.js";

export async function rm(args, config) {
    const [page, ...rest] = args;
    if (!page || rest.length > 0) throw new Error("usage: vt rm <page>");
    validatePageArg(page);

    const res = await callRelay(config, "DELETE", `/pages/${page}`);
    if (res.status === 204) {
        console.log(`removed page ${page}`);
        return;
    }
    console.error(`vt: ${res.json?.error?.message ?? res.text}`);
    process.exitCode = 1;
}
