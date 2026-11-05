/**
 * Conservative clock for `remote-action-v1` admission (cell N1).
 *
 * Single rule: admission succeeds only while `nowMs` stays strictly below
 * every applicable deadline minus the fixed 5000 ms error budget. At or past
 * the cutoff the decision is expired — the just-before tick passes, the
 * cutoff tick refuses. Unknown or rolled-back clocks refuse; revocation
 * fences immediately regardless of remaining lease.
 *
 * JWT NumericDates are integer seconds. Non-integer, negative or
 * non-numeric values are malformed and refuse before any lifetime check.
 */

import { ACTION_TTL_MS, CONSERVATIVE_SKEW_MS } from "./remote-action-contract.js";

export interface ClockState {
  known: boolean;
  rollback: boolean;
}

export type DeadlineDecision =
  | "allow"
  | "relay_grant_expired"
  | "relay_grant_revoked"
  | "relay_grant_unavailable"
  | "relay_scope_refused";

export class ClockError extends Error {
  readonly code: "malformed_time";

  constructor(message?: string) {
    super(message ?? "malformed_time");
    this.name = "ClockError";
    this.code = "malformed_time";
  }
}

export interface DeadlineInput {
  issuedAtMs: number;
  expiresAtMs: number;
  otherDeadlinesMs: readonly number[];
  clock: ClockState;
  nowMs: number;
  revoked: boolean;
  subscriptionGap?: boolean;
}

export function evaluateAdmissionDeadline(input: DeadlineInput): DeadlineDecision {
  if (input.revoked) return "relay_grant_revoked";
  if (!input.clock.known || input.clock.rollback || input.subscriptionGap === true) {
    return "relay_grant_unavailable";
  }
  if (
    !Number.isSafeInteger(input.issuedAtMs) ||
    !Number.isSafeInteger(input.expiresAtMs) ||
    input.issuedAtMs < 0 ||
    input.expiresAtMs < 0 ||
    input.issuedAtMs > input.expiresAtMs ||
    input.expiresAtMs - input.issuedAtMs > ACTION_TTL_MS
  ) {
    return "relay_scope_refused";
  }
  let floor = input.expiresAtMs;
  for (const deadline of input.otherDeadlinesMs) {
    if (deadline < floor) floor = deadline;
  }
  if (input.nowMs >= floor - CONSERVATIVE_SKEW_MS) return "relay_grant_expired";
  return "allow";
}

/** Assert a JWT NumericDate (integer seconds) and return it. */
export function checkNumericDateSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ClockError();
  }
  return value;
}

/** True while `nowMs` is strictly before expiry minus the skew budget. */
export function isWithinLifetime(nowMs: number, expiresAtMs: number): boolean {
  return nowMs < expiresAtMs - CONSERVATIVE_SKEW_MS;
}
