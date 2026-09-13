#!/usr/bin/env node
import { loadCliConfig } from "../src/cli/config.js";
import { RelayUnreachableError } from "../src/cli/relayClient.js";
import { send } from "../src/cli/commands/send.js";
import { rm } from "../src/cli/commands/rm.js";
import { ls } from "../src/cli/commands/ls.js";
import { preview } from "../src/cli/commands/preview.js";
import { status } from "../src/cli/commands/status.js";
import { token } from "../src/cli/commands/token.js";
import { serve } from "../src/cli/commands/serve.js";

const COMMANDS = { send, rm, ls, preview, status, token, serve };
const USAGE = "usage: vt <send|rm|ls|preview|status|token|serve> ...";

async function main(argv) {
    const [cmd, ...rest] = argv;

    // `vt`, `vt help`, `vt --help` print usage and exit 0 — anything else
    // unrecognised is a real error, and exits 1 (finding m13).
    if (!cmd || cmd === "help" || cmd === "--help") {
        console.log(USAGE);
        return;
    }

    const handler = COMMANDS[cmd];
    if (!handler) {
        console.error(`vt: unknown command '${cmd}'`);
        console.error(USAGE);
        process.exitCode = 1;
        return;
    }

    const config = loadCliConfig();
    try {
        await handler(rest, config);
    } catch (err) {
        if (err instanceof RelayUnreachableError) {
            console.error(err.message);
        } else {
            console.error(`vt: ${err.message}`);
        }
        process.exitCode = 1;
    }
}

main(process.argv.slice(2));
