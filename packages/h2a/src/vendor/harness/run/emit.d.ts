import type { CheckResult, VerificationRun, VerificationCategory } from '../artifacts/verification-run.js';
export interface NamedCheck {
    code: string;
    category: VerificationCategory;
    result: CheckResult;
}
export interface VerificationContext {
    runId: string;
    commit: string;
    branch: string;
    env: string;
    runner: string;
    category: VerificationCategory;
    command: string;
    startedAt: string;
    finishedAt: string;
    artifacts?: string[];
    /**
     * Immutable locator for the full run JSON (DEC-S2). Producer-supplied; when omitted a
     * deterministic `verification-run:{runId}` placeholder is used so the field stays REQUIRED
     * on the artifact. Immutability is a producer guarantee, not enforced here.
     */
    artifactLocator?: string;
}
/**
 * Assemble a NEUTRAL `VerificationRun` from check results. harness EMITS this artifact and
 * never writes into `@sentropic/track` — a track-side adapter ingests it (no track import here).
 */
export declare function toVerificationRun(checks: NamedCheck[], ctx: VerificationContext): VerificationRun;
