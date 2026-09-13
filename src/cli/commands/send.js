import fs from "node:fs";
import { callRelay } from "../relayClient.js";

function parseArgs(args) {
    const [page, title, ...rest] = args;
    const opts = {};
    for (let i = 0; i < rest.length; i++) {
        const flag = rest[i];
        if (flag === "--body") opts.body = rest[++i];
        else if (flag === "--ttl") opts.ttl = rest[++i];
        else if (flag === "--urgent") opts.urgent = true;
        else if (flag === "--layout") opts.layout = rest[++i];
        else if (flag === "--image") opts.image = rest[++i];
        else if (flag === "--style") opts.style = rest[++i];
        else if (flag === "--chart") opts.chart = rest[++i];
        else if (flag === "--chart-type") opts.chartType = rest[++i];
        else if (flag === "--chart-label") opts.chartLabel = rest[++i];
    }
    return { page, title, ...opts };
}

export async function send(args, config) {
    const { page, title, body, ttl, urgent, layout, image, style, chart, chartType, chartLabel } = parseArgs(args);
    if (!page || !title) {
        throw new Error(
            "usage: vt send <page> <title> [--body text|stdin] [--ttl 2h] [--urgent] [--layout ...] " +
                "[--image file] [--style dither|blocks] [--chart \"1 2 3\"] [--chart-type spark|bars] [--chart-label text]",
        );
    }

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
    for (const warning of res.json.warnings ?? []) console.error(`warning: ${warning}`);
    console.log(res.json.location);
}
