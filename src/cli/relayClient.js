export class RelayUnreachableError extends Error {}

// Every CLI command that needs the relay goes through here, so the
// unreachable-relay message (2.8) is spelled exactly once.
export async function callRelay(config, method, urlPath, { body, expectBinary = false } = {}) {
    const headers = {};
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
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

    if (expectBinary) {
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
