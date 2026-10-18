export class EvidenceError extends Error {
    issue;
    constructor(issue) {
        super(issue.message);
        this.issue = issue;
    }
}
export const fail = (path, code, message) => {
    throw new EvidenceError({ path, code, message });
};
export function record(value, path, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail(path, 'invalid_evidence', 'Expected a closed object');
    const obj = value;
    for (const key of Object.keys(obj))
        if (![...required, ...optional].includes(key))
            fail(`${path}.${key}`, 'invalid_evidence', 'Unknown evidence field');
    for (const key of required)
        if (!Object.hasOwn(obj, key))
            fail(`${path}.${key}`, 'invalid_evidence', 'Missing evidence field');
    return obj;
}
export function text(value, path, allowEmpty = false) {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
        fail(path, 'invalid_evidence', 'Expected a non-empty string');
    return value;
}
export function array(value, path) {
    if (!Array.isArray(value))
        fail(path, 'invalid_evidence', 'Expected an array');
    return value;
}
export const strings = (value, path) => array(value, path).map((v, i) => text(v, `${path}[${i}]`));
export function imageDimensions(bytes, media) {
    const u32 = (n) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(n);
    if (media === 'image/png') {
        if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
            && u32(8) === 13 && u32(12) === 0x49484452)
            return [u32(16), u32(20)];
    }
    else if (bytes[0] === 255 && bytes[1] === 216) {
        let i = 2;
        while (i + 4 < bytes.length && bytes[i] === 255) {
            const marker = bytes[i + 1], size = (bytes[i + 2] << 8) | bytes[i + 3];
            if (size < 2 || i + 2 + size > bytes.length)
                break;
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8)
                return [(bytes[i + 7] << 8) | bytes[i + 8], (bytes[i + 5] << 8) | bytes[i + 6]];
            i += size + 2;
        }
    }
    return undefined;
}
