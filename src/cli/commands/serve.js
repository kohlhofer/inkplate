import { createServer } from "../../relay/server.js";
import { loadConfig } from "../../relay/config.js";

// The only way to run the relay (no `make relay` — see the plan's Rams
// finding 27). The relay dies when the laptop sleeps; `make relay-install`
// is the keep-running mechanism, documented in CLAUDE.md.
export async function serve(args, cliConfig, relayConfig = loadConfig()) {
    let port;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--port") port = Number(args[++i]);
    }
    const config = port !== undefined ? { ...relayConfig, port } : relayConfig;

    const server = createServer(config);
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, resolve);
    });
    console.log(`videotext relay listening on ${config.host}:${config.port} (theme=${config.theme}, data=${config.dataDir})`);
}
