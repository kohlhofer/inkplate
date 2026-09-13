import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { callRelay } from "../relayClient.js";

export async function preview(args, config) {
    const [page, ...rest] = args;
    if (!page) throw new Error("usage: vt preview <page> [--out file.png]");

    let out;
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--out") out = rest[++i];
    }

    const res = await callRelay(config, "GET", `/preview/${page}.png`, { expectBinary: true });
    if (res.status !== 200) {
        console.error(`vt: preview ${page} failed (status ${res.status})`);
        process.exitCode = 1;
        return;
    }

    const outPath = out ?? path.join(os.tmpdir(), `vt-preview-${page}.png`);
    fs.writeFileSync(outPath, res.buffer);
    console.log(outPath);
    if (!out) spawn("open", [outPath], { stdio: "ignore", detached: true }).unref();
}
