import type { HarnessProfile } from '../profile/profile.js';
import type { CheckResult } from '../artifacts/verification-run.js';
import { type ScopeBoundary } from '../scope/scope-boundary.js';
export interface ScopeCheckInput {
    /** Repo-relative staged file paths. */
    stagedFiles: string[];
    boundary: ScopeBoundary;
    profile: HarnessProfile;
    /** Exception ids declared in the BRANCH.md (e.g. parser `exceptions`). */
    declaredExceptions?: string[];
    bypass?: {
        reason: string;
    };
}
/**
 * C2 — verify staged files stay within the declared scope.
 *  - `forbidden` (explicit or profile-default) → violation;
 *  - `conditional` → violation unless a declared exception matches the profile's
 *    `exceptionIdPattern` (grammar binding) AND `conditionalRequiresException` is set;
 *  - `unknown` (outside Allowed/Forbidden/Conditional) → violation.
 */
export declare function checkScope(input: ScopeCheckInput): CheckResult;
