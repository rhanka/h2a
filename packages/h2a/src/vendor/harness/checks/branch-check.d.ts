import type { HarnessProfile } from '../profile/profile.js';
import type { CheckResult } from '../artifacts/verification-run.js';
export interface BranchCheckInput {
    currentBranch: string;
    /** Caller-supplied this slice (parsing a BRANCH.md identity block is a follow-on). */
    expectedBranch: string;
    profile: HarnessProfile;
    /** Documented reason to skip the check (advisory bypass). */
    bypass?: {
        reason: string;
    };
}
/** C1 — verify the working branch is the expected one (per the profile's `branchMatch`). */
export declare function checkBranch(input: BranchCheckInput): CheckResult;
