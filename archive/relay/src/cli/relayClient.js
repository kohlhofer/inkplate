export class RelayUnreachableError extends Error {}

// Every CLI command that needs the relay goes through here, so the
// unreachable-relay message (2.8) is spelled exactly once. A missing token
// is detected locally, before ever attempting the request (finding M16) —
// the relay's own "missing or unknown token" 401 is accurate but doesn't
// tell the owner what to do about it.
export async function callRelay(config, method, urlPath, { body, expectBinary = false } = {}) {
    if (!config.token) {
        throw new Error("no token configured; run vt token add <name> --pages A-B --save");
    }

    const headers = { Authorization: `Bearer ${config.token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res;
    try {
        res = await fetch(`${config.relay}${urlPath}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new RelayUnreachableError(`no relay at ${config.relay}; start it with \`vt serve\``);
    }

    // Binary responses (the preview PNG) are only actually binary on
    // success; an error status is always the usual JSON error body, and
    // callers need res.json.error.message from it (finding m10).
    if (expectBinary && res.ok) {
        return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
    }
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        // not JSON (e.g. a 204 with no body)
    }
    return { status: res.status, json, text };
}
