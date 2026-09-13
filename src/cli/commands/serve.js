import os from "node:os";
import { createServer } from "../../relay/server.js";
import { loadConfig } from "../../relay/config.js";
import { TokenStore } from "../../relay/tokens.js";

// The only way to run the relay (no `make relay` — see the plan's Rams
// finding 27). The relay dies when the laptop sleeps; `make relay-install`
// is the keep-running mechanism, documented in CLAUDE.md.
export async function serve(args, cliConfig, relayConfig = loadConfig()) {
    let port;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--port") port = Number(args[++i]);
        else throw new Error(`unknown argument '${args[i]}'\nusage: vt serve [--port N]`);
    }
    const config = port !== undefined ? { ...relayConfig, port } : relayConfig;

    const server = createServer(config);
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, resolve);
    });
    console.log(`videotext relay listening on ${config.host}:${config.port} (theme=${config.theme}, data=${config.dataDir})`);

    // The board's config.h needs a real IP for RELAY_HOST, not 0.0.0.0
    // (finding i2).
    const lanUrls = Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => `http://${i.address}:${config.port}`);
    if (lanUrls.length > 0) {
        console.log(`board RELAY_HOST candidates: ${lanUrls.join(", ")}`);
    }

    if (!new TokenStore(config.dataDir).hasBoardToken()) {
        console.error("warning: no board token configured yet; run `vt token board --rotate`");
    }
}
