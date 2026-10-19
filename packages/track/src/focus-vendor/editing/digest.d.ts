/** RFC 8785 JSON values: UTF-16 key order, ECMAScript numbers, no coercion. */
export declare function canonicalJson(value: unknown): string;
export declare const baseDigest: (value: unknown) => string;
export declare function manifestDigest(value: object): string;
export declare function returnDigest(value: object): string;
