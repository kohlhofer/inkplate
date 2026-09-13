import fs from "node:fs";
import { callRelay } from "../relayClient.js";
import { validatePageArg } from "../validate.js";
import { formatDisplay } from "../format.js";

const USAGE =
    "usage: vt send <page> <title> [--body text|stdin] [--ttl 2h] [--urgent] [--layout ...] " +
    '[--image file] [--style dither|blocks] [--chart "1 2 3"] [--chart-type spark|bars] [--chart-label text]';

const FLAGS_WITH_VALUE = new Set(["--body", "--ttl", "--layout", "--image", "--style", "--chart", "--chart-type", "--chart-label"]);
const BOOLEAN_FLAGS = new Set(["--urgent"]);
const FLAG_TO_KEY = {
    "--body": "body",
    "--ttl": "ttl",
    "--layout": "layout",
    "--image": "image",
    "--style": "style",
    "--chart": "chart",
    "--chart-type": "chartType",
    "--chart-label": "chartLabel",
};

// Rejects unknown flags and extra positionals instead of silently dropping
// them (finding M12): `vt send 207 "t" --ttl 2 hours` used to consume "2" as
// the ttl and drop the stray "hours" positional, posting a title-mismatched
// 2-second page while reporting success.
function parseArgs(args) {
    const [page, title, ...rest] = args;
    const opts = {};
    for (let i = 0; i < rest.length; i++) {
        const flag = rest[i];
        if (BOOLEAN_FLAGS.has(flag)) {
            opts.urgent = true;
            continue;
        }
        if (FLAGS_WITH_VALUE.has(flag)) {
            opts[FLAG_TO_KEY[flag]] = rest[++i];
            continue;
        }
        throw new Error(`unknown argument '${flag}'\n${USAGE}`);
    }
    return { page, title, ...opts };
}

export async function send(args, config) {
    const { page, title, body, ttl, urgent, layout, image, style, chart, chartType, chartLabel } = parseArgs(args);
    if (!page || !title) throw new Error(USAGE);
    validatePageArg(page);

    const payload = { title };
    if (body === "stdin") payload.body = fs.readFileSync(0, "utf8");
    else if (body !== undefined) payload.body = body;
    if (ttl !== undefined) payload.ttl = ttl;
    if (urgent) payload.urgent = true;
    if (layout !== undefined) payload.layout = layout;
    if (image !== undefined) {
        payload.image = { data: fs.readFileSync(image).toString("base64"), style: style ?? "dither" };
    }
    if (chart !== undefined) {
        payload.chart = {
            type: chartType ?? "spark",
            values: chart.trim().split(/\s+/).map(Number),
        };
        if (chartLabel !== undefined) payload.chart.label = chartLabel;
    }

    const res = await callRelay(config, "POST", `/pages/${page}`, { body: payload });
    if (res.status !== 201) {
        console.error(`vt: ${res.json?.error?.message ?? res.text}`);
        process.exitCode = 1;
        return;
    }
    const { number, expiresAt, warnings } = res.json;
    console.log(`page ${number} live until ${formatDisplay(expiresAt)} · listed on P100 at the next poll · vt preview ${number}`);
    for (const warning of warnings ?? []) console.error(`warning: ${warning}`);
}
