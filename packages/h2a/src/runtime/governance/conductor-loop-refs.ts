/**
 * H5 — Conductor/loop references, the READ-ONLY reference surface (r2 §8.1 H5).
 *
 * Stable ids for conductor claims and objective loops so audit/escalation
 * records can reference collaboration context WITHOUT owning it: h2a exposes
 * the reference shape and derives it from its own claim/loop records; it does
 * not export user/tenant/workspace management, memory stores, or a second
 * session registry (L2 sessions are cluster-mesh records; h2a presence is
 * advisory liveness, never identity).
 *
 * Everything here is pure and frozen: no store, no writes, no liveness claims.
 */

import type { ConductorClaimEvent } from "./claims.js";

export const H2A_CONDUCTOR_LOOP_REF_FORMAT = "h2a.conductor-loop-ref/v1";

export type ConductorLoopRefKind = "conductor-claim" | "objective-loop";

export interface ConductorLoopRefV1 {
  readonly format: typeof H2A_CONDUCTOR_LOOP_REF_FORMAT;
  readonly kind: ConductorLoopRefKind;
  readonly ref: string;
  /** h2a workspace id (machine-local liveness/grouping id, never an authority). */
  readonly workspaceId?: string;
  readonly recordedAt: string;
}

const KINDS: readonly ConductorLoopRefKind[] = ["conductor-claim", "objective-loop"];

export function buildConductorLoopRef(input: {
  readonly kind: ConductorLoopRefKind;
  readonly refId: string;
  readonly workspaceId?: string;
  readonly recordedAt: string;
}): ConductorLoopRefV1 {
  if (!KINDS.includes(input.kind)) {
    throw new Error(
      `buildConductorLoopRef: kind must be one of ${KINDS.join(", ")} (got ${JSON.stringify(input.kind)})`
    );
  }
  if (typeof input.refId !== "string" || input.refId.length === 0) {
    throw new Error("buildConductorLoopRef: refId must be a non-empty string");
  }
  if (input.workspaceId !== undefined && (typeof input.workspaceId !== "string" || input.workspaceId.length === 0)) {
    throw new Error("buildConductorLoopRef: workspaceId must be a non-empty string when present");
  }
  if (typeof input.recordedAt !== "string" || input.recordedAt.length === 0) {
    throw new Error("buildConductorLoopRef: recordedAt must be a non-empty string");
  }
  return Object.freeze({
    format: H2A_CONDUCTOR_LOOP_REF_FORMAT,
    kind: input.kind,
    ref: input.refId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    recordedAt: input.recordedAt
  });
}

/**
 * Reference a conductor claim event (WP-G1b claims store). The stable id of a
 * claim is its (workspaceId, instance, at) triple; the reference is read-only —
 * it neither claims nor releases anything.
 */
export function conductorClaimRef(event: ConductorClaimEvent): ConductorLoopRefV1 {
  return buildConductorLoopRef({
    kind: "conductor-claim",
    refId: `claim:${event.workspaceId}:${event.instance}:${event.at}`,
    workspaceId: event.workspaceId,
    recordedAt: event.at
  });
}

/**
 * Reference an objective loop by its loop id. Optional workspace correlation;
 * the loop record itself stays owned by the objective-loop store.
 */
export function objectiveLoopRef(
  loopId: string,
  options: { readonly workspaceId?: string; readonly recordedAt: string }
): ConductorLoopRefV1 {
  return buildConductorLoopRef({
    kind: "objective-loop",
    refId: loopId,
    ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
    recordedAt: options.recordedAt
  });
}

/**
 * Strict shape guard: frozen format literal, closed kind union, non-empty ref
 * and instant, optional h2a workspace id. Unknown format/kind/fields refuse.
 */
export function isConductorLoopRef(value: unknown): value is ConductorLoopRefV1 {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const keys = new Set(Object.keys(v));
  const expected = keys.has("workspaceId")
    ? new Set(["format", "kind", "ref", "workspaceId", "recordedAt"])
    : new Set(["format", "kind", "ref", "recordedAt"]);
  if (keys.size !== expected.size || [...keys].some((key) => !expected.has(key))) return false;
  return (
    v.format === H2A_CONDUCTOR_LOOP_REF_FORMAT &&
    typeof v.kind === "string" &&
    KINDS.includes(v.kind as ConductorLoopRefKind) &&
    typeof v.ref === "string" &&
    v.ref.length > 0 &&
    typeof v.recordedAt === "string" &&
    v.recordedAt.length > 0 &&
    (v.workspaceId === undefined || (typeof v.workspaceId === "string" && v.workspaceId.length > 0))
  );
}
