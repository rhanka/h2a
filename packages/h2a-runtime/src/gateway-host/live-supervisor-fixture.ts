/** L9-H read-side protocol helpers (test fixture only).
 *
 * Pure, deterministic protocol arithmetic shared by
 * `live-read-side.test.ts` and mirrored by `scripts/bench-live.mjs`
 * (which stays dependency-free and reimplements the same formulas over
 * measured timings). No Git, no model, no network, no clock: every
 * function is total over its documented domain except where an explicit
 * throw replaces a silent skip.
 *
 * Fixed plan values (Δ-L9-S/L9-H, 2026-10-17 amendment):
 * - population: all 20 first investigations, no case removed;
 * - score: median(1 - T1_i/T0_i);
 * - continuation threshold: 0.30 at constant quality, never retuned;
 * - execution pilot: >= 20% additional gain, not authorized here.
 */

/** Fixed continuation threshold. Never retune after measurement. */
export const READ_SIDE_CONTINUATION_THRESHOLD = 0.30;
/** Additional net gain required by a future execution pilot (not authorized). */
export const EXECUTION_PILOT_ADDITIONAL_GAIN = 0.20;
/** Fixed corpus size. The harness retains every case, including failures. */
export const READ_SIDE_CASE_COUNT = 20;

export type ReadSideArm = "T0" | "T1";
export type ReadSideOrder = [ReadSideArm, ReadSideArm];

/** States that are explicit non-success outcomes, never time savings. */
const NON_SUCCESS_STATES = new Set([
  "capability-absent",
  "capacité absente",
  "capture-absent",
  "policy-unavailable",
  "reader-absent",
  "failed",
  "denied",
  "refused",
]);

export function isNonSuccessState(state: string): boolean {
  return NON_SUCCESS_STATES.has(state);
}

/** Counterbalanced arm order: odd cases run T0 first, even cases T1 first. */
export function counterbalancedOrder(caseId: number): ReadSideOrder {
  if (!Number.isSafeInteger(caseId) || caseId < 1) throw new Error(`invalid case id: ${caseId}`);
  return caseId % 2 === 1 ? ["T0", "T1"] : ["T1", "T0"];
}

/** Per-case relative gain. Null (retained, never skipped) when T0 is unusable. */
export function perCaseGain(t0Ms: number, t1Ms: number): number | null {
  if (!Number.isFinite(t0Ms) || !Number.isFinite(t1Ms)) return null;
  if (!(t0Ms > 0)) return null;
  return 1 - t1Ms / t0Ms;
}

/** Median over the whole population. Throws on empty: no silent skip. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty population");
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error("median requires finite gains");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Median gain over every timed case. Null entries stay visible to the caller. */
export function medianGain(timings: ReadonlyArray<{ t0Ms: number; t1Ms: number }>): number {
  if (timings.length === 0) throw new Error("median gain of an empty population");
  return median(
    timings.map(({ t0Ms, t1Ms }) => {
      const gain = perCaseGain(t0Ms, t1Ms);
      if (gain === null) throw new Error("median gain requires a usable T0 for every retained case");
      return gain;
    }),
  );
}

/** Constant quality: every case matched its frozen expectation. */
export function qualityMet(matchedExpectations: readonly boolean[]): boolean {
  return matchedExpectations.length > 0 && matchedExpectations.every(Boolean);
}

export interface ContinuationVerdict {
  readonly decision: boolean;
  readonly reasons: readonly string[];
}

/** Continuation requires both the fixed threshold and constant quality. */
export function continuationDecided(medianGainValue: number, quality: boolean): ContinuationVerdict {
  const reasons: string[] = [];
  if (!Number.isFinite(medianGainValue)) {
    return { decision: false, reasons: ["median gain is not finite"] };
  }
  if (medianGainValue < READ_SIDE_CONTINUATION_THRESHOLD) {
    reasons.push(`median gain ${medianGainValue.toFixed(4)} < fixed threshold ${READ_SIDE_CONTINUATION_THRESHOLD}`);
  }
  if (!quality) reasons.push("constant quality not met: at least one case did not match its frozen expectation");
  return { decision: reasons.length === 0, reasons };
}
