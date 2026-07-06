import type { VerificationCategory, ViolationSeverity } from './verification-run.js';
export declare const VERIFICATION_CATEGORIES: readonly VerificationCategory[];
export declare const VIOLATION_SEVERITIES: readonly ViolationSeverity[];
export type ValidationMode = 'structural' | 'ingested';
export interface ValidateOptions {
    /** `ingested` ⇒ also enforce per-check `target` presence (adapter fail-closed). */
    mode?: ValidationMode;
}
export interface ValidationResult {
    valid: boolean;
    /** Dot/bracket paths + messages, e.g. `checks[0].target: required for ingested check`. */
    errors: string[];
}
/**
 * Validate an unknown value against the frozen VerificationRun v0 contract. Pure, dependency-free,
 * deterministic. Returns every error rather than throwing on the first.
 */
export declare function validateVerificationRunV0(run: unknown, opts?: ValidateOptions): ValidationResult;
/**
 * Derive the scope verdict from violations+severity (DEC-S3, the frozen cross-contract predicate):
 * any `blocking` ⇒ `violation`; else any `advisory` ⇒ `conditional`; else `clean`. NEVER derived
 * from `result`. The harness does NOT route on this (that is the track-side adapter); it is exposed
 * so the predicate can be asserted against the frozen contract rather than trusted.
 */
export declare function deriveVerdict(violations: ReadonlyArray<{
    severity: ViolationSeverity;
}>): 'clean' | 'violation' | 'conditional';
