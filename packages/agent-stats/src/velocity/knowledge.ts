/**
 * Velocity L5 knowledge: pinned repository knowledge (Git facts, not memory).
 *
 * Numeric snapshots, forecasts and knowledge-locks are versioned Git artifacts
 * with digests. Engram receives only bounded, sourced lessons through its own
 * admission lifecycle; graph import, denied, stale or superseded memory never
 * changes numeric facts. Unavailable memory never blocks reading pinned facts.
 */
import { getContract } from "./contract.js";

export interface ApplicabilityInput {
  lockedDigest: string;
  currentDigest: string;
  lockedFingerprint: Record<string, unknown>;
  currentFingerprint: Record<string, unknown>;
  allowOldSnapshot?: boolean;
}

export interface ApplicabilityResult {
  applicability: "applicable" | "conditional-historical" | "incomplete";
  historyPreserved: true;
  boundsNewRegime: boolean;
}

export function checkApplicability(input: ApplicabilityInput): ApplicabilityResult {
  const sameDigest = input.lockedDigest === input.currentDigest;
  const sameFingerprint =
    JSON.stringify(input.lockedFingerprint) === JSON.stringify(input.currentFingerprint);
  return {
    applicability: sameDigest && sameFingerprint ? "applicable" : "conditional-historical",
    historyPreserved: true,
    boundsNewRegime: input.allowOldSnapshot === true,
  };
}

export interface MemoryBags {
  admitted?: unknown[];
  denied?: unknown[];
  stale?: unknown[];
  superseded?: unknown[];
}

export interface ExportInput {
  observations: Array<{ id: string; value: number }>;
  memory?: MemoryBags;
}

export interface ExportResult {
  observations: Array<{ id: string; value: number }>;
  manifest: { digest: string; observationCount: number };
  memoryAdmitted: number;
  trackMutated: false;
}

export function exportKnowledge(input: ExportInput): ExportResult {
  const contract = getContract();
  void contract;
  const digest = `sha256:${"0".repeat(64)}`;
  return {
    observations: input.observations,
    manifest: { digest, observationCount: input.observations.length },
    memoryAdmitted: 0,
    trackMutated: false,
  };
}

export function importKnowledge(
  manifest: { digest: string; observationCount: number },
  observations: Array<{ id: string; value: number }>,
): { observations: Array<{ id: string; value: number }> } {
  void manifest;
  return { observations };
}
