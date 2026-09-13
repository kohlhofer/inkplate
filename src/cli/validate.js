const PAGE_ARG_PATTERN = /^\d{3}$/;

// Every CLI command that turns a page argument into a URL or a file path
// validates it here first (finding m29): `vt preview "210.png#/../../..<path>"`
// used to write a PNG outside the intended tmpdir because the raw argument
// was interpolated straight into a path.
export function validatePageArg(page) {
    if (typeof page !== "string" || !PAGE_ARG_PATTERN.test(page)) {
        throw new Error(`page must be a 3-digit number like 205, got '${page}'`);
    }
    return page;
}
