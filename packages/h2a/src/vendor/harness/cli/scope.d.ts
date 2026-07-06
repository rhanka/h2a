import type { CheckResult } from '../artifacts/verification-run.js';
import type { HarnessProfile } from '../profile/profile.js';
import { type FlagValue } from './args.js';
export interface ScopeOutcome {
    /** The scope CheckResult, when inputs resolved. */
    result?: CheckResult;
    /** The unreadable plan-file path, when `--branch-md` could not be read. */
    unreadable?: string;
}
/** Resolve `--branch-md` + `--staged-files` into a C2 scope CheckResult (pure but for the file read). */
export declare function scopeFromFlags(flags: Record<string, FlagValue>, profile: HarnessProfile): ScopeOutcome;
