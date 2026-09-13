// Every error response is {"error":{"code":"...","message":"..."}}, never a
// stack trace. Rejected requests get Connection: close rather than trying to
// drain an unread body under keep-alive (see the plan's ordering rule, 2.2).
export function sendError(res, status, code, message) {
    if (res.headersSent) return;
    const body = JSON.stringify({ error: { code, message } });
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Connection: "close",
    });
    res.end(body);
}

export class ValidationError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
