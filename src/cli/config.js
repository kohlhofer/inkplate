import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_RELAY = "http://127.0.0.1:8080";

export function defaultConfigPath() {
    return path.join(os.homedir(), ".config", "vt", "config.json");
}

// {relay, token}; VT_RELAY/VT_TOKEN override the file. A config file mode
// wider than 0600 gets a stderr warning, not a hard failure — it holds a
// bearer token, and this is a home LAN device, not a stranger's shell.
export function loadCliConfig({ env = process.env, configPath = defaultConfigPath() } = {}) {
    let fileConfig = {};
    try {
        const stat = fs.statSync(configPath);
        const mode = stat.mode & 0o777;
        if (mode & 0o077) {
            console.error(`vt: warning: ${configPath} is readable by others (mode ${mode.toString(8)}); consider chmod 600`);
        }
        fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
        if (err.code !== "ENOENT") {
            console.error(`vt: warning: could not read ${configPath}: ${err.message}`);
        }
    }
    return {
        relay: env.VT_RELAY ?? fileConfig.relay ?? DEFAULT_RELAY,
        token: env.VT_TOKEN ?? fileConfig.token ?? null,
        configPath,
    };
}

export function saveCliConfig(patch, configPath = defaultConfigPath()) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    let existing = {};
    try {
        existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
        // fresh file
    }
    fs.writeFileSync(configPath, JSON.stringify({ ...existing, ...patch }, null, 2), { mode: 0o600 });
}
