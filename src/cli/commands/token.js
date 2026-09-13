import { loadConfig } from "../../relay/config.js";
import { TokenStore } from "../../relay/tokens.js";
import { validateTokenName } from "../../relay/validate.js";
import { saveCliConfig } from "../config.js";

// Admin over tokens is a local file operation (tokens.js), never HTTP —
// there's no "add token" route (see the plan's auth section).
export async function token(args, cliConfig, relayConfig = loadConfig()) {
    const [sub, ...rest] = args;
    const tokens = new TokenStore(relayConfig.dataDir);

    if (sub === "add") {
        const [name, ...flags] = rest;
        validateTokenName(name);
        let pages;
        let images = false;
        let urgent = false;
        let save = false;
        for (let i = 0; i < flags.length; i++) {
            if (flags[i] === "--pages") pages = flags[++i];
            else if (flags[i] === "--images") images = true;
            else if (flags[i] === "--urgent") urgent = true;
            else if (flags[i] === "--save") save = true;
        }
        if (!pages) throw new Error("usage: vt token add <name> --pages 200-299 [--images] [--urgent] [--save]");

        const raw = tokens.addSender(name, { pages, images, urgent });
        console.log(raw);
        console.error("this value will not be shown again");
        if (save) saveCliConfig({ token: raw, relay: cliConfig.relay }, cliConfig.configPath);
        return;
    }

    if (sub === "list") {
        for (const s of tokens.listSenders()) {
            console.log(`${s.name}\t${s.pages}\timages=${s.images}\turgent=${s.urgent}`);
        }
        return;
    }

    if (sub === "revoke") {
        const [name] = rest;
        if (!name) throw new Error("usage: vt token revoke <name>");
        console.log(tokens.revokeSender(name) ? `revoked '${name}'` : `no such token '${name}'`);
        return;
    }

    if (sub === "board" && rest[0] === "--rotate") {
        const raw = tokens.rotateBoardToken();
        console.log(raw);
        console.error("this value will not be shown again; write it into config.h's BOARD_TOKEN");
        return;
    }

    throw new Error("usage: vt token <add <name> --pages A-B [--images] [--urgent] [--save] | list | revoke <name> | board --rotate>");
}
