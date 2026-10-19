import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
/** RFC 8785 JSON values: UTF-16 key order, ECMAScript numbers, no coercion. */
export function canonicalJson(value) {
    const ancestors = new Set();
    const string = (s) => {
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            if (c >= 0xd800 && c <= 0xdbff) {
                const next = s.charCodeAt(++i);
                if (!(next >= 0xdc00 && next <= 0xdfff))
                    throw new Error('Non-I-JSON surrogate');
            }
            else if (c >= 0xdc00 && c <= 0xdfff)
                throw new Error('Non-I-JSON surrogate');
        }
        return JSON.stringify(s);
    };
    const encode = (v) => {
        if (v === null)
            return 'null';
        if (typeof v === 'string')
            return string(v);
        if (typeof v === 'boolean')
            return String(v);
        if (typeof v === 'number' && Number.isFinite(v))
            return JSON.stringify(v);
        if (typeof v !== 'object' || ancestors.has(v))
            throw new Error('Expected acyclic JSON value');
        ancestors.add(v);
        let result;
        if (Array.isArray(v)) {
            if (Object.keys(v).length !== v.length)
                throw new Error('Expected dense JSON array');
            result = `[${v.map(encode).join(',')}]`;
        }
        else {
            if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
                throw new Error('Expected JSON object');
            result = `{${Object.keys(v).sort().map(k => `${string(k)}:${encode(v[k])}`).join(',')}}`;
        }
        ancestors.delete(v);
        return result;
    };
    return encode(value);
}
export const baseDigest = (value) => `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))))}`;
export function manifestDigest(value) {
    const { manifestBaseHash: _ignored, ...projection } = value;
    return baseDigest(projection);
}
export function returnDigest(value) {
    const { digest: _ignored, ...projection } = value;
    return baseDigest(projection);
}
