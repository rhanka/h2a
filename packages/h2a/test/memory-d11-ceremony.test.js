// WP11 · Memory & context — D11 ceremony orchestrator, D11 FIX (anti-fabrication).
//
// An independent review NO-GO'd the prior build: `launchLeg` returned verdicts INLINE
// (caller-controlled), `writeVerdict`'s ref was never read back, and the consensus gate
// checked only the caller-supplied inline verdicts. A `writeVerdict` that invents a ref
// string without ever creating a file still reached `promoteNote` with `promoted: true`.
//
// THE FIX: `createD11Ceremony({ trustedKeystore })` closes over a keystore a per-call
// caller cannot swap. `readVerdict(ref)` OPENS+READS the actual persisted artifact.
// Each artifact's `signature` is verified against the trusted key for its OWN CLAIMED
// leg, its `verdict` must read `"GO"`, its `noteId` must pin to the note actually being
// promoted (anti-replay — the signed payload covers `noteId` too), the two read legs
// must be structurally distinct and neither may equal the author (off the READ content),
// and the read content must cohere with launchLeg's inline verdict. Only then are the
// READ, VERIFIED artifacts (never the inline ones) handed to `promoteNoteWithDoubleConsensus`.
//
// This file proves: the exact proven counter-example (invented ref, no file) is rejected;
// each of the three adversarial attacks the reviewer named (wrong-key impersonation of a
// still-trusted leg, replay of a genuinely-signed verdict across notes, and an empty/
// leg-unknown keystore) is rejected; and `promoteNote` is NEVER reached on any refusal.

import { strict as assert } from "node:assert";
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import test from "node:test";

import { canonicalize } from "../dist/index.js";
import { createD11Ceremony, defaultVerifySignature } from "../dist/runtime/memory/d11-ceremony.js";

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

/** Builds a genuinely, correctly signed VerdictArtifact for the given content. */
function signedArtifact(privateKeyPem, { noteId, verdict, leg: legIdentity, at }) {
  const payload = { noteId, verdict, leg: legIdentity, at };
  return { noteId, verdict, leg: legIdentity, at, signature: signPayload(privateKeyPem, payload) };
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

const NOTE = { noteId: "note-1", principal_owner: "claude:h2a-memory:owner-1" };
const AUTHOR_ID = "claude:h2a-memory:author-not-a-leg";
const LEG_SPEC_1 = leg("gpt-5.6-terra-xhigh", "session-A");
const LEG_SPEC_2 = leg("opus-5-xhigh", "session-B");
const CTX = { principal_owner: NOTE.principal_owner };

function goVerdictFor(legSpec) {
  return { noteId: NOTE.noteId, verdict: "GO", leg: legSpec, at: 1000 };
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
  [LEG_SPEC_SWAP, KEY_SWAP.publicKeyPem]
]);
const EMPTY_KEYSTORE = keystoreFrom([]);
const ALL_SIGNABLE_KEYS = keyRegistryFrom([
  [LEG_SPEC_1, KEY_1],
  [LEG_SPEC_2, KEY_2],
  [LEG_SPEC_AUTHOR_IMPERSONATION, KEY_AUTHOR],
  [LEG_SPEC_SWAP, KEY_SWAP],
  [LEG_SPEC_UNREGISTERED, KEY_UNREGISTERED]
]);

/** The ceremony under test, closed over the trusted keystore above. */
const ceremony = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE });

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

/** An in-memory "file store": writeVerdict signs with the leg's OWN registered key and
 * persists a real artifact; readVerdict reads it back. Mirrors an honest implementation. */
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

function happyDeps(overrides = {}) {
  const launchLeg = countingFn(async (note, legSpec) => goVerdictFor(legSpec));
  const { writeVerdict, readVerdict } = honestVerdictIo();
  const writeAttestation = refCounter("attestation-ref");
  const port = honestPort();
  return {
    launchLeg,
    writeVerdict,
    readVerdict,
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

test("createD11Ceremony honors a custom injected verifySignature (construction-time seam, not per-call)", async () => {
  let calls = 0;
  const alwaysReject = () => {
    calls += 1;
    return false;
  };
  const stubbed = createD11Ceremony({ trustedKeystore: TRUSTED_KEYSTORE, verifySignature: alwaysReject });
  const deps = happyDeps();
  const result = await stubbed({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.ok(calls > 0, "the injected verifySignature was actually invoked");
  assert.equal(deps.port.promoteNote.calls(), 0);
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
// I5 — the ceremony's own dependency bundle, fail-closed.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no deps injected — undefined", async () => {
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, undefined);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed/i);
  assert.equal(result.localOnly, true);
});

test("runD11Ceremony REFUSES (fail-closed, I5) when no deps injected — null", async () => {
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, null);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
});

// ---------------------------------------------------------------------------
// Separation of powers — refused BEFORE launchLeg is ever called.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES BEFORE launching when the two legSpecs are structurally identical", async () => {
  const deps = happyDeps({ legSpecs: [LEG_SPEC_1, LEG_SPEC_1] });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.equal(deps.launchLeg.calls(), 0, "identical legSpecs must never reach launchLeg");
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(deps.readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES BEFORE launching when leg1's session equals the note's author", async () => {
  const deps = happyDeps({ legSpecs: [leg(LEG_SPEC_1.model, AUTHOR_ID), LEG_SPEC_2] });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.match(result.outcome.reason, /author/i);
  assert.equal(deps.launchLeg.calls(), 0, "a leg == author must never reach launchLeg");
});

test("runD11Ceremony REFUSES BEFORE launching when leg2's session equals the note's author", async () => {
  const deps = happyDeps({ legSpecs: [LEG_SPEC_1, leg(LEG_SPEC_2.model, AUTHOR_ID)] });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.equal(result.localOnly, true);
  assert.equal(deps.launchLeg.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — launchLeg absent/throwing/rejecting.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no launchLeg is injected", async () => {
  const deps = happyDeps({ launchLeg: undefined });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|launchLeg/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(deps.readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when launchLeg throws — never a silent success", async () => {
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
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when launchLeg rejects — never a silent success", async () => {
  const deps = happyDeps({
    launchLeg: countingFn(() => Promise.reject(new Error("timeout")))
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /launchLeg/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// The cheap pre-write reject on the INLINE verdicts (unchanged behaviour).
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES when a returned INLINE verdict is NO-GO — nothing is ever written or read", async () => {
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
  assert.equal(deps.readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the two INLINE verdicts' legs collide, despite distinct legSpecs", async () => {
  const collidingLeg = leg("same-model", "same-session");
  const deps = happyDeps({
    launchLeg: countingFn(async () => ({ noteId: NOTE.noteId, verdict: "GO", leg: collidingLeg, at: 1000 }))
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /independent|same leg/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 0);
  assert.equal(deps.readVerdict.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the two INLINE verdicts disagree on noteId", async () => {
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
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — writeVerdict absent/throwing.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no writeVerdict is injected", async () => {
  const deps = happyDeps({ writeVerdict: undefined });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|writeVerdict/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when writeVerdict throws — nothing downstream is ever called", async () => {
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
  assert.equal(deps.readVerdict.calls(), 0);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX — I5 on readVerdict itself (absent/throwing).
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no readVerdict is injected — verdicts were written but never read back", async () => {
  const deps = happyDeps({ readVerdict: undefined });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|readVerdict/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 2, "both verdicts are still written before the read-back gate");
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when readVerdict throws — writeAttestation/promote never called", async () => {
  const deps = happyDeps({
    readVerdict: countingFn(async () => {
      throw new Error("store unreachable");
    })
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /readVerdict/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX — THE proven counter-example: writeVerdict invents a ref, no file
// is ever created, readVerdict finds nothing. This is the exact hole a
// review NO-GO'd; it must now be structurally impossible to promote past.
// ---------------------------------------------------------------------------

test("D11 FIX counter-example: launchLeg fabricates 2 GO verdicts and writeVerdict invents refs with NO file behind them — REFUSED, promoteNote never called", async () => {
  // launchLeg returns two well-formed, distinct, GO, non-author verdicts — exactly
  // what a fabricating caller would produce. writeVerdict mints refs but never
  // stores anything (no file ever created). readVerdict honestly reports "nothing
  // there" for any ref it's asked about — the fabrication cannot be laundered.
  const writeVerdict = refCounter("fabricated-ref");
  const readVerdict = countingFn(async () => null);
  const deps = happyDeps({ writeVerdict, readVerdict });

  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /no artifact|readVerdict/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.launchLeg.calls(), 2, "the fabricated inline verdicts were still produced");
  assert.equal(deps.writeVerdict.calls(), 2, "the invented refs were still minted");
  assert.equal(deps.readVerdict.calls(), 2, "both refs were actually checked for a real file");
  assert.equal(deps.writeAttestation.calls(), 0);
  assert.equal(deps.port.promoteNote.calls(), 0, "THE HOLE: a caller fabricating 2 GO verdicts must never reach promoteNote");
});

test("runD11Ceremony REFUSES when readVerdict finds a file for leg2 but not leg1", async () => {
  const { writeVerdict, readVerdict, files } = honestVerdictIo();
  const deps = happyDeps({
    writeVerdict: countingFn(async (verdict) => {
      const ref = await writeVerdict(verdict);
      if (verdict.leg.session === LEG_SPEC_1.session) {
        files.delete(ref); // simulate: the write claimed success but no file is actually there
      }
      return ref;
    }),
    readVerdict
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /leg1/);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX — signature must verify against the trusted keystore.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES when the verdict file's signature is garbage (invalid Ed25519 bytes)", async () => {
  const { writeVerdict: honestWrite, readVerdict, files } = honestVerdictIo();
  const writeVerdict = countingFn(async (verdict) => {
    const ref = await honestWrite(verdict);
    if (verdict.leg.session === LEG_SPEC_1.session) {
      const artifact = files.get(ref);
      files.set(ref, { ...artifact, signature: "not-a-real-signature" });
    }
    return ref;
  });
  const deps = happyDeps({ writeVerdict, readVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /signature invalid/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the verdict is signed by a key NOT in the trusted keystore (leg unknown)", async () => {
  const deps = happyDeps({ legSpecs: [LEG_SPEC_UNREGISTERED, LEG_SPEC_2] });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /no trusted public key|unknown/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when the trusted keystore is EMPTY — fail-closed, never fail-open", async () => {
  const emptyCeremony = createD11Ceremony({ trustedKeystore: EMPTY_KEYSTORE });
  const deps = happyDeps();
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
  const deps = happyDeps({ writeVerdict, readVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /leg1/);
  assert.match(result.outcome.reason, /signature invalid/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX — anti-replay: the signature (and the ceremony's own pin) binds noteId.
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
  const deps = happyDeps({ writeVerdict, readVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /replay|noteId/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX — GO/author/distinctness must hold on the READ content, not the inline one.
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
  const deps = happyDeps({ writeVerdict, readVerdict });
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
  const deps = happyDeps({ writeVerdict, readVerdict });
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
  const deps = happyDeps({ writeVerdict, readVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /independent|same leg/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// D11 FIX — coherence between the READ artifact and launchLeg's INLINE verdict.
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
  const deps = happyDeps({ writeVerdict, readVerdict });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /coherent/i);
  assert.equal(deps.port.promoteNote.calls(), 0);
});

// ---------------------------------------------------------------------------
// I5 — writeAttestation absent/throwing.
// ---------------------------------------------------------------------------

test("runD11Ceremony REFUSES (fail-closed, I5) when no writeAttestation is injected", async () => {
  const deps = happyDeps({ writeAttestation: undefined });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|writeAttestation/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 2, "both verdicts are written before the attestation step");
  assert.equal(deps.readVerdict.calls(), 2, "both verdicts are read+verified before the attestation step");
  assert.equal(deps.port.promoteNote.calls(), 0);
});

test("runD11Ceremony REFUSES when writeAttestation throws — promote never called", async () => {
  const deps = happyDeps({
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
  const deps = happyDeps({ port: undefined });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /fail-closed|port/i);
  assert.equal(result.localOnly, true);
  assert.equal(deps.writeVerdict.calls(), 2);
  assert.equal(deps.readVerdict.calls(), 2);
  assert.equal(deps.writeAttestation.calls(), 1);
});

test("runD11Ceremony REFUSES when the port throws (unreachable) — never a silent success", async () => {
  const deps = happyDeps();
  deps.port.promoteNote = countingFn(async () => {
    throw new Error("ECONNREFUSED");
  });
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, false);
  assert.match(result.outcome.reason, /unreachable/i);
  assert.equal(result.localOnly, true);
});

// ---------------------------------------------------------------------------
// Happy path — the full composition, end to end, with REAL Ed25519 signatures.
// ---------------------------------------------------------------------------

test("runD11Ceremony happy path: 2 distinct GO legs, real signatures verified against the trusted keystore → promote called once with the READ, verified evidence", async () => {
  const deps = happyDeps();
  const result = await ceremony({ note: NOTE, authorId: AUTHOR_ID }, deps);

  assert.deepEqual(result.outcome, { promoted: true, id: NOTE.noteId });
  assert.equal(result.localOnly, false);

  assert.equal(deps.launchLeg.calls(), 2, "both legs are launched");
  assert.equal(deps.writeVerdict.calls(), 2, "both verdicts are written");
  assert.equal(deps.readVerdict.calls(), 2, "both verdicts are read back and verified");
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

  // The evidence handed to promoteNote carries the REFS the injected writers
  // returned — not the raw objects (a locator, not JSON).
  const [promotedNoteId, evidence, ctx] = deps.port.promoteNote.args()[0];
  assert.equal(promotedNoteId, NOTE.noteId);
  assert.equal(evidence.leg1_verdict_ref, "verdict-ref:1");
  assert.equal(evidence.leg2_verdict_ref, "verdict-ref:2");
  assert.equal(evidence.independence_attestation, "attestation-ref:1");
  assert.deepEqual(ctx, CTX);
});

test("runD11Ceremony happy path is order-agnostic on distinctModels/distinctSessions for two DIFFERENT sessions but the SAME model, with real signatures", async () => {
  const sameModel = "shared-model-x";
  const keyA = keypair();
  const keyB = keypair();
  const legA = leg(sameModel, "session-same-A");
  const legB = leg(sameModel, "session-same-B");
  const keystore = keystoreFrom([
    [legA, keyA.publicKeyPem],
    [legB, keyB.publicKeyPem]
  ]);
  const sameModelCeremony = createD11Ceremony({ trustedKeystore: keystore });

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

  const deps = happyDeps({ legSpecs: [legA, legB], writeVerdict, readVerdict });
  const result = await sameModelCeremony({ note: NOTE, authorId: AUTHOR_ID }, deps);
  assert.equal(result.outcome.promoted, true);
  const [writtenAttestation] = deps.writeAttestation.args()[0];
  assert.equal(writtenAttestation.distinctModels, false, "same model on both legs — not distinct");
  assert.equal(writtenAttestation.distinctSessions, true, "distinct sessions still make the legs independent");
});
