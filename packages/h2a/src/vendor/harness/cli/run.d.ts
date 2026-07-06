/**
 * Pure, arg-based CLI driver — reads everything from `argv`, writes via `out`, returns an exit code.
 * No internal git calls (the caller supplies branch + staged files), no `process.exit`, no fs writes.
 * Advisory (D5 Layer A): a failing check returns 0; only a usage error returns non-zero.
 *
 * Verb families: `check` (C1/C2 → VerificationRun); method/recorder verbs (brainstorm/test/debug/
 * review/plan/branch/skills → WorkEvent + skill pointer, see `method-verbs.ts`).
 */
export declare function runHarnessCli(argv: string[], out: (s: string) => void): number;
