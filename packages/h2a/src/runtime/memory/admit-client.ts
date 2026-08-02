/**
 * Admit client — WP11 slice 4 (build brief). Dispatches a `MemoryNoteInput`
 * through an INJECTED `MemoryProducerPort` and branches on the discriminated
 * `AdmissionOutcome`. This slice stubs/mocks the port in tests; it never wires to
 * real storage — the end-to-end integration awaits graphify's storage-laying
 * Vague B and is explicitly out of scope here.
 *
 * I5 — fail-closed: the port is OPTIONAL input (absent until graphify publishes
 * it for real). When it is absent, or its call throws/rejects (unreachable), the
 * default is a REFUSAL — never a silent success and never an uncaught throw a
 * caller might mistake for "nothing happened". Every branch below produces an
 * `AdmissionOutcome`; there is no path that returns `admitted: true` without a
 * port actually having said so.
 *
 * The local pre-flight (`./preflight.ts`) runs BEFORE the port is ever called,
 * so a malformed note is rejected locally and the port is never invoked for it —
 * covered by a test asserting the injected port's call count stays zero.
 */

import type { AdmissionOutcome, MemoryContext, MemoryNoteInput, MemoryProducerPort } from "./port-v1.js";
import { preflightMemoryNote } from "./preflight.js";

export interface AdmitMemoryNoteResult {
  readonly outcome: AdmissionOutcome;
  /** True when the note was refused locally (preflight or missing port) — the port was never called. */
  readonly localOnly: boolean;
}

function refuse(reason: string): AdmitMemoryNoteResult {
  return { outcome: { admitted: false, reason }, localOnly: true };
}

/**
 * Dispatch `note` through `port.admitMemoryNote(note, ctx)`. `port` is injected
 * and may be `undefined`/`null` (I5: fail-closed default, not a wiring error).
 */
export async function admitMemoryNote(
  note: MemoryNoteInput,
  ctx: MemoryContext,
  port: MemoryProducerPort | undefined | null
): Promise<AdmitMemoryNoteResult> {
  const shape = preflightMemoryNote(note);
  if (!shape.ok) {
    return refuse(`preflight rejected: ${shape.reason}`);
  }

  if (!port) {
    return refuse("no memory producer port injected — refusing (fail-closed, I5)");
  }

  try {
    const outcome = await port.admitMemoryNote(note, ctx);
    return { outcome, localOnly: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return refuse(`memory producer port unreachable: ${reason}`);
  }
}
