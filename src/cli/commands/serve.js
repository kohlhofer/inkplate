import os from "node:os";
import { createServer } from "../../relay/server.js";
import { loadConfig } from "../../relay/config.js";
import { TokenStore } from "../../relay/tokens.js";

// VPN addresses such as Tailscale's 100.x are not reachable from the board.
export function isPrivateLan(ip) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// The only way to run the relay. `make relay-install` runs this as a login
// service instead; see CLAUDE.md.
export async function serve(args, cliConfig, relayConfig = loadConfig()) {
    let port;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--port") port = Number(args[++i]);
        else throw new Error(`unknown argument '${args[i]}'\nusage: vt serve [--port N]`);
    }
    const config = port !== undefined ? { ...relayConfig, port } : relayConfig;

    const server = createServer(config);
    await new Promise((resolve, reject) => {
        server.once("error", (err) => {
            if (err.code === "EADDRINUSE") {
                reject(new Error(`port ${config.port} is already in use; is another relay running? (make relay-uninstall stops the login service)`));
            } else {
                reject(err);
            }
        });
        server.listen(config.port, config.host, resolve);
    });
    console.log(`videotext relay listening on ${config.host}:${config.port} (theme=${config.theme}, data=${config.dataDir})`);

    // config.h takes a bare IP and a separate port.
    const lanIps = Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal && isPrivateLan(i.address))
        .map((i) => i.address);
    for (const ip of lanIps) {
        console.log(`for the board's config.h: #define RELAY_HOST "${ip}"  #define RELAY_PORT ${config.port}`);
    }

    if (!new TokenStore(config.dataDir).hasBoardToken()) {
        console.error("warning: no board token yet; run `node bin/vt.js token board --rotate`");
    }
}
