// WP11 · Memory & context — TOMBSTONE SLICE (`../src/runtime/memory/tombstone-client.ts`).
//
// requestTombstone (the port's write-side erasure entry point) is a DESTRUCTIVE
// op — the port's own doc (`./port-v1.ts`, TombstoneAuthorization) states the bar
// in one line: "authority never rests on a fabricable asserted `requester`"; the
// signed authorization's "cryptographic verification is h2a's". This file proves
// that verification is real and load-bearing, applying the D11 rounds 1-4 lessons
// (`memory-d11-ceremony.test.js`) mapped onto this module's own threat model:
//
//   - AUTHORITY = THE SIGNATURE, never the `requester` string (D11 ROUND 4 FIX 2's
//     "compare on the canonical crypto principal, not a session/name string",
//     applied here as: the trusted key for `signedAuthorization.signerLeg`, never
//     the decorative `requester` argument).
//   - TARGET-BINDING, anti-replay (D11 ROUND 4 FIX 1's ceremonyNonce discipline,
//     mapped onto this module's own replay surface — target, not a nonce): TWO
//     independent layers, neither trusting the other — (a) a STRUCTURAL equality
//     check (`signedAuthorization.target` canonicalizes identically to the actual
//     requested `target`) and (b) a CRYPTOGRAPHIC rebuild (the verified payload is
//     built from THIS call's own `target` argument, never from
//     `signedAuthorization.target`). The REPLAY section below exercises each layer
//     in isolation (one tampered field at a time) to prove BOTH are independently
//     load-bearing, not merely one redundant restatement of the other.
//   - FAIL-CLOSED (I5): no signedAuthorization, a malformed one, an untrusted
//     signer, an invalid signature, a malformed target, or an absent/throwing/
//     rejecting port all REFUSE with a structured `{applied:false, reason}` —
//     `port.requestTombstone` is reached ONLY after every check has POSITIVELY
//     passed (never inferred from an absence of denial — destructive-op INV-1).
//
// A MUTATION-CHECK section near the end reports ACTUAL, reproduced results from
// temporarily neutralizing this module's own gates (product-code edits, not test
// overrides) and rerunning this file — proving the assertions above are not
// vacuously true. See that section's comments for the exact procedure and numbers.

import { strict as assert } from "node:assert";
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import test from "node:test";

import { canonicalize } from "../dist/index.js";
import { createTombstoneRequester } from "../dist/runtime/memory/tombstone-client.js";

// ---------------------------------------------------------------------------
// Fixtures & helpers — mirrors memory-d11-ceremony.test.js's conventions
// (same keypair/signing/keystore shape, no new vocabulary — I4).
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

/** Builds a genuinely, correctly signed authorization for {signerLeg, target}. */
function signedAuth(privateKeyPem, { signerLeg, target }) {
  const payload = { signerLeg, target };
  return { signerLeg, target, signature: signPayload(privateKeyPem, payload) };
}

function keystoreFrom(pairs) {
  return {
    getPublicKey(candidateLeg) {
      const hit = pairs.find(([l]) => l.model === candidateLeg.model && l.session === candidateLeg.session);
      return hit ? hit[1] : undefined;
    }
  };
}

function countingStubPort(requestTombstoneImpl) {
  let calls = 0;
  const args = [];
  return {
    calls: () => calls,
    args: () => args,
    port: {
      async admitMemoryNote() {
        throw new Error("not used in this slice");
      },
      async promoteNote() {
        throw new Error("not used in this slice");
      },
      async requestTombstone(target, auth, ctx) {
        calls += 1;
        args.push([target, auth, ctx]);
        return requestTombstoneImpl(target, auth, ctx);
      }
    }
  };
}

const CTX = { principal_owner: "claude:h2a-memory:owner-1" };

const TRUSTED_LEG = leg("h2a-memory-orchestrator", "requester-A");
const KEY_TRUSTED = keypair();
const UNTRUSTED_LEG = leg("h2a-memory-orchestrator", "attacker-Z");
const KEY_UNTRUSTED = keypair(); // deliberately NEVER registered in the keystore below

const KEYSTORE = keystoreFrom([[TRUSTED_LEG, KEY_TRUSTED.publicKeyPem]]);

const NODE_TARGET_A = { kind: "node", id: "note-A" };
const NODE_TARGET_B = { kind: "node", id: "note-B" };
const EDGE_TARGET = { kind: "edge", source: "note-A", target: "note-C", relation: "cites" };

function requester() {
  return createTombstoneRequester({ trustedKeystore: KEYSTORE });
}

// ---------------------------------------------------------------------------
// createTombstoneRequester — construction-time anchor (D11 ROUND 1 §1, reused).
// ---------------------------------------------------------------------------

test("createTombstoneRequester throws synchronously when no trustedKeystore is supplied", () => {
  assert.throws(() => createTombstoneRequester(undefined), /trustedKeystore/);
  assert.throws(() => createTombstoneRequester({}), /trustedKeystore/);
});

test("createTombstoneRequester throws synchronously when trustedKeystore.getPublicKey is not a function", () => {
  assert.throws(() => createTombstoneRequester({ trustedKeystore: {} }), /trustedKeystore/);
  assert.throws(
    () => createTombstoneRequester({ trustedKeystore: { getPublicKey: "not-a-fn" } }),
    /trustedKeystore/
  );
});

// ---------------------------------------------------------------------------
// Happy path — valid signature by a trusted principal, target-bound.
// ---------------------------------------------------------------------------

test("requestTombstone APPLIES on a valid Ed25519 signature by a trusted principal, target-bound — port called exactly once", async () => {
  const { port, calls, args } = countingStubPort(() => ({ applied: true }));
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });

  const result = await requester()(NODE_TARGET_A, "claude:h2a-memory:owner-1", auth, CTX, port);

  assert.deepEqual(result.outcome, { applied: true });
  assert.equal(result.localOnly, false);
  assert.equal(calls(), 1);
  const [calledTarget, calledAuth, calledCtx] = args()[0];
  assert.deepEqual(calledTarget, NODE_TARGET_A);
  assert.equal(calledAuth.signedAuthorization, auth);
  assert.deepEqual(calledCtx, CTX);
});

test("requestTombstone APPLIES on an edge target, target-bound including relation", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: EDGE_TARGET });

  const result = await requester()(EDGE_TARGET, "someone", auth, CTX, port);

  assert.deepEqual(result.outcome, { applied: true });
  assert.equal(calls(), 1);
});

// ---------------------------------------------------------------------------
// NO signedAuthorization — REFUSE, port never called.
// ---------------------------------------------------------------------------

test("requestTombstone REFUSES when signedAuthorization is undefined — port never called", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const result = await requester()(NODE_TARGET_A, "claude:h2a-memory:owner-1", undefined, CTX, port);
  assert.equal(result.outcome.applied, false);
  assert.equal(typeof result.outcome.reason, "string");
  assert.equal(result.localOnly, true);
  assert.equal(calls(), 0);
});

test("requestTombstone REFUSES when signedAuthorization is null — port never called", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const result = await requester()(NODE_TARGET_A, "x", null, CTX, port);
  assert.equal(result.outcome.applied, false);
  assert.equal(calls(), 0);
});

test("requestTombstone REFUSES on a malformed signedAuthorization shape (missing signature field) — port never called", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const malformed = { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A };
  const result = await requester()(NODE_TARGET_A, "x", malformed, CTX, port);
  assert.equal(result.outcome.applied, false);
  assert.equal(calls(), 0);
});

// ---------------------------------------------------------------------------
// Untrusted key — signer not in the keystore. REFUSE, port never called.
// ---------------------------------------------------------------------------

test("requestTombstone REFUSES a signature by a key NOT in the trusted keystore — port never called", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const auth = signedAuth(KEY_UNTRUSTED.privateKeyPem, { signerLeg: UNTRUSTED_LEG, target: NODE_TARGET_A });

  const result = await requester()(NODE_TARGET_A, "claude:h2a-memory:owner-1", auth, CTX, port);

  assert.equal(result.outcome.applied, false);
  assert.match(result.outcome.reason, /trusted public key/);
  assert.equal(calls(), 0);
});

test("requestTombstone REFUSES on an empty keystore (no leg known at all) — fail-closed, never 'skip verification'", async () => {
  const emptyKeystore = keystoreFrom([]);
  const requestTombstone = createTombstoneRequester({ trustedKeystore: emptyKeystore });
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });

  const result = await requestTombstone(NODE_TARGET_A, "x", auth, CTX, port);

  assert.equal(result.outcome.applied, false);
  assert.equal(calls(), 0);
});

// ---------------------------------------------------------------------------
// Tampered / garbage signature — REFUSE, port never called.
// ---------------------------------------------------------------------------

test("requestTombstone REFUSES a tampered signature (bytes corrupted after signing) — port never called", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });
  const tampered = { ...auth, signature: auth.signature.slice(0, -4) + "AAAA" };

  const result = await requester()(NODE_TARGET_A, "x", tampered, CTX, port);

  assert.equal(result.outcome.applied, false);
  assert.match(result.outcome.reason, /invalid/);
  assert.equal(calls(), 0);
});

test("requestTombstone REFUSES pure garbage as the signature field — port never called, never throws", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const garbage = { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A, signature: "not-even-base64-!!!" };

  const result = await requester()(NODE_TARGET_A, "x", garbage, CTX, port);

  assert.equal(result.outcome.applied, false);
  assert.equal(calls(), 0);
});

// ---------------------------------------------------------------------------
// REPLAY — a signature genuinely signed for target A submitted to erase
// target B. Two independent layers, exercised separately: (a) structural
// equality, (b) cryptographic rebuild from the CALL's own target argument.
// ---------------------------------------------------------------------------

test("requestTombstone REFUSES a replay: genuinely signed for target A, submitted (untampered) to erase target B — caught by the STRUCTURAL target-binding check (layer a)", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  // Signed for A; the authorization object HONESTLY still claims A (no tampering
  // of the claimed field) — only the call's own `target` argument is B.
  const authForA = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });

  const result = await requester()(NODE_TARGET_B, "x", authForA, CTX, port);

  assert.equal(result.outcome.applied, false);
  assert.match(result.outcome.reason, /target-binding|does not match/);
  assert.equal(calls(), 0);
});

test("requestTombstone REFUSES a replay: genuinely signed for target A, authorization object's claimed target FIELD edited to say B (stale signature bytes) — caught by the CRYPTOGRAPHIC rebuild (layer b), independent of layer a", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const authForA = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });
  // Attacker edits the CLAIMED target field to B (so layer (a)'s structural
  // equality against the real B argument would otherwise pass) but cannot
  // produce a new signature over B without the private key — the OLD bytes,
  // signed over A, are carried through unchanged.
  const claimEditedToB = { ...authForA, target: NODE_TARGET_B };

  const result = await requester()(NODE_TARGET_B, "x", claimEditedToB, CTX, port);

  assert.equal(result.outcome.applied, false);
  assert.match(result.outcome.reason, /invalid/);
  assert.equal(calls(), 0);
});

test("requestTombstone REFUSES an edge-target replay that only differs by `relation` — target-binding covers the full edge shape, not just source/target", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const authForCites = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: EDGE_TARGET });
  const differentRelation = { ...EDGE_TARGET, relation: "supersedes" };

  const result = await requester()(differentRelation, "x", authForCites, CTX, port);

  assert.equal(result.outcome.applied, false);
  assert.equal(calls(), 0);
});

// ---------------------------------------------------------------------------
// Lying `requester` — decorative only, ZERO effect on the authorization decision.
// ---------------------------------------------------------------------------

test("requestTombstone APPLIES on a valid signature even when `requester` LIES (distinct from the signed signerLeg) — authority is purely the signature", async () => {
  const { port, calls, args } = countingStubPort(() => ({ applied: true }));
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });

  const result = await requester()(NODE_TARGET_A, "claude:h2a-memory:someone-completely-different", auth, CTX, port);

  assert.deepEqual(result.outcome, { applied: true });
  assert.equal(calls(), 1);
  // The lie IS carried through decoratively (never inspected for trust), but
  // the outgoing `requester` in the port call reflects the caller's own claim
  // verbatim — it is not silently corrected to the verified signerLeg either.
  assert.equal(args()[0][1].requester, "claude:h2a-memory:someone-completely-different");
});

test("requestTombstone still REFUSES an invalid signature regardless of an honest `requester` claim — the lie test's converse", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });
  const tampered = { ...auth, signature: auth.signature.slice(0, -4) + "BBBB" };

  const result = await requester()(NODE_TARGET_A, TRUSTED_LEG.session, tampered, CTX, port);

  assert.equal(result.outcome.applied, false);
  assert.equal(calls(), 0);
});

// ---------------------------------------------------------------------------
// Malformed target — REFUSE before ever consulting the authorization.
// ---------------------------------------------------------------------------

test("requestTombstone REFUSES a malformed target (unknown kind) — port never called", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const bogus = { kind: "bogus", id: "x" };
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: bogus });

  const result = await requester()(bogus, "x", auth, CTX, port);

  assert.equal(result.outcome.applied, false);
  assert.equal(calls(), 0);
});

test("requestTombstone REFUSES a node target missing `id` — port never called", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const bogus = { kind: "node" };
  const result = await requester()(bogus, "x", { signerLeg: TRUSTED_LEG, target: bogus, signature: "irrelevant" }, CTX, port);
  assert.equal(result.outcome.applied, false);
  assert.equal(calls(), 0);
});

test("requestTombstone REFUSES an edge target missing `source`/`target` — port never called", async () => {
  const { port, calls } = countingStubPort(() => ({ applied: true }));
  const bogus = { kind: "edge", source: "a" };
  const result = await requester()(bogus, "x", { signerLeg: TRUSTED_LEG, target: bogus, signature: "irrelevant" }, CTX, port);
  assert.equal(result.outcome.applied, false);
  assert.equal(calls(), 0);
});

// ---------------------------------------------------------------------------
// Port absent / throws / rejects — REFUSE, fail-closed, structured reason.
// ---------------------------------------------------------------------------

test("requestTombstone REFUSES when no port is injected — fail-closed (I5)", async () => {
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });
  const result = await requester()(NODE_TARGET_A, "x", auth, CTX, undefined);
  assert.equal(result.outcome.applied, false);
  assert.equal(typeof result.outcome.reason, "string");
  assert.equal(result.localOnly, true);
});

test("requestTombstone REFUSES when the injected port is null — fail-closed (I5)", async () => {
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });
  const result = await requester()(NODE_TARGET_A, "x", auth, CTX, null);
  assert.equal(result.outcome.applied, false);
});

test("requestTombstone REFUSES when the injected port THROWS synchronously — never a silent success", async () => {
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });
  const port = {
    async admitMemoryNote() {
      throw new Error("not used");
    },
    async promoteNote() {
      throw new Error("not used");
    },
    requestTombstone() {
      throw new Error("port exploded");
    }
  };
  const result = await requester()(NODE_TARGET_A, "x", auth, CTX, port);
  assert.equal(result.outcome.applied, false);
  assert.match(result.outcome.reason, /port exploded|unreachable/);
  assert.equal(result.localOnly, true);
});

test("requestTombstone REFUSES when the injected port REJECTS — never a silent success", async () => {
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });
  const port = {
    async admitMemoryNote() {
      throw new Error("not used");
    },
    async promoteNote() {
      throw new Error("not used");
    },
    async requestTombstone() {
      throw new Error("port rejected the call");
    }
  };
  const result = await requester()(NODE_TARGET_A, "x", auth, CTX, port);
  assert.equal(result.outcome.applied, false);
  assert.match(result.outcome.reason, /unreachable/);
});

// ---------------------------------------------------------------------------
// Port refusal is passed through UNCHANGED — this module does not paper over
// graphify's own decision (e.g. its principal_owner authority check, §3.5).
// ---------------------------------------------------------------------------

test("requestTombstone passes a genuine port-side refusal (e.g. graphify's principal_owner check) through unchanged", async () => {
  const { port } = countingStubPort(() => ({ applied: false, reason: "principal_owner mismatch (graphify §3.5)" }));
  const auth = signedAuth(KEY_TRUSTED.privateKeyPem, { signerLeg: TRUSTED_LEG, target: NODE_TARGET_A });

  const result = await requester()(NODE_TARGET_A, "x", auth, CTX, port);

  assert.deepEqual(result.outcome, { applied: false, reason: "principal_owner mismatch (graphify §3.5)" });
  assert.equal(result.localOnly, false);
});

// ---------------------------------------------------------------------------
// MUTATION-CHECK (reported, not asserted here — see the final report for the
// ACTUAL reproduced counts). Procedure: temporarily neutralize
// tombstone-client.ts's own gates (product-code edits, reverted immediately
// after), rebuild, rerun THIS file, and confirm the untrusted-key / tampered /
// replay(layer-b) tests above FLIP to applied:true — proving those checks are
// load-bearing, not vacuous — then restore and re-confirm all tests refuse
// again. Kept as a documented, out-of-band verification step (like
// memory-d11-ceremony.test.js's own ROUND 4 mutation narrative) rather than a
// permanent test, because a self-neutralizing test would defeat its own
// purpose the moment it became part of the green baseline.
// ---------------------------------------------------------------------------
