import type { HarnessProfile } from '../profile/profile.js';
export type PathClass = 'allowed' | 'forbidden' | 'conditional' | 'unknown';
/** The Allowed / Forbidden / Conditional path globs declared by a BRANCH.md. */
export interface ScopeBoundary {
    allowed: string[];
    forbidden: string[];
    conditional: string[];
}
/** Translate a path glob into an anchored RegExp. `**` spans `/`; `*` stays within a segment. */
export declare function globToRegExp(glob: string): RegExp;
export declare function matchGlob(glob: string, path: string): boolean;
/**
 * Classify a repo-relative path against a branch ScopeBoundary + the profile's default
 * forbidden globs (C2 scope-check core).
 *
 * Precedence (first match wins):
 *   explicit allowed > explicit forbidden > explicit conditional > profile default-forbidden > unknown
 *
 * `allowed` wins over `forbidden` so an explicitly-granted subtree (e.g. `packages/harness/**`)
 * is `allowed` even when a broader `packages/**` is forbidden — the Allowed list is the granted
 * implementation scope. `conditional` is checked before profile defaults so a Conditional listing
 * (e.g. `Makefile` with an exception) overrides the profile's default-forbidden classification.
 */
export declare function classifyPath(path: string, boundary: ScopeBoundary, profile: HarnessProfile): PathClass;
