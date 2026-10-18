import type { ValidationIssue } from './index.js';
export declare class EvidenceError extends Error {
    readonly issue: ValidationIssue;
    constructor(issue: ValidationIssue);
}
export declare const fail: (path: string, code: string, message: string) => never;
export declare function record(value: unknown, path: string, required: readonly string[], optional?: readonly string[]): Record<string, unknown>;
export declare function text(value: unknown, path: string, allowEmpty?: boolean): string;
export declare function array(value: unknown, path: string): unknown[];
export declare const strings: (value: unknown, path: string) => string[];
export declare function imageDimensions(bytes: Uint8Array, media: string): [number, number] | undefined;
