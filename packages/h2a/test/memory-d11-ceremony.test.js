// WP11 · Memory & context — D11 ceremony orchestrator, D11 FIX ROUND 1 + ROUND 2
// (anti-fabrication, two independent NO-GOs).
//
// ROUND 1: an independent review NO-GO'd the original build — `launchLeg` returned
// verdicts INLINE (caller-controlled), `writeVerdict`'s ref was never read back, and
// the consensus gate checked only the caller-supplied inline verdicts. A `writeVerdict`
// that invents a ref string without ever creating a file still reached `promoteNote`
// with `promoted: true`. THE ROUND-1 FIX: `createD11Ceremony({ trustedKeystore })`
// closes over a keystore a per-call caller cannot swap; a (then per-call) `readVerdict(ref)`
// OPENS+READS the actual persisted artifact; its `signature` is verified against the
// trusted key for its OWN CLAIMED leg, its `verdict` must read `"GO"`, its `noteId` must
// pin to the note actually being promoted (anti-replay), the two read legs must be
// structurally distinct and neither may equal the author, and the read content must
// cohere with launchLeg's inline verdict.
//
// ROUND 2 (this file): a SECOND, independent review NO-GO'd round 1 — `readVerdict`
// was still PER-CALL. A per-call caller can inject a `readVerdict` that returns a
// NON-NULL, TRUSTED-SIGNED artifact that exists ONLY in memory (a ref pointing at no
// durable file anywhere); round 1's gate only refuses `null`, so a fabricated-but-signed
// in-memory object sailed through. Round 1's signature check only defends anything IF the
// caller lacks the trusted legs' private keys — an UNESTABLISHED assumption (WP5 key
// custody is not wired up). THE ROUND-2 FIX: `readVerdict` moves to
// `CreateD11CeremonyOptions` — construction-time, EXACTLY like `trustedKeystore` and
// `verifySignature`. `RunD11CeremonyDeps` no longer has a `readVerdict` field at all; even
// if a per-call caller attaches one to the `deps` object anyway, `runD11Ceremony` never
// reads it. The DEFAULT construction-time reader, `defaultReadVerdict`, is a REAL,
// path-bound filesystem reader — `ref` IS the path it reads — so what it returns, when
// non-null, is bound to be literally what is on disk at that ref, never a caller-fabricated
// in-memory object. Overridable at CONSTRUCTION only, for tests.
//
// This file proves: round 1's original counter-example + all three named adversarial
// attacks (wrong-key impersonation, cross-note replay, empty/leg-unknown keystore) are
// STILL refused; round 2's terra attack (a per-call-injected `readVerdict` returning a
// trusted-signed in-memory artifact) is now REFUSED, with the injected function proven
// to be DEAD CODE (zero calls); and the REAL default `readVerdict` — genuine filesystem
// I/O, not a stand-in — both accepts a genuinely-persisted artifact and refuses a missing
// or malformed one. `promoteNote` is NEVER reached on any refusal, in either round's tests.
//
// ROUND 3 (this file, new section near the end): a THIRD, independent review NO-GO'd
// round 2 — `readVerdict` moved to construction time, but the DEFAULT reader still did a
// plain `readFile(ref)` on `writeVerdict`'s PER-CALL, caller-controlled return value; the
// untrusted caller still chose WHERE the trusted reader looked. Three attacks reached
// `promoteNote` with `promoted:true` at ROUND 2 (@824b633e): TRAVERSAL (a `../` ref to a
// genuinely-signed artifact outside the zone), SYMLINK (the confined ref exists but is a
// symlink to an attacker file), and TOCTOU (the file is swapped between write and read).
// THE ROUND-3 FIX, reusing the path-confinement technique proven and merged in
// `packages/h2a-runtime/src/identity-cull/cull.ts` (PR #160): `createD11Ceremony({
// authorizedRoot })` (required for the real default reader); the ceremony derives the
// ONE location each leg's verdict may be read from and refuses any `writeVerdict` ref
// that doesn't resolve to EXACTLY that path (closes TRAVERSAL); `defaultReadVerdict`
// opens it via a descriptor-relative, `O_NOFOLLOW` walk that refuses a symlink at ANY
// component (closes SYMLINK); and reads from the SAME held descriptor it just
// `fstat`'d — never a second, pathname-based open (closes TOCTOU).
//
// ROUND 3 §B (this file, section near the end): `authorId` was a bare, per-call,
// caller-supplied string nothing verified — a caller could lie about it even when the
// TRUE author was genuinely one of the two legs. Graphify verified (@67bf73c7) MemoryNote
// carries no trusted author field, so THE FIX closes this INSIDE the ceremony instead:
// the note now carries an `AuthorSignature` in its open extension slot
// (`note["h2a.author_signature"]`), re-verified against the SAME construction-time
// `trustedKeystore` + `verifySignature` verdict signatures already use (no second trust
// root); every separation-of-powers check compares against that VERIFIED signer's
// identity, never `input.authorId`. What was a SKIPPED, documented KNOWN-OPEN bypass is
// now a closed, asserted refusal.
//
// ROUND 4 (this file, new section near the end): a FOURTH, independent review NO-GO'd
// round 3 with TWO real blockers, neither exercised by any test above. BLOCKER 1 —
// SAME-NOTE REPLAY: the signed payload `{noteId, verdict, leg, at}` has no freshness, no
// nonce, no one-shot consumption — an attacker holding NO private key can replay the
// already-signed BYTES of two OLD, genuinely-produced GO verdicts for the SAME noteId
// (from a prior, real ceremony) into a FRESH ceremony and mint a fresh promotion.
// BLOCKER 2 — CRYPTO AUTHOR/REVIEWER ALIAS: separation of powers compared
// `leg.session`/`authorId` STRINGS only, never the verified PUBLIC KEY — if the trusted
// keystore mapped ONE key to TWO (or three) distinct `{model, session}` identities, the
// SAME crypto principal could author AND review (or "independently" review twice) with
// no forged signature anywhere. THE FIX: (1) a fresh, gate-generated, unpredictable
// `ceremonyNonce` per run, threaded to `launchLeg` and bound into the signed payload —
// the gate REQUIRES a read artifact's nonce match THIS run's own value AND rebuilds the
// verification payload from that same gate-owned value, never the artifact's
// self-reported one; (2) `canonicalKeyFingerprint` (SPKI DER + SHA-256) replaces
// session-string comparison as the AUTHORITATIVE separation-of-powers check — three
// pairwise-distinct crypto principals (author, reviewer1, reviewer2) required, checked
// both PRE-LAUNCH and POST-READ, fail-closed on any missing/unparseable key. Three
// attacks reached `promoteNote` with `promoted:true` at ROUND 3 (@64e3f8a4): the
// same-note replay, an author/reviewer key alias, and a reviewer/reviewer key alias
// (the third, a variant not exercised by the independent review itself, added here as
// the same fake-independence class extended one step further).

import { strict as assert } from "node:assert";
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import { canonicalize } from "../dist/index.js";
import {
  createD11Ceremony,
  defaultReadVerdict,
  defaultVerifySignature,
  deriveVerdictRef
} from "../dist/runtime/memory/d11-ceremony.js";

// ---------------------------------------------------------------------------
// Fixtures & helpers.
// ---------------------------------------------------------------------------

function leg(model, session) {
  return { model, session };
}

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function signPayload(privateKeyPem, payload) {
  const key = createPrivateKey({ key: privateKeyPem, format: "pem" });
  const message = Buffer.from(canonicalize(payload), "utf8");
  return cryptoSign(null, message, key).toString("base64");
}

/**
 * Builds a genuinely, correctly signed VerdictArtifact for the given content.
 * D11 FIX ROUND 4 FIX 1: `ceremonyNonce` is now part of both the artifact and
 * the signed payload — whatever nonce the caller's `verdict` object carries
 * (normally threaded end to end from a live ceremony's `launchLeg` call, see
 * `happyDeps`) flows straight through into what's actually signed.
 */
function signedArtifact(privateKeyPem, { noteId, verdict, leg: legIdentity, at, ceremonyNonce }) {
  const payload = { noteId, verdict, leg: legIdentity, at, ceremonyNonce };
  return { noteId, verdict, leg: legIdentity, at, ceremonyNonce, signature: signPayload(privateKeyPem, payload) };
}

function keystoreFrom(pairs) {
  return {
    getPublicKey(candidateLeg) {
      const hit = pairs.find(([l]) => l.model === candidateLeg.model && l.session === candidateLeg.session);
      return hit ? hit[1] : undefined;
    }
  };
}

function keyRegistryFrom(pairs) {
  return {
    keyFor(candidateLeg) {
      const hit = pairs.find(([l]) => l.model === candidateLeg.model && l.session === candidateLeg.session);
      return hit ? hit[1] : undefined;
    }
  };
}

/** Counts calls; the impl may be async or throw synchronously — both are caught by the caller. */
function countingFn(impl) {
  let calls = 0;
  const args = [];
  const fn = async (...a) => {
    calls += 1;
    args.push(a);
    return impl(...a);
  };
  fn.calls = () => calls;
  fn.args = () => args;
  return fn;
}

function refCounter(prefix) {
  let n = 0;
  return countingFn(() => {
    n += 1;
    return `${prefix}:${n}`;
  });
}

/** Builds a genuinely, correctly signed AuthorSignature (D11 FIX ROUND 3 §B). */
function authorSignature(privateKeyPem, { noteId, authorLeg }) {
  const payload = { authorLeg, noteId };
  return { authorLeg, noteId, signature: signPayload(privateKeyPem, payload) };
}

/** Attaches a valid `h2a.author_signature` extension to a note-shaped object. */
function withAuthorSignature(note, privateKeyPem, authorLeg) {
  return { ...note, "h2a.author_signature": authorSignature(privateKeyPem, { noteId: note.noteId, authorLeg }) };
}

const AUTHOR_ID = "claude:h2a-memory:author-not-a-leg";
const LEG_SPEC_1 = leg("gpt-5.6-terra-xhigh", "session-A");
const LEG_SPEC_2 = leg("opus-5-xhigh", "session-B");
// D11 FIX ROUND 3 §B: the note's claimed author, as a LegIdentity — verified
// against the SAME trustedKeystore a leg's key is (no second trust root).
// `.session === AUTHOR_ID` deliberately, so every EXISTING "a leg collides
// with the author" test (a plain string comparison against AUTHOR_ID) keeps
// its exact meaning once the author identity is signature-verified instead
// of caller-asserted.
const AUTHOR_LEG = leg("h2a-memory-orchestrator", AUTHOR_ID);
const KEY_AUTHOR_SIG = keypair();

const NOTE = withAuthorSignature(
  { noteId: "note-1", principal_owner: "claude:h2a-memory:owner-1" },
  KEY_AUTHOR_SIG.privateKeyPem,
  AUTHOR_LEG
);
const CTX = { principal_owner: NOTE.principal_owner };

// D11 FIX ROUND 4 FIX 1: a fixture nonce for tests that build/verify a
// VerdictArtifact WITHOUT running a live ceremony (e.g. `defaultReadVerdict`
// exercised directly, or an artifact PLANTED outside a ceremony's confined
// zone for a ROUND 3 attack test where the confinement/symlink gate refuses
// before freshness is ever checked). A LIVE ceremony run always overrides
// this with its own freshly-generated nonce — see `happyDeps`'s `launchLeg`.
const FIXTURE_CEREMONY_NONCE = "fixture-ceremony-nonce-not-a-live-run";

function goVerdictFor(legSpec, ceremonyNonce = FIXTURE_CEREMONY_NONCE) {
  return { noteId: NOTE.noteId, verdict: "GO", leg: legSpec, at: 1000, ceremonyNonce };
}

// Keys registered in the TRUSTED keystore the ceremony verifies against.
const KEY_1 = keypair();
const KEY_2 = keypair();
// A leg the keystore ALSO trusts, but which happens to collide with the author id —
// used to build a "read leg == author" artifact that is otherwise honestly signed.
const LEG_SPEC_AUTHOR_IMPERSONATION = leg("rogue-model", AUTHOR_ID);
const KEY_AUTHOR = keypair();
// A leg the keystore ALSO trusts, unrelated to legs 1/2 — used for the "read content is
// honestly signed and structurally fine, but incoherent with the inline verdict" case.
const LEG_SPEC_SWAP = leg("swap-model", "swap-session");
const KEY_SWAP = keypair();
// A leg that CAN sign (has a real keypair) but is deliberately NOT registered in the
// trusted keystore — "leg unknown to keystore".
const LEG_SPEC_UNREGISTERED = leg("shadow-model", "shadow-session");
const KEY_UNREGISTERED = keypair();

const TRUSTED_KEYSTORE = keystoreFrom([
  [LEG_SPEC_1, KEY_1.publicKeyPem],
  [LEG_SPEC_2, KEY_2.publicKeyPem],
  [LEG_SPEC_AUTHOR_IMPERSONATION, KEY_AUTHOR.publicKeyPem],
  [LEG_SPEC_SWAP, KEY_SWAP.publicKeyPem],
  [AUTHOR_LEG, KEY_AUTHOR_SIG.publicKeyPem] // D11 FIX ROUND 3 §B — the note's author signature verifies against THIS entry
]);
const EMPTY_KEYSTORE = keystoreFrom([]);
const ALL_SIGNABLE_KEYS = keyRegistryFrom([
  [LEG_SPEC_1, KEY_1],
  [LEG_SPEC_2, KEY_2],
  [LEG_SPEC_AUTHOR_IMPERSONATION, KEY_AUTHOR],
  [LEG_SPEC_SWAP, KEY_SWAP],
  [LEG_SPEC_UNREGISTERED, KEY_UNREGISTERED],
  [AUTHOR_LEG, KEY_AUTHOR_SIG]
]);

/**
 * A ceremony instance whose construction-time `readVerdict` must NEVER be
 * invoked in the scenario under test — used for refusal paths that fail
 * before ANY read happens (pre-launch separation of powers, launchLeg/
 * writeVerdict absent-or-throwing, the INLINE precheck). Throws loudly if
 * called, so a regression that starts reading earlier than expected fails
 * the test immediately rather than silently passing.
 */
function ceremonyThatMustNotRead(trustedKeystore = TRUSTED_KEYSTORE) {
  const readVerdict = countingFn(async () => {
    throw new Error("readVerdict must not be called in this scenario");
  });
  return { ceremony: createD11Ceremony({ trustedKeystore, readVerdict }), readVerdict };
}

/**
 * A matched pair, mirroring an HONEST production wiring under ROUND 2:
 * `writeVerdict` (still per-call, still untrusted) signs with the leg's OWN
 * registered key and persists a real artifact into `files`; the
 * CONSTRUCTION-TIME `readVerdict` reads it back from the SAME `files`. The
 * two must be threaded together explicitly — `writeVerdict` into `deps`,
 * `readVerdict` into `createD11Ceremony(...)` — because round 2 removed the
 * per-call path that used to make this implicit.
 */
function honestVerdictIo() {
  const files = new Map();
  let n = 0;
  const writeVerdict = countingFn(async (verdict) => {
    n += 1;
    const ref = `verdict-ref:${n}`;
    const key = ALL_SIGNABLE_KEYS.keyFor(verdict.leg);
    if (key) {
      files.set(ref, signedArtifact(key.privateKeyPem, verdict));
    }
    return ref;
  });
  const readVerdict = countingFn(async (ref) => files.get(ref) ?? null);
  return { writeVerdict, readVerdict, files };
}

/** Wraps the REAL `defaultReadVerdict` with a call counter, so a test can prove the
 * genuine filesystem reader was actually invoked N times without giving up realness.
 * `authorizedRoot` is REQUIRED (D11 FIX ROUND 3 — the real reader is confined). */
function countingDefaultReadVerdict(authorizedRoot) {
  return countingFn((ref) => defaultReadVerdict(ref, authorizedRoot));
}

/**
 * D11 FIX ROUND 3 — writes a genuinely signed verdict artifact at the ONE
 * location `deriveVerdictRef` says it belongs (creating the note's
 * subdirectory first). Mirrors how an HONEST production `writeVerdict` must
 * behave under ROUND 3: the ref it returns is not a free choice — it must
 * land exactly where the ceremony will independently derive.
 */
async function writeConfinedArtifact(authorizedRoot, privateKeyPem, verdict) {
  const ref = deriveVerdictRef(authorizedRoot, verdict.noteId, verdict.leg);
  await mkdir(dirname(ref), { recursive: true });
  await writeFile(ref, JSON.stringify(signedArtifact(privateKeyPem, verdict)), "utf8");
  return ref;
}

/**
 * A `writeVerdict` stub that returns the CORRECT ceremony-derived ref for
 * whatever it's asked to write, but never actually writes a file — the
 * ROUND 1/2 proven counter-example shape (a ref pointing at NO durable
 * file), now expressed as a CONFINED, correctly-shaped ref so a test
 * exercises the "no artifact" gate specifically, not the ROUND 3
 * confinement gate (which a bare unrelated string would trip instead).
 */
function confinedNoWriteRef(authorizedRoot) {
  return countingFn(async (verdict) => deriveVerdictRef(authorizedRoot, verdict.noteId, verdict.leg));
}

function honestPort() {
  return {
    async admitMemoryNote() {
      throw new Error("not used in this slice");
    },
    promoteNote: countingFn(async (noteId, evidence, ctx) => ({ promoted: true, id: NOTE.noteId })),
    async requestTombstone() {
      throw new Error("not used in this slice");
    }
  };
}

function happyDeps(overrides = {}) {
  // D11 FIX ROUND 4 FIX 1: threads THIS ceremony run's real, freshly
  // generated `ceremonyNonce` (3rd arg, from `runD11Ceremony` itself) into
  // the returned LegVerdict — the honest-leg shape every legitimate fixture
  // must produce for the freshness gate to ever pass.
  const launchLeg = countingFn(async (note, legSpec, ceremonyNonce) => goVerdictFor(legSpec, ceremonyNonce));
  const writeVerdict = refCounter("unmatched-write-ref"); // deliberately not wired to any store; override when the test reaches the read gate
  const writeAttestation = refCounter("attestation-ref");
  const port = honestPort();
  return {
    launchLeg,
    writeVerdict,
    writeAttestation,
    legSpecs: [LEG_SPEC_1, LEG_SPEC_2],
    port,
    ctx: CTX,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// createD11Ceremony — construction-time validation & the injection seam.
// ---------------------------------------------------------------------------

test("createD11Ceremony throws synchronously when constructed without a trustedKeystore", () => {
  assert.throws(() => createD11Ceremony(undefined), /trustedKeystore/i);
  assert.throws(() => createD11Ceremony({}), /trustedKeystore/i);
  assert.throws(() => createD11Ceremony({ trustedKeystore: {} }), /trustedKeystore/i);
});

test("D11 FIX ROUND 3: createD11Ceremony throws synchronously when the real default reader would be used but no authorizedRoot is supplied", () => {
  assert.throws(() => createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE }), /authorizedRoot/i);
  assert.throws(() => createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict: null }), /authorizedRoot/i);
  assert.throws(() => createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict: undefined }), /authorizedRoot/i);
});

test("D11 FIX ROUND 3: createD11Ceremony does NOT require authorizedRoot when a custom readVerdict override is supplied", () => {
  const { readVerdict } = honestVerdictIo();
  assert.doesNotThrow(() => createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict }));
});

test("createD11Ceremony honors a custom injected verifySignature (construction-time seam, not per-call)", async () => {
  let calls = 0;
  const alwaysReject = () => {
    calls += 1;
    return false;
  };
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const stubbed = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, verifySignature: alwaysReject, readVerdict });
  const deps = happyDeps({ writeVerdict });
  const result = await stubbed({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.ok(calls > 0, "the injected verifySignature was actually invoked");
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("createD11Ceremony: a non-function readVerdict override falls back to the REAL default reader (parity with verifySignature's fallback)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "d11-ceremony-fallback-"));
  try {
    const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict: null, authorizedRoot: dir });
    // correctly confined refs (D11 FIX ROUND 3) — mints refs, writes nothing real
    const deps = happyDeps({ writeVerdict: confinedNoWriteRef(dir) });
    const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
    assert.equal(result.outcome.promoted, false);
    assert.match(result.outcome.reason, /no artifact/i);
    assert.equal(deps.port.promoteNote.calls(), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("defaultVerifySignature: a genuine signature over the exact payload verifies true", () => {
  const payload = { noteId: NOTE.noteId, verdict: "GO", leg: LEG_SPEC_1, at: 1000 };
  const signature = signPayload(KEY_1.privateKeyPem, payload);
  assert.equal(defaultVerifySignature(payload, signature, KEY_1.publicKeyPem), true);
});

test("defaultVerifySignature: a tampered payload (different at) fails verification", () => {
  const payload = { noteId: NOTE.noteId, verdict: "GO", leg: LEG_SPEC_1, at: 1000 };
  const signature = signPayload(KEY_1.privateKeyPem, payload);
  assert.equal(defaultVerifySignature({ ...payload, at: 2000 }, signature, KEY_1.publicKeyPem), false);
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 2 — `defaultReadVerdict` itself: REAL filesystem I/O, not a
// stand-in. Proves the "in-module durable-store reader with PATH-BINDING"
// claim directly, independent of the ceremony that closes over it.
// ---------------------------------------------------------------------------

test("defaultReadVerdict: reads back a genuinely persisted artifact exactly as stored at its own path (path-bound)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "d11-ceremony-defaultread-"));
  try {
    const ref = join(dir, "leg1.json");
    const artifact = signedArtifact(KEY_1.privateKeyPem, goVerdictFor(LEG_SPEC_1));
    await writeFile(ref, JSON.stringify(artifact), "utf8");
    const read = await defaultReadVerdict(ref, dir);
    assert.deepEqual(read, artifact, "what's returned is literally what's on disk at ref");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("defaultReadVerdict: returns null for a ref with no file behind it — never throws", async () => {
  const dir = await mkdtemp(join(tmpdir(), "d11-ceremony-defaultread-"));
  try {
    const result = await defaultReadVerdict(join(dir, "does-not-exist.json"), dir);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("defaultReadVerdict: returns null for a file that exists but is not valid JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "d11-ceremony-defaultread-"));
  try {
    const ref = join(dir, "malformed.json");
    await writeFile(ref, "not json {{{", "utf8");
    assert.equal(await defaultReadVerdict(ref, dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("defaultReadVerdict: returns null for well-formed JSON that is not a VerdictArtifact shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "d11-ceremony-defaultread-"));
  try {
    const ref = join(dir, "wrong-shape.json");
    await writeFile(ref, JSON.stringify({ hello: "world" }), "utf8");
    assert.equal(await defaultReadVerdict(ref, dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// I5 — the ceremony's own dependency bundle, fail-closed.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no deps injected — undefined", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, undefined);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed/i);
  assert.equal(result.localOnly, true);
  assert.equal(readVerdict.calls(), 0);
});

test("runD11Ceremony REFUSES (fail-closed, I5) when no deps injected — null", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, null);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.equal(readVerdict.calls(), 0);
});

// ---------------------------------------------------------------------------
// Separation of powers — refused BEFORE launchLeg is ever called.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES BEFORE launching when the two legSpecs are structurally identical", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({ legSpecs: [LEG_SPEC_1, LEG_SPEC_1] });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.equal(deps.launchLeg.calls(), 0, "identical legSpecs must never reach launchLeg");
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES BEFORE launching when leg1's session equals the note's author", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({ legSpecs: [leg(LEG_SPEC_1.model, AUTHOR_ID), LEG_SPEC_2] });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.match(result.outcome.reason, /author/i);
  assert.equal(deps.launchLeg.calls(), 0, "a leg == author must never reach launchLeg");
  assert.equal(readVerdict.calls(), 0);
});

test("runD11Ceremony REFUSES BEFORE launching when leg2's session equals the note's author", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({ legSpecs: [LEG_SPEC_1, leg(LEG_SPEC_2.model, AUTHOR_ID)] });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.equal(deps.launchLeg.calls(), 0);
  assert.equal(readVerdict.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — launchLeg absent/throwing/rejecting.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no launchLeg is injected", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({ launchLeg: undefined });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|launchLeg/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when launchLeg throws — never a silent success", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({
    launchLeg: countingFn(async () => {
      throw new Error("model unreachable");
    })
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /launchLeg/i);
  assert.match(result.outcome.reason, /model unreachable/);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when launchLeg rejects — never a silent success", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({
    launchLeg: countingFn(() => Promise.reject(new Error("timeout")))
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /launchLeg/i);
  assert.equal(result.localOnly, true);
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// The cheap pre-write reject on the INLINE verdicts (unchanged behaviour).
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES when a returned INLINE verdict is NO-GO — nothing is ever written or read", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({
    launchLeg: countingFn(async (note, legSpec) => {
      const v = goVerdictFor(legSpec);
      return legSpec.session === LEG_SPEC_2.session ? { ...v, verdict: "NO-GO", reason: "insufficient evidence" } : v;
    })
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /GO/);
  assert.equal(result.localOnly, true);
  assert.equal(deps.launchLeg.calls(), 2, "both legs are still launched — the gate runs on what came back");
  assert.equal(deps.writeVerdict.calls(), 0, "a refused ceremony must never write a verdict");
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the two INLINE verdicts' legs collide, despite distinct legSpecs", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const collidingLeg = leg("same-model", "same-session");
  const deps = happyDeps({
    launchLeg: countingFn(async () => ({ noteId: NOTE.noteId, verdict: "GO", leg: collidingLeg, at: 1000 }))
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /independent|same leg/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the two INLINE verdicts disagree on noteId", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({
    launchLeg: countingFn(async (note, legSpec) => {
      const v = goVerdictFor(legSpec);
      return legSpec.session === LEG_SPEC_2.session ? { ...v, noteId: "some-other-note" } : v;
    })
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /note/i);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — writeVerdict absent/throwing.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no writeVerdict is injected", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({ writeVerdict: undefined });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|writeVerdict/i);
  assert.equal(result.localOnly, true);
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when writeVerdict throws — nothing downstream is ever called", async () => {
  const { ceremony, readVerdict } = ceremonyThatMustNotRead();
  const deps = happyDeps({
    writeVerdict: countingFn(async () => {
      throw new Error("disk full");
    })
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /writeVerdict/i);
  assert.match(result.outcome.reason, /disk full/);
  assert.equal(result.localOnly, true);
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 1 — I5 on the read-back gate itself (readVerdict throwing).
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES when the construction-time readVerdict throws — writeAttestation/promote never called", async () => {
  const readVerdict = countingFn(async () => {
    throw new Error("store unreachable");
  });
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict: refCounter("ref") });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /readVerdict/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 1 — THE proven counter-example: writeVerdict invents a ref,
// no file is ever created, readVerdict (the REAL construction-time reader)
// finds nothing. This is the exact hole ROUND 1 closed; still structurally
// impossible to promote past.
// ---------------------------------------------------------------------------

test("D11 FIX counter-example: launchLeg fabricates 2 GO verdicts and writeVerdict invents refs with NO file behind them — REFUSED by the REAL default reader, promoteNote never called", async () => {
  // launchLeg returns two well-formed, distinct, GO, non-author verdicts — exactly
  // what a fabricating caller would produce. writeVerdict mints CORRECTLY CONFINED
  // refs (D11 FIX ROUND 3 — a bare unrelated string would now be caught one gate
  // EARLIER, at the confinement check itself; see the ROUND 3 section below for
  // that) but never stores anything (no file ever created ANYWHERE, real disk
  // included). The ceremony is constructed with NO readVerdict override — the REAL
  // default, genuine-filesystem reader (wrapped only to count calls) honestly
  // reports "nothing there" for any ref it's asked about: the fabrication cannot be
  // laundered.
  const dir = await mkdtemp(join(tmpdir(), "d11-ceremony-counterexample-"));
  try {
    const readVerdict = countingDefaultReadVerdict(dir);
    const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
    const writeVerdict = confinedNoWriteRef(dir);
    const deps = happyDeps({ writeVerdict });

    const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

    assert.equal(result.outcome.promoted, false);
    assert.match(result.outcome.reason, /no artifact|readVerdict/i);
    assert.equal(result.localOnly, true);
    assert.equal(deps.launchLeg.calls(), 2, "the fabricated inline verdicts were still produced");
    assert.equal(writeVerdict.calls(), 2, "the invented refs were still minted");
    assert.equal(readVerdict.calls(), 2, "both refs were actually checked against the REAL filesystem");
    assert.equal(deps.writeAttestation.calls(), 0);
    assert.equal(deps.port.promoteNote.calls(), 0, "THE HOLE: a caller fabricating 2 GO verdicts must never reach promoteNote");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runD11Ceremony REFUSES when readVerdict finds a file for leg2 but not leg1", async () => {
  const { writeVerdict: honestWrite, readVerdict, files } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const writeVerdict = countingFn(async (verdict) => {
    const ref = await honestWrite(verdict);
    if (verdict.leg.session === LEG_SPEC_1.session) {
      files.delete(ref); // simulate: the write claimed success but no file is actually there
    }
    return ref;
  });
  const deps = happyDeps({ writeVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /leg1/);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 2 — THE TERRA ATTACK: a per-call caller injects `readVerdict`
// directly onto `deps`, returning a TRUSTED-SIGNED artifact that exists ONLY
// in memory (no durable backing anywhere). This is the hole ROUND 1 left and
// ROUND 2 closes structurally.
// ---------------------------------------------------------------------------

test("TERRA ATTACK — a per-call deps.readVerdict returning a trusted-signed IN-MEMORY artifact is IGNORED (readVerdict is construction-time only); the real construction-time reader finds no durable backing and REFUSES", async () => {
  const dir = await mkdtemp(join(tmpdir(), "d11-ceremony-terra-"));
  try {
    // The ceremony is constructed with NO readVerdict override at all — the
    // production default (`defaultReadVerdict`, a real filesystem reader),
    // wrapped only to count invocations.
    const readVerdict = countingDefaultReadVerdict(dir);
    const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });

    // writeVerdict (still per-call, still untrusted) mints CORRECTLY CONFINED
    // refs but writes NOTHING to disk — the ROUND 1 counter-example shape.
    const writeVerdict = confinedNoWriteRef(dir);

    // THE ATTACK: the per-call caller attaches a `readVerdict` straight onto the
    // `deps` object at runtime — `RunD11CeremonyDeps` has no such field, so this
    // is only possible because JS does not enforce the TS shape. It fabricates a
    // fully-formed, GENUINELY, VALIDLY signed artifact (the attacker holds
    // LEG_SPEC_1's real private key here — modelling exactly the "unestablished
    // key custody" scenario the WHY names) that exists ONLY as this in-memory
    // closure's return value — no durable backing anywhere, no file, no ref
    // that resolves to real bytes.
    let maliciousReadVerdictCalls = 0;
    const maliciousReadVerdict = async () => {
      maliciousReadVerdictCalls += 1;
      return signedArtifact(KEY_1.privateKeyPem, goVerdictFor(LEG_SPEC_1));
    };

    const deps = happyDeps({ writeVerdict });
    deps.readVerdict = maliciousReadVerdict; // attached at runtime; not a real RunD11CeremonyDeps field

    const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

    assert.equal(result.outcome.promoted, false);
    assert.equal(result.localOnly, true);
    assert.match(result.outcome.reason, /no artifact|readVerdict/i);
    assert.equal(
      deps.port.promoteNote.calls(),
      0,
      "THE ATTACK: an in-memory trusted-signed artifact with no durable backing must never reach promoteNote"
    );
    assert.equal(
      maliciousReadVerdictCalls,
      0,
      "the per-call-attached readVerdict is DEAD CODE — runD11Ceremony never reads deps.readVerdict at all"
    );
    assert.equal(readVerdict.calls(), 2, "the REAL construction-time reader was used instead, for both refs");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 1 — signature must verify against the trusted keystore.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES when the verdict file's signature is garbage (invalid Ed25519 bytes)", async () => {
  const { writeVerdict: honestWrite, readVerdict, files } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const writeVerdict = countingFn(async (verdict) => {
    const ref = await honestWrite(verdict);
    if (verdict.leg.session === LEG_SPEC_1.session) {
      const artifact = files.get(ref);
      files.set(ref, { ...artifact, signature: "not-a-real-signature" });
    }
    return ref;
  });
  const deps = happyDeps({ writeVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /signature invalid/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the verdict is signed by a key NOT in the trusted keystore (leg unknown)", async () => {
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict, legSpecs: [LEG_SPEC_UNREGISTERED, LEG_SPEC_2] });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /no trusted public key|unknown/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the trusted keystore is EMPTY — fail-closed, never fail-open", async () => {
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const emptyCeremony = createD11Ceremony({ trustedKeystore: EMPTY_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  const result = await emptyCeremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /no trusted public key|keystore/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("ATTACK 1 — runD11Ceremony REFUSES a verdict that claims LEG_SPEC_1 but is signed with LEG_SPEC_2's key (both keys ARE in the trusted keystore)", async () => {
  const files = new Map();
  let n = 0;
  const writeVerdict = countingFn(async (verdict) => {
    n += 1;
    const ref = `verdict-ref:${n}`;
    if (verdict.leg.session === LEG_SPEC_1.session) {
      // Impersonation: the artifact CLAIMS leg1's identity but is signed with leg2's
      // private key. leg2's key IS trusted — just not for THIS claimed leg.
      files.set(ref, signedArtifact(KEY_2.privateKeyPem, verdict));
    } else {
      files.set(ref, signedArtifact(KEY_2.privateKeyPem, verdict)); // leg2 signs honestly with its own key
    }
    return ref;
  });
  const readVerdict = countingFn(async (ref) => files.get(ref) ?? null);
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /leg1/);
  assert.match(result.outcome.reason, /signature invalid/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 1 — anti-replay: the signature (and the ceremony's own pin)
// binds noteId.
// ---------------------------------------------------------------------------

test("ATTACK 2 — runD11Ceremony REFUSES a genuinely-signed verdict whose noteId does not match the note being promoted (replay across notes)", async () => {
  const files = new Map();
  let n = 0;
  const writeVerdict = countingFn(async (verdict) => {
    n += 1;
    const ref = `verdict-ref:${n}`;
    const key = ALL_SIGNABLE_KEYS.keyFor(verdict.leg);
    if (verdict.leg.session === LEG_SPEC_1.session) {
      // A REAL, validly signed verdict — but genuinely produced for a DIFFERENT note,
      // then replayed here to try to promote NOTE.
      files.set(ref, signedArtifact(key.privateKeyPem, { ...verdict, noteId: "note-replayed-from-elsewhere" }));
    } else {
      files.set(ref, signedArtifact(key.privateKeyPem, verdict));
    }
    return ref;
  });
  const readVerdict = countingFn(async (ref) => files.get(ref) ?? null);
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /replay|noteId/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 1 — GO/author/distinctness must hold on the READ content,
// not the inline one.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES when the READ verdict is NO-GO even though the INLINE verdict said GO", async () => {
  const files = new Map();
  let n = 0;
  const writeVerdict = countingFn(async (verdict) => {
    n += 1;
    const ref = `verdict-ref:${n}`;
    const key = ALL_SIGNABLE_KEYS.keyFor(verdict.leg);
    if (verdict.leg.session === LEG_SPEC_1.session) {
      files.set(ref, signedArtifact(key.privateKeyPem, { ...verdict, verdict: "NO-GO" }));
    } else {
      files.set(ref, signedArtifact(key.privateKeyPem, verdict));
    }
    return ref;
  });
  const readVerdict = countingFn(async (ref) => files.get(ref) ?? null);
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /not GO/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when a READ verdict's leg.session equals the note's author, even though the launched legSpec did not", async () => {
  const files = new Map();
  let n = 0;
  const writeVerdict = countingFn(async (verdict) => {
    n += 1;
    const ref = `verdict-ref:${n}`;
    if (verdict.leg.session === LEG_SPEC_1.session) {
      // The FILE actually read back claims a leg that collides with the author —
      // honestly signed (KEY_AUTHOR is a trusted key), just the wrong identity.
      files.set(ref, signedArtifact(KEY_AUTHOR.privateKeyPem, { ...verdict, leg: LEG_SPEC_AUTHOR_IMPERSONATION }));
    } else {
      const key = ALL_SIGNABLE_KEYS.keyFor(verdict.leg);
      files.set(ref, signedArtifact(key.privateKeyPem, verdict));
    }
    return ref;
  });
  const readVerdict = countingFn(async (ref) => files.get(ref) ?? null);
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /author/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the two READ verdicts' legs collide, despite distinct legSpecs and inline verdicts", async () => {
  const files = new Map();
  let n = 0;
  const writeVerdict = countingFn(async (verdict) => {
    n += 1;
    const ref = `verdict-ref:${n}`;
    // BOTH files, regardless of which leg was launched, claim LEG_SPEC_1's identity —
    // honestly signed with KEY_1 (which does own LEG_SPEC_1), just read twice.
    files.set(ref, signedArtifact(KEY_1.privateKeyPem, { ...verdict, leg: LEG_SPEC_1 }));
    return ref;
  });
  const readVerdict = countingFn(async (ref) => files.get(ref) ?? null);
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /independent|same leg/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 1 — coherence between the READ artifact and launchLeg's
// INLINE verdict.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES when a READ artifact is honestly signed and structurally fine, but NOT coherent with the inline launchLeg verdict (different leg)", async () => {
  const files = new Map();
  let n = 0;
  const writeVerdict = countingFn(async (verdict) => {
    n += 1;
    const ref = `verdict-ref:${n}`;
    if (verdict.leg.session === LEG_SPEC_1.session) {
      // The file contains a DIFFERENT, but validly signed and otherwise fine, leg's verdict.
      files.set(ref, signedArtifact(KEY_SWAP.privateKeyPem, { ...verdict, leg: LEG_SPEC_SWAP }));
    } else {
      const key = ALL_SIGNABLE_KEYS.keyFor(verdict.leg);
      files.set(ref, signedArtifact(key.privateKeyPem, verdict));
    }
    return ref;
  });
  const readVerdict = countingFn(async (ref) => files.get(ref) ?? null);
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /coherent/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — writeAttestation absent/throwing.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no writeAttestation is injected", async () => {
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict, writeAttestation: undefined });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|writeAttestation/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 2, "both verdicts are written before the attestation step");
  assert.equal(readVerdict.calls(), 2, "both verdicts are read+verified before the attestation step");
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when writeAttestation throws — promote never called", async () => {
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({
    writeVerdict,
    writeAttestation: countingFn(async () => {
      throw new Error("signing key unavailable");
    })
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /writeAttestation/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — the port itself (reused from slice 3, proven end to end here).
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no port is injected — writes and reads still happened", async () => {
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict, port: undefined });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|port/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 2);
  assert.equal(readVerdict.calls(), 2);
  assert.equal(deps.writeAttestation.calls(), 1);
});

test("runD11Ceremony REFUSES when the port throws (unreachable) — never a silent success", async () => {
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  deps.port.promoteNote = countingFn(async () => {
    throw new Error("ECONNREFUSED");
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /unreachable/i);
  assert.equal(result.localOnly, true);
});

// ---------------------------------------------------------------------------
// Happy path — the full composition, end to end, with REAL Ed25519
// signatures AND (in the second test) the REAL default filesystem reader.
// ---------------------------------------------------------------------------

test("runD11Ceremony happy path: 2 distinct GO legs, real signatures verified against the trusted keystore → promote called once with the READ, verified evidence", async () => {
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

  assert.deepEqual(result.outcome, { promoted: true, id: NOTE.noteId });
  assert.equal(result.localOnly, false);

  assert.equal(deps.launchLeg.calls(), 2, "both legs are launched");
  assert.equal(deps.writeVerdict.calls(), 2, "both verdicts are written");
  assert.equal(readVerdict.calls(), 2, "both verdicts are read back (from the construction-time reader) and verified");
  assert.equal(deps.writeAttestation.calls(), 1, "exactly one attestation is written");
  assert.equal(deps.port.promoteNote.calls(), 1, "promoteNote is called exactly once");

  // The attestation actually written reflects the READ, VERIFIED artifacts' leg
  // identities — not merely the inline verdicts (though here they agree).
  const [writtenAttestation] = deps.writeAttestation.args()[0];
  assert.deepEqual(writtenAttestation.leg1, LEG_SPEC_1);
  assert.deepEqual(writtenAttestation.leg2, LEG_SPEC_2);
  assert.equal(writtenAttestation.distinctModels, true);
  assert.equal(writtenAttestation.distinctSessions, true);
  assert.equal(writtenAttestation.verdictsWrittenBeforeCrossVisibility, true);
  assert.equal(typeof writtenAttestation.orchestrator, "string");

  // The evidence handed to promoteNote carries the REFS the injected writer
  // returned — not the raw objects (a locator, not JSON).
  const [promotedNoteId, evidence, ctx] = deps.port.promoteNote.args()[0];
  assert.equal(promotedNoteId, NOTE.noteId);
  assert.equal(evidence.leg1_verdict_ref, "verdict-ref:1");
  assert.equal(evidence.leg2_verdict_ref, "verdict-ref:2");
  assert.equal(evidence.independence_attestation, "attestation-ref:1");
  assert.deepEqual(ctx, CTX);
});

test("runD11Ceremony happy path with the REAL default readVerdict (no construction override) and real artifacts genuinely written to disk: promote called once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "d11-ceremony-happy-"));
  try {
    // No `readVerdict` override at all — this is the production default shape:
    // `defaultReadVerdict` does a genuine, CONFINED read (D11 FIX ROUND 3) at
    // whatever path `writeVerdict` (below) actually writes to — which must be
    // the ceremony-derived path beneath `authorizedRoot`, now REQUIRED.
    const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, authorizedRoot: dir });

    const writeVerdict = countingFn(async (verdict) => {
      const key = ALL_SIGNABLE_KEYS.keyFor(verdict.leg);
      return writeConfinedArtifact(dir, key.privateKeyPem, verdict);
    });
    const deps = happyDeps({ writeVerdict });
    const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

    assert.deepEqual(result.outcome, { promoted: true, id: NOTE.noteId });
    assert.equal(result.localOnly, false);
    assert.equal(deps.port.promoteNote.calls(), 1);

    const [, evidence] = deps.port.promoteNote.args()[0];
    assert.equal(evidence.leg1_verdict_ref, deriveVerdictRef(dir, NOTE.noteId, LEG_SPEC_1));
    assert.equal(evidence.leg2_verdict_ref, deriveVerdictRef(dir, NOTE.noteId, LEG_SPEC_2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runD11Ceremony happy path is order-agnostic on distinctModels/distinctSessions for two DIFFERENT sessions but the SAME model, with real signatures", async () => {
  const sameModel = "shared-model-x";
  const keyA = keypair();
  const keyB = keypair();
  const legA = leg(sameModel, "session-same-A");
  const legB = leg(sameModel, "session-same-B");
  const keystore = keystoreFrom([
    [legA, keyA.publicKeyPem],
    [legB, keyB.publicKeyPem],
    // D11 FIX ROUND 3 §B: this ceremony uses a CUSTOM keystore, distinct
    // from TRUSTED_KEYSTORE — NOTE's author signature must ALSO verify
    // against it, or author verification refuses before either leg is ever
    // launched.
    [AUTHOR_LEG, KEY_AUTHOR_SIG.publicKeyPem]
  ]);

  const files = new Map();
  let n = 0;
  const writeVerdict = countingFn(async (verdict) => {
    n += 1;
    const ref = `ref:${n}`;
    const key = verdict.leg.session === legA.session ? keyA : keyB;
    files.set(ref, signedArtifact(key.privateKeyPem, verdict));
    return ref;
  });
  const readVerdict = countingFn(async (ref) => files.get(ref) ?? null);
  const sameModelCeremony = createD11Ceremony({ trustedKeystore: keystore, readVerdict });

  const deps = happyDeps({ legSpecs: [legA, legB], writeVerdict });
  const result = await sameModelCeremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, true);
  const [writtenAttestation] = deps.writeAttestation.args()[0];
  assert.equal(writtenAttestation.distinctModels, false, "same model on both legs — not distinct");
  assert.equal(writtenAttestation.distinctSessions, true, "distinct sessions still make the legs independent");
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 3 — path confinement. A THIRD, independent review NO-GO'd
// round 2: `readVerdict` was construction-time, but the DEFAULT reader still
// did a plain `readFile(ref)` on `writeVerdict`'s PER-CALL, caller-controlled
// return value — the untrusted caller still controlled WHERE the trusted
// reader looked. All three of the following attacks reached `promoteNote`
// with `promoted: true` at ROUND 2 (@824b633e). ROUND 3 closes them by
// deriving the ONE authorized read location itself (never trusting the
// per-call ref beyond a string-equality check against that derivation), and
// by opening it via the cull.ts-style descriptor-relative O_NOFOLLOW walk
// with a SINGLE held file descriptor from open through fstat to read.
// ---------------------------------------------------------------------------

test("ROUND 3 ATTACK 1 — TRAVERSAL: writeVerdict returns a ../ ref pointing at a genuinely, validly signed GO artifact OUTSIDE the authorized zone — REFUSED before any file access (@824b633e this reached promoteNote:true)", async () => {
  const root = await mkdtemp(join(tmpdir(), "d11-ceremony-traversal-root-"));
  const outside = await mkdtemp(join(tmpdir(), "d11-ceremony-traversal-outside-"));
  try {
    // A genuinely, validly signed GO artifact for LEG_SPEC_1 — real signature,
    // real trusted key, everything a naive reader would accept — just planted
    // OUTSIDE authorizedRoot.
    const outsideRef = join(outside, "planted-leg1.json");
    await writeFile(outsideRef, JSON.stringify(signedArtifact(KEY_1.privateKeyPem, goVerdictFor(LEG_SPEC_1))), "utf8");
    // `root` and `outside` share the same parent (os.tmpdir()), so this
    // genuinely traverses OUT of root and back into `outside` — a real `../`
    // escape, not a simulated one.
    const traversalRef = join(root, "..", basename(outside), "planted-leg1.json");

    const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, authorizedRoot: root });
    const writeVerdict = countingFn(async (verdict) => {
      if (verdict.leg.session === LEG_SPEC_1.session) return traversalRef;
      const key = ALL_SIGNABLE_KEYS.keyFor(verdict.leg);
      return writeConfinedArtifact(root, key.privateKeyPem, verdict);
    });
    const deps = happyDeps({ writeVerdict });

    const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

    assert.equal(result.outcome.promoted, false);
    assert.equal(result.localOnly, true);
    assert.match(result.outcome.reason, /leg1/);
    assert.match(result.outcome.reason, /confined/i);
    assert.equal(
      deps.port.promoteNote.calls(),
      0,
      "THE ATTACK: a traversal ref to a genuinely valid GO artifact must never reach promoteNote"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("ROUND 3 ATTACK 2 — SYMLINK: the confined ref (string-identical to the ceremony-derived path) IS a symlink to an attacker file outside the zone — REFUSED (O_NOFOLLOW), promoteNote never called (@824b633e this reached promoteNote:true)", async () => {
  const root = await mkdtemp(join(tmpdir(), "d11-ceremony-symlink-root-"));
  const outside = await mkdtemp(join(tmpdir(), "d11-ceremony-symlink-outside-"));
  try {
    const outsideRef = join(outside, "attacker-leg1.json");
    await writeFile(outsideRef, JSON.stringify(signedArtifact(KEY_1.privateKeyPem, goVerdictFor(LEG_SPEC_1))), "utf8");

    const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, authorizedRoot: root });
    const writeVerdict = countingFn(async (verdict) => {
      if (verdict.leg.session === LEG_SPEC_1.session) {
        // The ref returned is the CORRECT, ceremony-derived path — it PASSES
        // the string-equality confinement check — but what's actually AT
        // that path is a symlink to an attacker file outside the zone.
        const ref = deriveVerdictRef(root, verdict.noteId, verdict.leg);
        await mkdir(dirname(ref), { recursive: true });
        await symlink(outsideRef, ref);
        return ref;
      }
      const key = ALL_SIGNABLE_KEYS.keyFor(verdict.leg);
      return writeConfinedArtifact(root, key.privateKeyPem, verdict);
    });
    const deps = happyDeps({ writeVerdict });

    const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

    assert.equal(result.outcome.promoted, false);
    assert.equal(result.localOnly, true);
    assert.match(result.outcome.reason, /no artifact/i);
    assert.equal(
      deps.port.promoteNote.calls(),
      0,
      "THE ATTACK: a symlink to a genuinely valid GO artifact must never reach promoteNote"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("ROUND 3 ATTACK 3 — TOCTOU: the confined ref is a genuinely signed artifact at write time but is SWAPPED for a symlink before the read — REFUSED (single held descriptor, no re-open gap), promoteNote never called (@824b633e this reached promoteNote:true)", async () => {
  const root = await mkdtemp(join(tmpdir(), "d11-ceremony-toctou-root-"));
  const outside = await mkdtemp(join(tmpdir(), "d11-ceremony-toctou-outside-"));
  try {
    const outsideRef = join(outside, "attacker-leg1.json");
    await writeFile(outsideRef, JSON.stringify(signedArtifact(KEY_1.privateKeyPem, goVerdictFor(LEG_SPEC_1))), "utf8");

    const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, authorizedRoot: root });
    const writeVerdict = countingFn(async (verdict) => {
      if (verdict.leg.session === LEG_SPEC_1.session) {
        const ref = deriveVerdictRef(root, verdict.noteId, verdict.leg);
        await mkdir(dirname(ref), { recursive: true });
        // A naive "check the file, THEN separately re-open it to read" reader
        // would see THIS genuinely, validly signed GO artifact if it checked
        // right now — this deterministically models winning the TOCTOU race
        // window: by the time the ceremony's actual read runs, only the
        // swapped symlink below exists.
        await writeFile(ref, JSON.stringify(signedArtifact(KEY_1.privateKeyPem, verdict)), "utf8");
        await unlink(ref);
        await symlink(outsideRef, ref);
        return ref;
      }
      const key = ALL_SIGNABLE_KEYS.keyFor(verdict.leg);
      return writeConfinedArtifact(root, key.privateKeyPem, verdict);
    });
    const deps = happyDeps({ writeVerdict });

    const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

    assert.equal(result.outcome.promoted, false);
    assert.equal(result.localOnly, true);
    assert.match(result.outcome.reason, /no artifact/i);
    assert.equal(
      deps.port.promoteNote.calls(),
      0,
      "THE ATTACK: a file swapped between write and read must never reach promoteNote"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("ROUND 3 — ref-collision still refused: writeVerdict tries to make leg2's ref collide with leg1's ceremony-derived path — REFUSED at the confinement gate itself", async () => {
  const root = await mkdtemp(join(tmpdir(), "d11-ceremony-collision-"));
  try {
    const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, authorizedRoot: root });
    const leg1DerivedRef = deriveVerdictRef(root, NOTE.noteId, LEG_SPEC_1);
    const writeVerdict = countingFn(async (verdict) => {
      if (verdict.leg.session === LEG_SPEC_1.session) {
        return writeConfinedArtifact(root, KEY_1.privateKeyPem, verdict);
      }
      // leg2 attempts to claim leg1's own derived location instead of its own.
      return leg1DerivedRef;
    });
    const deps = happyDeps({ writeVerdict });
    const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
    assert.equal(result.outcome.promoted, false);
    assert.match(result.outcome.reason, /leg2/);
    assert.match(result.outcome.reason, /confined/i);
    assert.equal(deps.port.promoteNote.calls(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 3 §B — authorId is now BOUND to a verified author signature.
// Graphify verified (@67bf73c7) MemoryNote carries no trusted author field —
// so this closes INSIDE the ceremony, reusing the SAME trustedKeystore +
// verifySignature verdict signatures already use (no second trust root).
// `input.authorId` is a bare, per-call, caller-supplied hint — structurally
// NEVER read for a trust decision anywhere in this module; separation of
// powers compares against the VERIFIED signer of
// `note["h2a.author_signature"]` instead. What was previously a KNOWN-OPEN,
// SKIPPED, documented bypass is now a closed, asserted refusal.
// ---------------------------------------------------------------------------

test("D11 FIX ROUND 3 §B: authorId bypass is now REFUSED — a caller's false input.authorId cannot hide that the note's VERIFIED signed author is actually one of the two legs", async () => {
  const { readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  // The note's REAL, SIGNED author is LEG_SPEC_1 itself (signed with
  // LEG_SPEC_1's own trusted key) — LEG_SPEC_1 is genuinely reviewing its
  // own note.
  const selfAuthoredNote = withAuthorSignature(NOTE, KEY_1.privateKeyPem, LEG_SPEC_1);
  const deps = happyDeps();
  // The caller supplies a DIFFERENT, false authorId — under the OLD
  // (round-2) design this bypassed separation of powers; it no longer can,
  // because authorId is never read for the trust decision.
  const result = await ceremony(
    { note: selfAuthoredNote, authorId: "claude:h2a-memory:a-false-author-id" },
    deps
  );
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.match(result.outcome.reason, /author/i);
  assert.equal(deps.launchLeg.calls(), 0, "a leg == the VERIFIED author must never reach launchLeg");
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("D11 FIX ROUND 3 §B: a note with NO author signature is REFUSED — fail-closed, never falls back to input.authorId", async () => {
  const { readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const noteWithoutSignature = { noteId: NOTE.noteId, principal_owner: NOTE.principal_owner };
  const deps = happyDeps();
  const result = await ceremony({ note: noteWithoutSignature, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.match(result.outcome.reason, /author signature/i);
  assert.equal(deps.launchLeg.calls(), 0);
  assert.equal(readVerdict.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("D11 FIX ROUND 3 §B: a note whose author signature is signed by a key NOT in the trusted keystore is REFUSED (unknown author)", async () => {
  const { readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const unknownAuthorLeg = leg("unregistered-author-model", "unregistered-author-session");
  const unknownAuthorKey = keypair(); // never registered in TRUSTED_KEYSTORE
  const noteWithUnknownAuthor = withAuthorSignature(NOTE, unknownAuthorKey.privateKeyPem, unknownAuthorLeg);
  const deps = happyDeps();
  const result = await ceremony({ note: noteWithUnknownAuthor, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /no trusted public key/i);
  assert.equal(deps.launchLeg.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("D11 FIX ROUND 3 §B: a note whose author signature is garbage/tampered is REFUSED even though the claimed authorLeg IS in the trusted keystore", async () => {
  const { readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const tamperedNote = {
    ...NOTE,
    "h2a.author_signature": { authorLeg: AUTHOR_LEG, noteId: NOTE.noteId, signature: "not-a-real-signature" }
  };
  const deps = happyDeps();
  const result = await ceremony({ note: tamperedNote, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /author signature is invalid/i);
  assert.equal(deps.launchLeg.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("D11 FIX ROUND 3 §B: a note's author signature whose noteId does not match the note itself is REFUSED (anti-replay)", async () => {
  const { readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const replayedNote = {
    ...NOTE,
    "h2a.author_signature": authorSignature(KEY_AUTHOR_SIG.privateKeyPem, {
      noteId: "some-other-note",
      authorLeg: AUTHOR_LEG
    })
  };
  const deps = happyDeps();
  const result = await ceremony({ note: replayedNote, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /noteId does not match|replay/i);
  assert.equal(deps.launchLeg.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("D11 FIX ROUND 3 §B: a note whose author signature verifies, with a signer DISTINCT from both legs, promotes normally", async () => {
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, readVerdict });
  const deps = happyDeps({ writeVerdict });
  // NOTE's author signature verifies to AUTHOR_LEG.session (AUTHOR_ID),
  // distinct from both LEG_SPEC_1.session and LEG_SPEC_2.session.
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.deepEqual(result.outcome, { promoted: true, id: NOTE.noteId });
  assert.equal(deps.port.promoteNote.calls(), 1);
});

// ---------------------------------------------------------------------------
// D11 FIX ROUND 4 — a FOURTH, independent review NO-GO'd ROUND 3 with TWO
// real blockers, neither exercised by any test above. Both of the following
// three tests PROMOTE (`promoted: true`, `promoteNote` called) at ROUND 3
// (@64e3f8a4) — proven by an independent review re-running the FIRST TWO
// against that exact commit before this round's fix existed; the THIRD is a
// variant of the same fake-independence class, not tested by that review,
// added here because it reaches the identical hole (a shared key behind two
// distinct `{model, session}` identities) one step further — reviewer vs.
// reviewer, not just author vs. reviewer. See the ROUND 4 module doc in
// `d11-ceremony.ts` for the full fix description.
// ---------------------------------------------------------------------------

test("D11 FIX ROUND 4 ATTACK 1 — REPLAY: a fresh promotion is fabricated only by replaying OLD, already-signed, SAME-noteId verdict bytes from a prior ceremony — REFUSED (fresh ceremony nonce required; @64e3f8a4 this reached promoteNote:true, no private key used by the attacker)", async () => {
  const root = await mkdtemp(join(tmpdir(), "d11-r4-replay-"));
  try {
    const replayAuthorLeg = leg("replay-author-model", "replay-author-session");
    const replayLeg1 = leg("replay-review-model-1", "replay-review-session-1");
    const replayLeg2 = leg("replay-review-model-2", "replay-review-session-2");
    const authorKey = keypair();
    const key1 = keypair();
    const key2 = keypair();
    const note = withAuthorSignature(
      { noteId: "d11-r4-replay-note", principal_owner: "claude:h2a-memory:owner-replay" },
      authorKey.privateKeyPem,
      replayAuthorLeg
    );
    const keystore = keystoreFrom([
      [replayAuthorLeg, authorKey.publicKeyPem],
      [replayLeg1, key1.publicKeyPem],
      [replayLeg2, key2.publicKeyPem]
    ]);

    // Authority phase: an OLD ceremony genuinely ran once (with SOME old,
    // now-stale nonce) and produced two genuinely, validly signed GO
    // artifacts for THIS noteId, persisted at the ONE location this
    // noteId+leg pair will always derive to.
    const oldNonce = "old-stale-nonce-from-a-prior-genuine-ceremony";
    function oldSignedArtifact(privateKeyPem, verdict) {
      const payload = {
        noteId: verdict.noteId,
        verdict: verdict.verdict,
        leg: verdict.leg,
        at: verdict.at,
        ceremonyNonce: oldNonce
      };
      return { ...payload, signature: signPayload(privateKeyPem, payload) };
    }
    const oldArtifact1 = oldSignedArtifact(key1.privateKeyPem, { noteId: note.noteId, verdict: "GO", leg: replayLeg1, at: 1 });
    const oldArtifact2 = oldSignedArtifact(key2.privateKeyPem, { noteId: note.noteId, verdict: "GO", leg: replayLeg2, at: 1 });
    const ref1 = deriveVerdictRef(root, note.noteId, replayLeg1);
    const ref2 = deriveVerdictRef(root, note.noteId, replayLeg2);
    await mkdir(dirname(ref1), { recursive: true });
    await writeFile(ref1, JSON.stringify(oldArtifact1), "utf8");
    await writeFile(ref2, JSON.stringify(oldArtifact2), "utf8");

    // Attack phase: a FRESH ceremony. `launchLeg`/`writeVerdict` here
    // capture only PUBLIC data and the ALREADY-PERSISTED old bytes — no
    // private key is used by the attacker anywhere in this fresh run.
    const ceremony = createD11Ceremony({ trustedKeystore: keystore, authorizedRoot: root });
    const launchLeg = countingFn(async (_note, spec) => {
      const old = spec.session === replayLeg1.session ? oldArtifact1 : oldArtifact2;
      return { noteId: old.noteId, verdict: old.verdict, leg: old.leg, at: old.at, ceremonyNonce: old.ceremonyNonce };
    });
    const writeVerdict = countingFn(async (verdict) =>
      // The REF is CORRECT (the ceremony-derived confined path) — the attack
      // is entirely about the BYTES already sitting at that path, not about
      // relocating them.
      verdict.leg.session === replayLeg1.session ? ref1 : ref2
    );
    let promoteCalls = 0;
    const result = await ceremony(
      { note, authorId: "caller-lie-is-irrelevant" },
      {
        legSpecs: [replayLeg1, replayLeg2],
        launchLeg,
        writeVerdict,
        writeAttestation: async () => "attestation-ref",
        ctx: { principal_owner: note.principal_owner },
        port: {
          promoteNote: async () => {
            promoteCalls += 1;
            return { promoted: true, id: note.noteId };
          }
        }
      }
    );

    assert.equal(result.outcome.promoted, false);
    assert.equal(
      promoteCalls,
      0,
      "THE ATTACK: same-note replay of old, genuinely signed verdict bytes must never mint a fresh promotion"
    );
    assert.match(result.outcome.reason, /nonce|replay|stale/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("D11 FIX ROUND 4 ATTACK 2 — ALIAS (author/reviewer): self-promotion when the VERIFIED author and one reviewer are aliases for the SAME public key under distinct sessions — REFUSED (canonical key fingerprint, not session strings; @64e3f8a4 this reached promoteNote:true)", async () => {
  const root = await mkdtemp(join(tmpdir(), "d11-r4-author-alias-"));
  try {
    const authorAlias = leg("alias-author-model", "alias-author-session");
    const reviewerAlias = leg("alias-review-model-1", "alias-reviewer-alias-session");
    const leg2 = leg("alias-review-model-2", "alias-review-session-2");
    const sharedKey = keypair(); // ONE keypair backing TWO distinct identities
    const key2 = keypair();
    const note = withAuthorSignature(
      { noteId: "d11-r4-author-alias-note", principal_owner: "claude:h2a-memory:owner-alias-1" },
      sharedKey.privateKeyPem,
      authorAlias
    );
    const keystore = keystoreFrom([
      [authorAlias, sharedKey.publicKeyPem],
      [reviewerAlias, sharedKey.publicKeyPem], // ALIAS: same key, different identity
      [leg2, key2.publicKeyPem]
    ]);
    const ceremony = createD11Ceremony({ trustedKeystore: keystore, authorizedRoot: root });
    const launchLeg = countingFn(async (_note, spec, ceremonyNonce) => ({
      noteId: note.noteId,
      verdict: "GO",
      leg: spec,
      at: 2,
      ceremonyNonce
    }));
    const writeVerdict = countingFn(async (verdict) => {
      const privateKeyPem = verdict.leg.session === reviewerAlias.session ? sharedKey.privateKeyPem : key2.privateKeyPem;
      const ref = deriveVerdictRef(root, verdict.noteId, verdict.leg);
      await mkdir(dirname(ref), { recursive: true });
      await writeFile(ref, JSON.stringify(signedArtifact(privateKeyPem, verdict)), "utf8");
      return ref;
    });
    let promoteCalls = 0;
    const result = await ceremony(
      { note, authorId: "caller-lie-is-irrelevant" },
      {
        legSpecs: [reviewerAlias, leg2],
        launchLeg,
        writeVerdict,
        writeAttestation: async () => "attestation-ref",
        ctx: { principal_owner: note.principal_owner },
        port: {
          promoteNote: async () => {
            promoteCalls += 1;
            return { promoted: true, id: note.noteId };
          }
        }
      }
    );

    assert.equal(result.outcome.promoted, false);
    assert.equal(
      promoteCalls,
      0,
      "THE ATTACK: the same crypto principal must not author AND review through two identity aliases"
    );
    assert.match(result.outcome.reason, /fingerprint|crypto principal|same canonical/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("D11 FIX ROUND 4 ATTACK 3 (required addition, a variant not exercised by the independent review) — ALIAS (reviewer/reviewer): fake independence when BOTH reviewer legs are aliases for the SAME public key under distinct sessions — REFUSED (the fingerprint check is pairwise: r1≠r2 is caught, not just author≠reviewer; @64e3f8a4 this reached promoteNote:true — sameLegSpec only compares {model,session}, never the key behind them)", async () => {
  const root = await mkdtemp(join(tmpdir(), "d11-r4-reviewer-alias-"));
  try {
    const authorLeg2 = leg("r4-author-model", "r4-author-session");
    const reviewerAliasA = leg("r4-review-model-a", "r4-review-session-a");
    const reviewerAliasB = leg("r4-review-model-b", "r4-review-session-b"); // DISTINCT model+session, SAME key as A
    const authorKey = keypair();
    const sharedReviewerKey = keypair(); // ONE keypair backing BOTH "independent" reviewer identities
    const note = withAuthorSignature(
      { noteId: "d11-r4-reviewer-alias-note", principal_owner: "claude:h2a-memory:owner-alias-2" },
      authorKey.privateKeyPem,
      authorLeg2
    );
    const keystore = keystoreFrom([
      [authorLeg2, authorKey.publicKeyPem],
      [reviewerAliasA, sharedReviewerKey.publicKeyPem],
      [reviewerAliasB, sharedReviewerKey.publicKeyPem] // ALIAS: same key as reviewerAliasA
    ]);
    // Structurally distinct per the OLD (session-string) check: different
    // model AND different session — `sameLegSpec` alone would call these two
    // "independent". Only the key-fingerprint check (ROUND 4) catches it.
    assert.notEqual(reviewerAliasA.session, reviewerAliasB.session);
    assert.notEqual(reviewerAliasA.model, reviewerAliasB.model);

    const ceremony = createD11Ceremony({ trustedKeystore: keystore, authorizedRoot: root });
    const launchLeg = countingFn(async (_note, spec, ceremonyNonce) => ({
      noteId: note.noteId,
      verdict: "GO",
      leg: spec,
      at: 3,
      ceremonyNonce
    }));
    const writeVerdict = countingFn(async (verdict) => {
      const ref = deriveVerdictRef(root, verdict.noteId, verdict.leg);
      await mkdir(dirname(ref), { recursive: true });
      await writeFile(ref, JSON.stringify(signedArtifact(sharedReviewerKey.privateKeyPem, verdict)), "utf8");
      return ref;
    });
    let promoteCalls = 0;
    const result = await ceremony(
      { note, authorId: "caller-lie-is-irrelevant" },
      {
        legSpecs: [reviewerAliasA, reviewerAliasB],
        launchLeg,
        writeVerdict,
        writeAttestation: async () => "attestation-ref",
        ctx: { principal_owner: note.principal_owner },
        port: {
          promoteNote: async () => {
            promoteCalls += 1;
            return { promoted: true, id: note.noteId };
          }
        }
      }
    );

    assert.equal(result.outcome.promoted, false);
    assert.equal(
      promoteCalls,
      0,
      "THE ATTACK: two reviewer identities backed by the SAME key are not independent — must never reach promoteNote"
    );
    assert.match(result.outcome.reason, /fingerprint|crypto principal|same canonical/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
