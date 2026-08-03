/**
 * D11 ceremony orchestrator — WP11 slice 5 (build brief). Anti-fabrication
 * FIXED in two rounds, each closing a hole an independent review NO-GO'd.
 * See "D11 FIX — ROUND 1" and "D11 FIX — ROUND 2" below for what changed, in
 * order, and why; the rest of this doc describes the ceremony's unchanged
 * shape.
 *
 * Composes the double-consensus END TO END: launch the two independent legs,
 * collect their INLINE verdicts, gate on slice 3's `checkDoubleConsensusPreconditions`
 * (the SAME structural check, not a reimplementation) as a cheap pre-write
 * reject, write the verdict + attestation artifacts, READ THEM BACK from a
 * REAL, construction-time-bound durable store and cryptographically verify
 * them (ROUND 1 + ROUND 2 together), and only then dispatch through
 * `promoteNoteWithDoubleConsensus` — now fed the READ, VERIFIED verdicts,
 * never the caller-controlled inline ones.
 *
 * SCOPE (bounded), same shape as the rest of `runtime/memory/`: the actual
 * model-leg launching and the verdict/attestation FILE WRITES are INJECTED
 * (`deps.launchLeg`, `deps.writeVerdict`, `deps.writeAttestation`,
 * `deps.port`) and stubbed in tests — never implemented for real here. This
 * module is the ORCHESTRATION only: what gets called, in what order, and
 * what refuses the ceremony before the next step ever runs. Real Ed25519
 * signature verification (`verifySignature`, the default), the concrete
 * `trustedKeystore` backing store, AND (ROUND 2) the default verdict-artifact
 * READER (`readVerdict`, a real path-bound filesystem reader) ARE
 * implemented for real — crypto, and "read back exactly what is actually
 * persisted", are not "out of scope, inject a stub" concerns the way
 * launching a model or writing a file are. The keystore's actual key
 * material/distribution and the durable store's actual deployment location
 * remain a WP5 concern (see ROUND 1 §1 and ROUND 2 below).
 *
 * ===========================================================================
 * D11 FIX — ROUND 1 — the anti-fabrication anchor (signature verification).
 * ===========================================================================
 *
 * THE HOLE (proven by an independent review): before this fix, `launchLeg`
 * returned verdicts INLINE (caller-controlled), `writeVerdict` returned ref
 * strings that were NEVER READ BACK, and the consensus gate checked only the
 * caller-supplied inline verdicts. A `writeVerdict` that returns invented ref
 * strings without ever creating a file still reached `promoteNote` with
 * `promoted: true` — a caller fabricating "2 GO" verdicts as plain JavaScript
 * objects could promote a note with no real evidence anywhere. This is the
 * classic fabricated-verdict hole: an assertion was trusted where a document
 * should have been demanded.
 *
 * THE FIX, in three parts:
 *
 * 1. `createD11Ceremony({ trustedKeystore, verifySignature? })` — a FACTORY
 *    that CLOSES OVER the trusted keystore (and, optionally, the signature
 *    verifier). It returns the actual `runD11Ceremony(input, deps)` function.
 *    This is the load-bearing design choice: `trustedKeystore` is a
 *    CONSTRUCTION-TIME input, never part of the per-call `RunD11CeremonyDeps`.
 *    At the time of THIS round, `readVerdict` and `launchLeg` were BOTH still
 *    per-call (caller-injected, untrusted); if signature verification used a
 *    per-call-supplied keystore too, a caller could simply hand the ceremony
 *    ITS OWN keystore (mapping its own throwaway key to whatever leg it
 *    likes) and sign its own fabrication — the hole would just move one layer
 *    down. The keystore must come from a trusted CONSTRUCTION site (a
 *    conductor/bootstrap that wires `createD11Ceremony` once, not a value an
 *    arbitrary per-call caller of the returned `runD11Ceremony` can swap).
 *    `trustedKeystore` is documented here as the LOCAL anchor for today
 *    (an in-process map/interface from leg identity to an Ed25519 public
 *    key); it is designed to be swapped later for the WP5 system-wide
 *    identity keystore WITHOUT a rewrite of this module — `D11TrustedKeystore`
 *    is a one-method lookup interface (`getPublicKey(leg)`) precisely so a
 *    different backing store (network-fetched, rotated, cross-repo) can
 *    implement it later; the ceremony's own logic never changes.
 *
 * 2. `readVerdict(ref) => Promise<VerdictArtifact | null>` — at THIS round, a
 *    per-call dep. It OPENS+READS the verdict artifact actually persisted at
 *    `ref` (or returns `null` if absent/unreadable — the exact shape of the
 *    proven counter-example: a `writeVerdict` that never created a file).
 *    Distinct from `MemoryVerdict` (slice 3's in-memory, caller-asserted
 *    shape): `VerdictArtifact` additionally carries a `signature` — proof the
 *    artifact was actually produced by whoever holds the claimed leg's
 *    private key, not merely narrated by whoever called this ceremony.
 *    ROUND 2 (below) moves this dep to construction-time too — read that
 *    section for why leaving it per-call was itself still a hole.
 *
 * 3. The gate (fail-closed at every step, `promoteNote` NEVER reached on any
 *    failure): after `launchLeg` → `writeVerdict` produce the two refs, for
 *    EACH ref —
 *      a. `readVerdict(ref)` → REFUSE if `null` (closes the proven
 *         counter-example structurally: an invented ref with no real file).
 *      b. Look up the trusted public key for the artifact's OWN CLAIMED
 *         `leg` (`trustedKeystore.getPublicKey(artifact.leg)`) — REFUSE if
 *         the keystore has no entry (unknown leg OR an empty keystore; a
 *         missing key is never treated as "skip verification", it is always
 *         a refusal — I5 fail-closed applies to the keystore lookup too).
 *         Verify the artifact's `signature` against THAT key over the exact
 *         payload `{noteId, verdict, leg, at}` — REFUSE if invalid. Because
 *         the key is looked up BY THE CLAIMED LEG, a verdict that declares
 *         leg A but was actually signed with leg B's key (even though B's
 *         key IS in the keystore) fails here: leg A's public key cannot
 *         verify a signature produced by leg B's private key.
 *      c. REFUSE unless the READ `verdict === "GO"`.
 *      d. REFUSE unless the READ `noteId` equals the note actually being
 *         promoted (`input.note.noteId`) — ANTI-REPLAY. The signed payload
 *         in (b) already binds `noteId` into what the signature covers, so a
 *         genuinely-signed verdict for note X cannot be replayed to promote
 *         note Y: either its `noteId` fails this pin (this check), or an
 *         attacker who edits the `noteId` field to match Y invalidates the
 *         signature (check (b) fires instead). Either way: REFUSE.
 *    Then, across the two READ artifacts (off the READ content only, never
 *    the inline verdicts or the legSpecs):
 *      e. REFUSE if the two artifacts' `leg`s are not structurally distinct.
 *      f. REFUSE if either artifact's `leg.session === authorId` (separation
 *         of powers, re-checked off what was actually read — a `readVerdict`
 *         that returns a different leg than the one that was launched is
 *         still caught here).
 *    Then, per artifact again:
 *      g. REFUSE unless the READ content is COHERENT with the INLINE verdict
 *         `launchLeg` returned for that same position (`noteId`, `verdict`,
 *         `leg` must all match) — a mismatch means what got signed/persisted
 *         disagrees with what the leg claimed inline, which is refused
 *         rather than silently preferring one over the other.
 *    Only if ALL of (a)-(g) pass for both legs: the FINAL verdicts and
 *    attestation fed to `promoteNoteWithDoubleConsensus` are built from the
 *    READ, VERIFIED artifacts (never the inline ones) — so even a bug in this
 *    module's own gate logic cannot cause a fabricated inline verdict to
 *    reach the port, because the inline verdicts are never what gets
 *    promoted. `promoteNoteWithDoubleConsensus` re-runs
 *    `checkDoubleConsensusPreconditions` on that verified data as an
 *    unconditional second layer (unchanged from slice 3) before ever
 *    touching the port.
 *
 * ===========================================================================
 * D11 FIX — ROUND 2 (this build) — `readVerdict` moves to construction time.
 * ===========================================================================
 *
 * THE HOLE ROUND 1 LEFT (proven by an independent review, a SECOND, separate
 * leg from the one that forced ROUND 1): ROUND 1 moved `trustedKeystore` and
 * `verifySignature` to construction-time, but left `readVerdict` as a
 * PER-CALL, caller-injected dep. An adversarial per-call caller can inject a
 * `readVerdict` that returns a NON-NULL, TRUSTED-SIGNED artifact that exists
 * ONLY in memory — a ref string pointing at NO durable file anywhere — and
 * the gate above (§3a) only refuses `null`; a fabricated-but-signed in-memory
 * object sails through every check in ROUND 1 §3. ROUND 1's signature
 * verification only actually defends anything IF the per-call caller lacks
 * the trusted legs' private keys — but nothing in this module, or in what it
 * composes, ESTABLISHES that. Key custody is a WP5 wiring concern that is not
 * yet specified; assuming the caller can't sign is exactly the kind of
 * unverified assumption D11 exists to eliminate. We do not rely on it here.
 * The deeper problem: a trust-critical READER that the untrusted per-call
 * caller can inject is an EMPTY ANCHOR — no matter how strong the
 * verification logic downstream of it is, the caller controls whether that
 * logic ever sees real data at all. This is the same injected-deps lesson
 * ROUND 1 only half-applied (it anchored the VERIFIER but not the READER).
 *
 * THE FIX:
 *
 * 1. `readVerdict` moves from `RunD11CeremonyDeps` (per-call) to
 *    `CreateD11CeremonyOptions` (construction-time) — EXACTLY like
 *    `trustedKeystore` and `verifySignature`, and for the identical reason:
 *    the per-call caller of the returned `runD11Ceremony(input, deps)` is the
 *    UNTRUSTED adversary this whole ceremony exists to defend against. A
 *    trust-critical dependency that adversary can inject or override is not
 *    a defense, it is a hook for the exact fabrication being defended
 *    against. `RunD11CeremonyDeps` no longer has a `readVerdict` field at
 *    all (a type-level guarantee, not merely a runtime check) — and even if
 *    a caller attaches an extra `readVerdict` property to the `deps` object
 *    at runtime anyway (JS does not enforce the TS shape), `runD11Ceremony`
 *    never reads `deps.readVerdict` — it always uses the reader CLOSED OVER
 *    at construction. Proven in tests: an attached-but-unused
 *    `deps.readVerdict` records zero calls.
 *
 * 2. The DEFAULT construction-time reader, `defaultReadVerdict`, is a REAL
 *    in-module durable-store reader with PATH-BINDING: `ref` IS a filesystem
 *    path, and the reader does a genuine `readFile` at exactly that path,
 *    then JSON-parses and shape-validates the result. It returns `null` on
 *    ANY failure — missing file, unreadable, malformed JSON, wrong shape —
 *    which is exactly ROUND 1's proven counter-example (an invented ref with
 *    no real file behind it) and stays refused for the identical reason.
 *    Because the reader always dereferences the REAL filesystem at the ref's
 *    own path, what it returns is BOUND to that ref — it is literally what
 *    is stored there — never a caller-fabricated in-memory object: there is
 *    no code path by which an in-memory `VerdictArtifact`, however validly
 *    signed, can reach `promoteNote` without first being real bytes on disk
 *    at the exact path the ceremony itself derived from `writeVerdict`'s
 *    return value. `readVerdict` remains overridable AT CONSTRUCTION for
 *    tests only — a test may supply a fake store-reader (e.g. an in-memory
 *    `Map<ref, VerdictArtifact>`) to `createD11Ceremony({ readVerdict: ... })`
 *    so tests don't need real disk I/O for every scenario — but that
 *    override is wired ONCE, at the same trusted construction site as
 *    `trustedKeystore`, never by the per-call caller under test.
 *
 * 3. Everything from ROUND 1 §3 is UNCHANGED: signature-by-claimed-leg,
 *    GO, anti-replay (noteId pin), cross-artifact distinctness, separation
 *    of powers off the READ content, and coherence with the inline verdict.
 *    ROUND 2 only changes WHERE `readVerdict` comes from and WHAT its
 *    default implementation actually does; it adds no new gate steps because
 *    none were missing — the missing piece was that the existing gate could
 *    be handed fabricated input before it ever ran.
 *
 * WHAT THIS DOES NOT CLAIM (residual, stated honestly): the CONSTRUCTION
 * SITE — whoever calls `createD11Ceremony({ trustedKeystore, readVerdict })`
 * — remains a trusted wiring point (WP5 domain, unchanged from ROUND 1 §1):
 * its choice of keystore, its choice of durable-store reader (or acceptance
 * of the real filesystem default), and the actual key material/store
 * deployment behind both are not re-verified by this module. That is ONE
 * trusted wiring point exercised once at bootstrap, not any of the
 * potentially many per-call callers of the returned `runD11Ceremony` — a
 * much smaller, much more auditable surface than ROUND 1 left. This module
 * defends against a per-call caller fabricating a plausible-looking verdict,
 * signed or not, durable or not; it does not defend against a compromised
 * private key for a leg genuinely registered in the trusted keystore, a
 * compromised/malicious construction site, or a durable store an attacker
 * can write to directly (bypassing `writeVerdict`) — those remain
 * key-management, wiring, and storage-access concerns, not gaps in this
 * gate.
 *
 * ===========================================================================
 * (Unchanged) FLOW summary and invariants.
 * ===========================================================================
 *
 * I5 — fail-closed at EVERY injected/lookup step: `deps` itself,
 * `deps.legSpecs`, `deps.launchLeg`, `deps.writeVerdict`, `deps.writeAttestation`,
 * `deps.port`, the CONSTRUCTION-TIME `readVerdict` (ROUND 2), and the
 * `trustedKeystore` lookup are all treated as untrusted or fallible — absent,
 * wrong shape, throwing, rejecting, or (for the keystore, and for
 * `readVerdict`'s return) simply "nothing there" all REFUSE with a structured
 * `{promoted:false, reason}`, never a silent success. A ceremony that fails
 * partway NEVER reaches `promoteNote` (slice 3's raw dispatch) — proven in
 * tests via counting stubs showing later steps are never invoked once an
 * earlier one refuses.
 *
 * I1 — durable identity slot: `note.noteId`, `note.principal_owner`,
 * `authorId`, and every `legSpec.{model,session}` / `leg.{model,session}` are
 * OPAQUE strings here — compared with `===` only (via slice 3's own
 * equality, or the local `sameLegSpec` mirror below), never parsed, split or
 * derived-from. The `trustedKeystore` is looked up BY the opaque `LegIdentity`
 * value, not by any string built from parsing it.
 * I4 — no new capabilities vocabulary: this module reuses `MemoryVerdict`,
 * `IndependenceAttestation`, `LegIdentity`, `checkDoubleConsensusPreconditions`
 * and `promoteNoteWithDoubleConsensus` UNCHANGED from `./promote-client.ts`;
 * `LegSpec` is a type alias of `LegIdentity`, not a second taxonomy, and
 * `D11CeremonyResult` reuses slice 3's own `PromoteNoteResult` shape — a
 * ceremony IS a (composed) promotion attempt, not a new outcome vocabulary.
 * `VerdictArtifact` is the one genuinely NEW shape this fix introduces — the
 * READ, signed record `MemoryVerdict` never was.
 */

import { createPublicKey, verify as verifyEd25519Signature } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalize } from "../../canonical.js";
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

/**
 * A verdict ARTIFACT — what `readVerdict` returns after actually opening and
 * reading the file persisted at a ref (D11 FIX ROUND 1, path-bound for real
 * by ROUND 2's default reader). Distinct from `MemoryVerdict`
 * (`./promote-client.ts`), which is the in-memory shape a `launchLeg` call
 * returns INLINE and is never, by itself, trusted for a promotion decision:
 * `VerdictArtifact` additionally carries `signature`, proof of authorship
 * the inline shape has no room for.
 */
export interface VerdictArtifact {
  readonly noteId: string;
  readonly verdict: "GO" | "NO-GO";
  readonly leg: LegIdentity;
  readonly at: number;
  /**
   * Base64 Ed25519 signature over the canonicalized payload
   * `{noteId, verdict, leg, at}` (exactly these four fields, nothing else) —
   * binds the verdict to BOTH the note it reviews (anti-replay) and the leg
   * that claims to have produced it (anti-impersonation).
   */
  readonly signature: string;
}

/**
 * The trusted keystore — an opaque `LegIdentity` -> Ed25519 public key (PEM)
 * lookup. D11 FIX ROUND 1 §1: NEVER supplied per-call (that would make it
 * caller-swappable, reopening the fabrication hole) — it is closed over at
 * `createD11Ceremony` construction time by a trusted wiring site. Today this
 * is the LOCAL anchor (an in-process map/interface); it is designed to be
 * swapped later for the WP5 system-wide identity keystore WITHOUT a rewrite
 * of this module — only a different `D11TrustedKeystore` implementation is
 * needed, same one-method shape.
 */
export interface D11TrustedKeystore {
  /**
   * The Ed25519 public key (PEM), trusted for this CLAIMED leg, or
   * `undefined`/`null` if the leg is not known to the keystore (including an
   * entirely empty keystore) — treated as fail-closed REFUSE by the
   * ceremony, never as "no key, skip verification".
   */
  getPublicKey(leg: LegIdentity): string | undefined | null;
}

/**
 * The signature-verification seam. Real Ed25519 (`defaultVerifySignature`,
 * below) in production; stubbable at `createD11Ceremony` construction time
 * for tests. Injected at CONSTRUCTION, like the keystore, and for the same
 * reason: per-call injection would let a caller supply a verifier that
 * always says yes.
 */
export type VerifySignatureFn = (payload: unknown, signature: string, publicKey: string) => boolean;

/**
 * D11 FIX ROUND 2: the verdict-artifact reader seam. Real, path-bound
 * filesystem I/O (`defaultReadVerdict`, below) in production; stubbable at
 * `createD11Ceremony` construction time for tests. Injected at CONSTRUCTION,
 * like the keystore and the verifier, and for the identical reason: per-call
 * injection is exactly what let a caller hand the ceremony a fabricated,
 * durability-free "read" in the hole this round closes.
 */
export type ReadVerdictFn = (ref: string) => Promise<VerdictArtifact | null>;

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
  // NOTE (D11 FIX ROUND 2): there is deliberately NO `readVerdict` field here.
  // It moved to `CreateD11CeremonyOptions` — construction-time only. A
  // per-call caller cannot supply or override it; see the ROUND 2 module doc
  // for why leaving it here was itself the hole an independent review proved.
}

/** Reuses slice 3's result shape unchanged — a ceremony IS a composed promotion attempt. */
export type D11CeremonyResult = PromoteNoteResult;

/** What `createD11Ceremony` closes over — construction-time only, never per-call. */
export interface CreateD11CeremonyOptions {
  /** The trust anchor for verdict signatures. See `D11TrustedKeystore` above. */
  readonly trustedKeystore: D11TrustedKeystore;
  /** Defaults to real Ed25519 (`defaultVerifySignature`). Override only for tests. */
  readonly verifySignature?: VerifySignatureFn | undefined;
  /**
   * D11 FIX ROUND 2: the verdict-artifact reader. Defaults to
   * `defaultReadVerdict`, a REAL path-bound filesystem reader (`ref` IS the
   * path it reads). Override ONLY for tests — e.g. a fake, construction-time
   * `Map`-backed store-reader — wired at the SAME trusted construction site
   * as `trustedKeystore`, never by a per-call caller of the returned
   * `runD11Ceremony`.
   */
  readonly readVerdict?: ReadVerdictFn | undefined;
}

export type RunD11Ceremony = (
  input: RunD11CeremonyInput,
  deps: RunD11CeremonyDeps | undefined | null
) => Promise<D11CeremonyResult>;

/** A fixed, descriptive orchestrator id — NOT a minted identity (I1); this module names the mechanism, not a person/session. */
const ORCHESTRATOR_ID = "h2a:d11-ceremony" as const;

/**
 * Placeholder refs for the PRE-write, PRE-read precondition gate (a cheap
 * early reject on the INLINE verdicts, before any write happens) — no real
 * ref exists yet at that point. Never appear in the evidence handed to the
 * port; discarded the moment the real refs come back from `writeVerdict`.
 */
const PENDING_LEG1_REF = "__d11_ceremony_pending_leg1_ref__" as const;
const PENDING_LEG2_REF = "__d11_ceremony_pending_leg2_ref__" as const;

function refuse(reason: string): D11CeremonyResult {
  return { outcome: { promoted: false, reason }, localOnly: true };
}

function sameLegSpec(a: LegIdentity, b: LegIdentity): boolean {
  return a.model === b.model && a.session === b.session;
}

function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function verdictSignedPayload(artifact: VerdictArtifact): unknown {
  return { noteId: artifact.noteId, verdict: artifact.verdict, leg: artifact.leg, at: artifact.at };
}

function toMemoryVerdict(artifact: VerdictArtifact): MemoryVerdict {
  return { noteId: artifact.noteId, verdict: artifact.verdict, leg: artifact.leg, at: artifact.at };
}

function coherentWithInline(artifact: VerdictArtifact, inline: MemoryVerdict): boolean {
  return (
    artifact.noteId === inline.noteId &&
    artifact.verdict === inline.verdict &&
    artifact.leg.model === inline.leg.model &&
    artifact.leg.session === inline.leg.session
  );
}

/**
 * The default, real signature verifier: Ed25519 over the canonicalized
 * payload, via `node:crypto` — the same primitive `./signature.ts` uses
 * elsewhere in h2a, applied here to a raw base64 signature string (this
 * seam's shape) rather than the `H2ASignature{by,alg,value}` envelope.
 */
export function defaultVerifySignature(payload: unknown, signature: string, publicKeyPem: string): boolean {
  let key;
  try {
    key = createPublicKey({ key: publicKeyPem, format: "pem" });
  } catch {
    return false;
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  try {
    const message = Buffer.from(canonicalize(payload), "utf8");
    return verifyEd25519Signature(null, message, key, raw);
  } catch {
    return false;
  }
}

/**
 * D11 FIX ROUND 2: shape-validate a value read back from the durable store
 * before trusting it as a `VerdictArtifact` at all — a malformed or
 * unrelated JSON blob at a path must never be handed to the signature check
 * as if it were a real artifact (it would simply fail signature
 * verification, but failing CLOSED here, before that, is cheaper and
 * clearer about why).
 */
function isVerdictArtifactShape(value: unknown): value is VerdictArtifact {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.noteId !== "string") return false;
  if (v.verdict !== "GO" && v.verdict !== "NO-GO") return false;
  if (typeof v.at !== "number") return false;
  if (typeof v.signature !== "string") return false;
  if (typeof v.leg !== "object" || v.leg === null) return false;
  const leg = v.leg as Record<string, unknown>;
  return typeof leg.model === "string" && typeof leg.session === "string";
}

/**
 * D11 FIX ROUND 2 — the default, REAL durable-store reader. `ref` IS a
 * filesystem path: this does a genuine `readFile` at exactly that path, then
 * JSON-parses and shape-validates the result. Returns `null` on ANY failure
 * — missing file (ENOENT), permission error, malformed JSON, or a
 * well-formed-but-wrong-shape value — never throws. What it returns, when it
 * returns non-null, is PATH-BOUND: literally the bytes actually persisted at
 * `ref`, never a value the caller constructed in memory. This is the
 * structural anchor: a `VerdictArtifact` with no durable backing at its own
 * ref cannot reach this function's non-null return, by construction.
 */
export async function defaultReadVerdict(ref: string): Promise<VerdictArtifact | null> {
  let raw: string;
  try {
    raw = await readFile(ref, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isVerdictArtifactShape(parsed) ? parsed : null;
}

/**
 * Factory: builds the actual `runD11Ceremony` function, CLOSED OVER
 * `trustedKeystore` (and, optionally, `verifySignature` and `readVerdict`).
 * This is the anti-fabrication anchor (D11 FIX ROUND 1 §1 + ROUND 2 §1):
 * signature verification always uses THIS keystore, and the verdict
 * read-back always uses THIS reader (real filesystem by default) — never
 * one a caller of the returned function can inject per-call. Throws
 * synchronously on a missing/malformed `trustedKeystore` — a
 * construction-site wiring bug should fail loudly and immediately, not
 * silently produce a ceremony that can never verify anything.
 */
export function createD11Ceremony(options: CreateD11CeremonyOptions): RunD11Ceremony {
  if (!options || typeof options.trustedKeystore?.getPublicKey !== "function") {
    throw new Error(
      "createD11Ceremony requires a trustedKeystore with getPublicKey(leg) — construction-time, not caller-swappable"
    );
  }
  const trustedKeystore = options.trustedKeystore;
  const verifySignature: VerifySignatureFn =
    typeof options.verifySignature === "function" ? options.verifySignature : defaultVerifySignature;
  const readVerdict: ReadVerdictFn =
    typeof options.readVerdict === "function" ? options.readVerdict : defaultReadVerdict;

  /**
   * Run the D11 ceremony end to end. See the module doc for the full flow.
   * Any refusal at any step returns a structured `{promoted:false, reason}`
   * with `localOnly: true`, and guarantees `promoteNote` (slice 3's raw
   * dispatch, the only thing that ever touches the injected port for a
   * promotion) is NEVER reached.
   */
  return async function runD11Ceremony(
    input: RunD11CeremonyInput,
    deps: RunD11CeremonyDeps | undefined | null
  ): Promise<D11CeremonyResult> {
    if (!deps) {
      return refuse("no ceremony dependencies injected — refusing (fail-closed, I5)");
    }

    // D11 FIX ROUND 2: `readVerdict` is intentionally NOT destructured from
    // `deps` here — it is not a field of `RunD11CeremonyDeps` at all. Even if
    // a caller attaches a `readVerdict` property to the object passed as
    // `deps` anyway (JS does not enforce the TS shape at runtime), it is
    // never read: the CLOSED-OVER `readVerdict` from `createD11Ceremony`
    // (above) is what's used below, unconditionally.
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

    // --- Cheap pre-write reject on the INLINE (caller-controlled) verdicts. ---
    // This is a courtesy that saves a write + read round trip on an obviously
    // bad ceremony; it is NOT the authority — the READ, signature-verified
    // gate below (D11 FIX §3) is what actually protects `promoteNote`.
    const precheckAttestation: IndependenceAttestation = {
      leg1: v1.leg,
      leg2: v2.leg,
      distinctModels: v1.leg.model !== v2.leg.model,
      distinctSessions: v1.leg.session !== v2.leg.session,
      verdictsWrittenBeforeCrossVisibility: true,
      orchestrator: ORCHESTRATOR_ID
    };
    const precheck = checkDoubleConsensusPreconditions({
      verdicts: [v1, v2],
      attestation: precheckAttestation,
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

    // =========================================================================
    // D11 FIX §3 — the READ, signature-verified gate. Everything from here on
    // is what actually protects `promoteNote`; nothing before this point does.
    // `readVerdict` here is ALWAYS the construction-time closure (ROUND 2) —
    // a real function is guaranteed (default or a construction-time override),
    // so there is no "readVerdict absent" branch left to guard: a missing
    // durable artifact now surfaces as `readVerdict(ref)` resolving to `null`
    // (checked immediately below), not as this dep being absent.
    // =========================================================================

    let artifact1: VerdictArtifact | null;
    let artifact2: VerdictArtifact | null;
    try {
      [artifact1, artifact2] = await Promise.all([readVerdict(leg1Ref), readVerdict(leg2Ref)]);
    } catch (err) {
      return refuse(`readVerdict failed: ${errorReason(err)}`);
    }
    if (!artifact1) {
      return refuse(
        "readVerdict found no artifact at leg1's ref — refusing (no file at the claimed ref; the fabrication hole this closes)"
      );
    }
    if (!artifact2) {
      return refuse(
        "readVerdict found no artifact at leg2's ref — refusing (no file at the claimed ref; the fabrication hole this closes)"
      );
    }

    // --- Per artifact: signature (against the CLAIMED leg's trusted key), GO, anti-replay. ---
    for (const [label, artifact] of [
      ["leg1", artifact1],
      ["leg2", artifact2]
    ] as const) {
      const publicKey = trustedKeystore.getPublicKey(artifact.leg);
      if (typeof publicKey !== "string" || publicKey.length === 0) {
        return refuse(
          `${label}: no trusted public key for the claimed leg — refusing (fail-closed; unknown leg or empty keystore)`
        );
      }
      let signatureOk: boolean;
      try {
        signatureOk = verifySignature(verdictSignedPayload(artifact), artifact.signature, publicKey);
      } catch (err) {
        return refuse(`${label}: signature verification threw — ${errorReason(err)}`);
      }
      if (!signatureOk) {
        return refuse(
          `${label}: signature invalid for the claimed leg — refusing (fabricated, tampered, or signed by the wrong key)`
        );
      }
      if (artifact.verdict !== "GO") {
        return refuse(`${label}: the read verdict is not GO — refusing`);
      }
      if (artifact.noteId !== input.note.noteId) {
        return refuse(
          `${label}: the read verdict's noteId does not match the note being promoted — refusing (anti-replay)`
        );
      }
    }

    // --- Across the two READ artifacts, off the READ content only. ---
    if (sameLegSpec(artifact1.leg, artifact2.leg)) {
      return refuse(
        "the two read verdict artifacts are not independent — the same leg was read twice — refusing"
      );
    }
    if (artifact1.leg.session === input.authorId || artifact2.leg.session === input.authorId) {
      return refuse(
        "a read verdict artifact's leg session equals the note's author — separation of powers requires an independent reviewer — refusing"
      );
    }

    // --- Per artifact again: coherence with the INLINE verdict launchLeg returned. ---
    if (!coherentWithInline(artifact1, v1)) {
      return refuse(
        "leg1: the read verdict artifact is not coherent with launchLeg's inline verdict — refusing"
      );
    }
    if (!coherentWithInline(artifact2, v2)) {
      return refuse(
        "leg2: the read verdict artifact is not coherent with launchLeg's inline verdict — refusing"
      );
    }

    // --- Build the FINAL verdicts + attestation from the READ, VERIFIED artifacts. ---
    // Never the inline v1/v2 from here on — a bug in the checks above cannot
    // cause a fabricated inline verdict to be what actually gets promoted.
    const verifiedVerdicts: readonly [MemoryVerdict, MemoryVerdict] = [
      toMemoryVerdict(artifact1),
      toMemoryVerdict(artifact2)
    ];
    const attestation: IndependenceAttestation = {
      leg1: artifact1.leg,
      leg2: artifact2.leg,
      distinctModels: artifact1.leg.model !== artifact2.leg.model,
      distinctSessions: artifact1.leg.session !== artifact2.leg.session,
      verdictsWrittenBeforeCrossVisibility: true,
      orchestrator: ORCHESTRATOR_ID
    };

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

    // `promoteNoteWithDoubleConsensus` re-runs `checkDoubleConsensusPreconditions`
    // on this VERIFIED data as an unconditional second layer (unchanged from
    // slice 3) before ever touching the port.
    return promoteNoteWithDoubleConsensus(
      {
        noteId: input.note.noteId,
        ctx,
        verdicts: verifiedVerdicts,
        attestation,
        attestationRef,
        leg1Ref,
        leg2Ref,
        authorId: input.authorId
      },
      port
    );
  };
}
