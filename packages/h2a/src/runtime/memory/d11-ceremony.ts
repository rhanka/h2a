/**
 * D11 ceremony orchestrator — WP11 slice 5 (this build, following slice 3's
 * `./promote-client.ts`). Composes the double-consensus END TO END: launch
 * the two independent legs, collect their verdicts, gate on slice 3's
 * `checkDoubleConsensusPreconditions` (the SAME structural check, not a
 * reimplementation), write the verdict + attestation artifacts, and only
 * then dispatch through `promoteNoteWithDoubleConsensus`.
 *
 * SCOPE (bounded), same shape as the rest of `runtime/memory/`: the actual
 * model-leg launching, the verdict/attestation FILE writes, and Ed25519
 * signing are ALL INJECTED (`deps.launchLeg`, `deps.writeVerdict`,
 * `deps.writeAttestation`, `deps.port`) and stubbed in tests — never
 * implemented for real here. This module is the ORCHESTRATION only: what
 * gets called, in what order, and what refuses the ceremony before the next
 * step ever runs.
 *
 * FLOW:
 *   1. Refuse BEFORE launching anything if the two `legSpecs` are not
 *      structurally distinct, or either's `session` equals the note's
 *      `authorId` (separation of powers).
 *   2. Launch both legs CONCURRENTLY (`Promise.all`) — neither leg's launch
 *      can see the other's verdict, which is what backs
 *      `verdictsWrittenBeforeCrossVisibility` in the attestation below.
 *   3. Build the `IndependenceAttestation` from what the legs ACTUALLY
 *      returned — `distinctModels`/`distinctSessions` are COMPUTED off
 *      `verdict.leg`, never asserted from the (already-checked) legSpecs. A
 *      `launchLeg` that ignores its `legSpec` and returns a colliding leg
 *      anyway is still caught here, off its real output.
 *   4. Gate on `checkDoubleConsensusPreconditions` (slice 3, unchanged) with
 *      the real verdicts + attestation and two PLACEHOLDER refs (no real ref
 *      exists yet — nothing has been written). The placeholders exist only
 *      to satisfy that function's "two distinct refs" shape check; they
 *      never appear in the evidence and are discarded on the very next line.
 *      A refusal here means `writeVerdict`/`writeAttestation`/`promoteNote`
 *      are NEVER called.
 *   5. Only once the gate passes: `writeVerdict` each verdict (get the two
 *      REAL refs), `writeAttestation` (get the REAL attestation ref), then
 *      call slice 3's `promoteNoteWithDoubleConsensus` with the three real
 *      refs — which re-runs the same gate (now with real refs) before ever
 *      touching the port, so a ceremony's own local check is never the sole
 *      line of defense.
 *
 * I5 — fail-closed at EVERY injected step: `deps` itself, `deps.legSpecs`,
 * `deps.launchLeg`, `deps.writeVerdict`, `deps.writeAttestation` and
 * `deps.port` are all treated as untrusted — absent, wrong shape, throwing
 * or rejecting all REFUSE with a structured `{promoted:false, reason}`,
 * never a silent success. A ceremony that fails partway NEVER reaches
 * `promoteNote` (slice 3's raw dispatch) — proven in tests via counting
 * stubs showing later steps are never invoked once an earlier one refuses.
 *
 * I1 — durable identity slot: `note.noteId`, `note.principal_owner`,
 * `authorId`, and every `legSpec.{model,session}` are OPAQUE strings here —
 * compared with `===` only (via slice 3's own equality, or the local
 * `sameLegSpec` mirror below), never parsed, split or derived-from.
 * I4 — no new capabilities vocabulary: this module reuses `MemoryVerdict`,
 * `IndependenceAttestation`, `LegIdentity`,
 * `checkDoubleConsensusPreconditions` and `promoteNoteWithDoubleConsensus`
 * UNCHANGED from `./promote-client.ts`; `LegSpec` is a type alias of
 * `LegIdentity`, not a second taxonomy, and `D11CeremonyResult` reuses slice
 * 3's own `PromoteNoteResult` shape — a ceremony IS a (composed) promotion
 * attempt, not a new outcome vocabulary.
 */

import type { MemoryContext, MemoryProducerPort } from "./port-v1.js";
import {
  checkDoubleConsensusPreconditions,
  promoteNoteWithDoubleConsensus,
  type IndependenceAttestation,
  type LegIdentity,
  type MemoryVerdict,
  type PromoteNoteResult
} from "./promote-client.js";

/** A leg's launch spec — the same opaque `{model, session}` shape as `LegIdentity`. */
export type LegSpec = LegIdentity;

/**
 * The note the ceremony reviews. Deliberately narrow (I1: `noteId` and
 * `principal_owner` are opaque, carried, never derived); open beyond that
 * for whatever else a caller's note representation happens to carry.
 */
export interface D11CeremonyNote {
  readonly noteId: string;
  readonly principal_owner: string;
  readonly [key: string]: unknown;
}

export interface RunD11CeremonyInput {
  readonly note: D11CeremonyNote;
  /** The note's author (opaque id) — separation of powers: no leg may equal this. */
  readonly authorId: string;
}

export interface RunD11CeremonyDeps {
  /** Launch one leg's review. INJECTED — real model-launching is out of scope here. */
  readonly launchLeg?: ((note: D11CeremonyNote, legSpec: LegSpec) => Promise<MemoryVerdict>) | undefined | null;
  /** Persist one verdict, return its REF (locator). INJECTED — real file I/O is out of scope here. */
  readonly writeVerdict?: ((verdict: MemoryVerdict) => Promise<string>) | undefined | null;
  /** Persist the attestation, return its REF. INJECTED — real file I/O + signing are out of scope here. */
  readonly writeAttestation?: ((attestation: IndependenceAttestation) => Promise<string>) | undefined | null;
  /** The two legs to launch. Must be structurally distinct (checked BEFORE launch). */
  readonly legSpecs?: readonly [LegSpec, LegSpec] | undefined | null;
  readonly port?: MemoryProducerPort | undefined | null;
  readonly ctx: MemoryContext;
}

/** Reuses slice 3's result shape unchanged — a ceremony IS a composed promotion attempt. */
export type D11CeremonyResult = PromoteNoteResult;

/** A fixed, descriptive orchestrator id — NOT a minted identity (I1); this module names the mechanism, not a person/session. */
const ORCHESTRATOR_ID = "h2a:d11-ceremony" as const;

/**
 * Placeholder refs for the PRE-write precondition gate (step 4 above) — no
 * real ref exists yet at that point. Never appear in the evidence handed to
 * the port; discarded the moment the real refs come back from `writeVerdict`.
 */
const PENDING_LEG1_REF = "__d11_ceremony_pending_leg1_ref__" as const;
const PENDING_LEG2_REF = "__d11_ceremony_pending_leg2_ref__" as const;

function refuse(reason: string): D11CeremonyResult {
  return { outcome: { promoted: false, reason }, localOnly: true };
}

function sameLegSpec(a: LegSpec, b: LegSpec): boolean {
  return a.model === b.model && a.session === b.session;
}

function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run the D11 ceremony end to end. See the module doc for the flow. Any
 * refusal at any step returns a structured `{promoted:false, reason}` with
 * `localOnly: true`, and guarantees `promoteNote` (slice 3's raw dispatch,
 * the only thing that ever touches the injected port for a promotion) is
 * NEVER reached.
 */
export async function runD11Ceremony(
  input: RunD11CeremonyInput,
  deps: RunD11CeremonyDeps | undefined | null
): Promise<D11CeremonyResult> {
  if (!deps) {
    return refuse("no ceremony dependencies injected — refusing (fail-closed, I5)");
  }

  const { launchLeg, writeVerdict, writeAttestation, legSpecs, port, ctx } = deps;

  if (!Array.isArray(legSpecs) || legSpecs.length !== 2) {
    return refuse("exactly 2 legSpecs are required to run a double-consensus ceremony");
  }
  const [legSpec1, legSpec2] = legSpecs;

  // --- Separation of powers, BEFORE anything is launched. ---
  if (sameLegSpec(legSpec1, legSpec2)) {
    return refuse(
      "the two legSpecs are not structurally distinct (same model+session) — refusing before launch"
    );
  }
  if (legSpec1.session === input.authorId || legSpec2.session === input.authorId) {
    return refuse(
      "a legSpec's session equals the note's author — separation of powers requires launching only independent reviewers"
    );
  }

  if (typeof launchLeg !== "function") {
    return refuse("no launchLeg injected — refusing (fail-closed, I5)");
  }

  // --- Launch both legs CONCURRENTLY: neither sees the other's verdict. ---
  let v1: MemoryVerdict;
  let v2: MemoryVerdict;
  try {
    [v1, v2] = await Promise.all([launchLeg(input.note, legSpec1), launchLeg(input.note, legSpec2)]);
  } catch (err) {
    return refuse(`launchLeg failed: ${errorReason(err)}`);
  }

  // --- Build the attestation from what the legs ACTUALLY returned (not asserted blindly). ---
  const attestation: IndependenceAttestation = {
    leg1: v1.leg,
    leg2: v2.leg,
    distinctModels: v1.leg.model !== v2.leg.model,
    distinctSessions: v1.leg.session !== v2.leg.session,
    verdictsWrittenBeforeCrossVisibility: true,
    orchestrator: ORCHESTRATOR_ID
  };

  // --- Gate on slice 3's own precondition check, BEFORE writing anything. ---
  const precheck = checkDoubleConsensusPreconditions({
    verdicts: [v1, v2],
    attestation,
    leg1Ref: PENDING_LEG1_REF,
    leg2Ref: PENDING_LEG2_REF,
    authorId: input.authorId
  });
  if (!precheck.ok) {
    return refuse(`double-consensus preconditions not met: ${precheck.reason}`);
  }

  if (typeof writeVerdict !== "function") {
    return refuse("no writeVerdict injected — refusing (fail-closed, I5)");
  }
  let leg1Ref: string;
  let leg2Ref: string;
  try {
    leg1Ref = await writeVerdict(v1);
    leg2Ref = await writeVerdict(v2);
  } catch (err) {
    return refuse(`writeVerdict failed: ${errorReason(err)}`);
  }

  if (typeof writeAttestation !== "function") {
    return refuse("no writeAttestation injected — refusing (fail-closed, I5)");
  }
  let attestationRef: string;
  try {
    attestationRef = await writeAttestation(attestation);
  } catch (err) {
    return refuse(`writeAttestation failed: ${errorReason(err)}`);
  }

  if (!port) {
    return refuse("no memory producer port injected — refusing (fail-closed, I5)");
  }

  return promoteNoteWithDoubleConsensus(
    {
      noteId: input.note.noteId,
      ctx,
      verdicts: [v1, v2],
      attestation,
      attestationRef,
      leg1Ref,
      leg2Ref,
      authorId: input.authorId
    },
    port
  );
}
