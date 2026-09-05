/**
 * Local pre-flight — WP11 slice 3 (build brief). Runs the VENDORED
 * `validateMemoryNoteShape` (see `./port-v1.ts`) BEFORE a note is dispatched, so
 * a malformed note never reaches the wire. This module does not reimplement the
 * check: it calls the shared predicate the port publishes, so h2a's local reject
 * stays byte-for-byte the same rule the graphify gate re-checks on admission
 * (minus `verifyVerbatim`, the citation check, which needs source resolution and
 * therefore stays gate-side — see the port's own doc comment).
 */

import { validateMemoryNoteShape, type MemoryNoteInput, type ShapeCheck } from "./port-v1.js";

export type PreflightResult = ShapeCheck;

/**
 * Cheap, local, structural rejection of a malformed note. NOT the admission
 * decision — the gate remains authoritative and re-checks on receipt.
 */
export function preflightMemoryNote(note: MemoryNoteInput): PreflightResult {
  return validateMemoryNoteShape(note);
}
