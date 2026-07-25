// Part B of the session-exposure feed contract (ratified 2026-07-24, amended
// 2026-07-25, SIGNED-COMPOSITE amendment 2026-07-25): h2a's side of the
// principal↔agent enrollment ceremony.
//
// What these tests are FOR, stated once so nothing here drifts into decoration:
//
//   The 39-auth PRINCIPAL is the authorizing authority. h2a's whole part is to
//   prove control of the agent's ed25519 key over a challenge the gateway
//   issued. A valid signature proves AUTHORSHIP, never AUTHORIZATION — and now
//   that the signature covers `instance` too, SIGNED is still not AUTHORIZED.
//   So the properties worth pinning are (a) a well-formed challenge yields a
//   proof the gateway's own verifier accepts, (b) every field the proof carries
//   is signed and every tamper is REJECTED, (c) the proof leaks nothing and the
//   agent never receives a principal id, (d) the ceremony always proves the key
//   that is LIVE — never one named by a recorded id — and (e) nothing here can
//   reach a network or mint a binding.
//
// Every test is offline. The one transport seam is injected; there is no default
// implementation to accidentally hit.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertKeyIsLocallyActive,
  assertSignableEnrollmentChallenge,
  buildEnrollmentProof,
  createLocalStore,
  enrollmentProofSignedPayload,
  listUnusablePrivateKeys,
  runCli,
  runEnrollmentCeremony,
  sanitizeEnrollmentChallenge,
  signCanonical,
  signEnrollmentChallenge,
  verifyCanonical,
  verifyEnrollmentProof,
  verifyReclaimProof,
  H2A_ENROLLMENT_CHALLENGE_KEYS,
  H2A_ENROLLMENT_MAX_NONCE_LENGTH,
  H2A_ENROLLMENT_NONCE_MAX_BITS,
  H2A_ENROLLMENT_NONCE_MAX_LENGTH,
  H2A_ENROLLMENT_NONCE_MIN_BITS,
  H2A_ENROLLMENT_NONCE_MIN_LENGTH,
  H2A_ENROLLMENT_NONCE_PATTERN,
  H2A_ENROLLMENT_PROOF_TYPE
} from "../dist/index.js";

/** A realistic gateway nonce: 32 random bytes, base64url, 43 chars. */
function gatewayNonce() {
  return randomBytes(32).toString("base64url");
}

const NONCE = gatewayNonce();
const PRINCIPAL_SUB = "auth39|owner-42";

/** A keypair + instance, with no filesystem involved at all. */
function fakeIdentity(instance = "claude:test:0001") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    instance,
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

/**
 * A real store root + workspace. The workspace sits under a randomly-named
 * parent that acts as the BAIT for the opacity assertions: that parent path is
 * the "filesystem path" the proof must never carry. The workspace's own
 * basename is a separate matter — see the documented-limit test.
 */
function scratch() {
  const parent = mkdtempSync(join(tmpdir(), "h2a-enroll-private-clients-"));
  const cwd = join(parent, "acme-merger");
  mkdirSync(cwd);
  return {
    parent,
    cwd,
    root: join(parent, ".h2a"),
    cleanup: () => rmSync(parent, { recursive: true, force: true })
  };
}

/**
 * Force a distinct provider conversation id, which is the identity stability
 * unit since the 2026-06-07 re-anchor. Changing it is exactly what a re-anchor
 * looks like to `resolveLiveIdentity`.
 */
function withConversation(id, fn) {
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = id;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previous;
  }
}

// ---------------------------------------------------------------------------
// (a) A well-formed challenge yields a proof the GATEWAY'S verifier accepts.
// ---------------------------------------------------------------------------

test("a well-formed challenge yields a proof the gateway's verifier accepts", () => {
  const identity = fakeIdentity();
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });

  // This is literally the gateway's check, Part B flow step 5b as amended:
  // verifyCanonical over the COMPOSITE, not over the bare nonce.
  assert.equal(
    verifyCanonical(enrollmentProofSignedPayload(proof), proof.signature, proof.publicKeyPem),
    true,
    "the gateway's own verification of the proof must pass"
  );
  // And through the shared helper, so both lanes verify the same bytes.
  assert.equal(verifyEnrollmentProof(proof), true);

  assert.equal(proof.nonce, NONCE, "the nonce is echoed verbatim");
  assert.equal(proof.instance, identity.instance);
  assert.equal(proof.publicKeyPem, identity.publicKeyPem);
  assert.equal(proof.signature.alg, "ed25519");
  assert.equal(proof.signature.by, identity.instance);
});

test("the proof carries EXACTLY the fields of Part B step 4, as amended", () => {
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity: fakeIdentity() });
  assert.deepEqual(
    Object.keys(proof).sort(),
    ["instance", "nonce", "publicKeyPem", "signature", "type"],
    "any extra field is a new contract term; any missing field breaks the gateway"
  );
  assert.deepEqual(Object.keys(proof.signature).sort(), ["alg", "by", "value"]);
});

// ---------------------------------------------------------------------------
// DOMAIN SEPARATION: the proof attests WHAT IT IS, not only what it carries.
// ---------------------------------------------------------------------------

test("the proof carries a VERSIONED type tag, and it is INSIDE the signed payload", () => {
  // "Attest everything you carry" is only content-completeness. Attesting content
  // while leaving the message type unstated is how cross-protocol attacks work:
  // signature valid, content honest, interpretation attacker-chosen.
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity: fakeIdentity() });
  assert.equal(proof.type, "h2a-enrollment-proof-v1");
  assert.equal(proof.type, H2A_ENROLLMENT_PROOF_TYPE);
  assert.match(proof.type, /-v\d+$/, "the tag must be VERSIONED, or it defers the same problem");

  // THE composition constraint: the tag must be covered by the same mechanism as
  // every other field. A tag carried but excluded from the signed payload would
  // be an unsigned field asserting the message's own identity — the worst
  // possible field to leave unsigned, and worse than no tag at all.
  const payload = enrollmentProofSignedPayload(proof);
  assert.ok("type" in payload, "the tag must be inside the spread source");
  assert.equal(payload.type, H2A_ENROLLMENT_PROOF_TYPE);
});

test("rewriting the type tag breaks verification", () => {
  const identity = fakeIdentity();
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  // A signature over a payload claiming a different type is a valid signature
  // over a DIFFERENT message. Both the tag check and the crypto must refuse it.
  const retyped = { ...proof, type: "h2a-enrollment-proof-v2" };
  assert.equal(verifyEnrollmentProof(retyped), false, "a v2 proof must not pass a v1 verifier");
  assert.equal(
    verifyCanonical(
      enrollmentProofSignedPayload(retyped),
      proof.signature,
      proof.publicKeyPem
    ),
    false,
    "and the signature itself does not cover the rewritten tag"
  );
  // Dropping the tag entirely is refused too.
  const { type: _dropped, ...untagged } = proof;
  assert.equal(verifyEnrollmentProof(untagged), false);
});

test("a VALIDLY SIGNED v2 proof is refused by the v1 verifier", () => {
  // THE case the explicit tag check exists for, and the only one — found because a
  // mutation that disabled that check was NOT caught by the tests above.
  //
  // Rewriting a tag on a finished proof is already caught by the crypto (the
  // signature no longer matches). What the crypto CANNOT catch is a proof that is
  // correctly signed over a DIFFERENT version: the signature is perfectly valid
  // over its own payload, and only a verifier that reads the tag can refuse it.
  // Without that, a v2 proof would be silently reinterpreted as v1 — which is
  // exactly what versioning the tag is supposed to prevent.
  const identity = fakeIdentity();
  const v2Payload = {
    type: "h2a-enrollment-proof-v2",
    nonce: NONCE,
    instance: identity.instance,
    publicKeyPem: identity.publicKeyPem
  };
  const signature = signCanonical(v2Payload, {
    by: identity.instance,
    privateKeyPem: identity.privateKeyPem
  });
  // The signature is genuinely valid over its own payload — nothing is forged.
  assert.equal(
    verifyCanonical(v2Payload, signature, identity.publicKeyPem),
    true,
    "the v2 proof is honestly signed; that is what makes this the interesting case"
  );
  // And the v1 verifier refuses it anyway.
  assert.equal(
    verifyEnrollmentProof({ ...v2Payload, signature }),
    false,
    "a validly signed v2 proof must not be reinterpreted as v1"
  );
});

// ---------------------------------------------------------------------------
// (b) THE amendment: a proof must attest to everything it carries.
// ---------------------------------------------------------------------------

test("the signature covers EVERY field the proof carries except itself", () => {
  // Documentation of a rule that is now STRUCTURAL rather than asserted:
  // `enrollmentProofSignedPayload` is a rest-spread removing exactly one field,
  // so coverage is what the code does, not a list kept in step. Kept because it
  // states the intent and costs nothing.
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity: fakeIdentity() });
  const carried = Object.keys(proof)
    .filter((key) => key !== "signature")
    .sort();
  const covered = Object.keys(enrollmentProofSignedPayload(proof)).sort();
  assert.deepEqual(
    covered,
    carried,
    "every carried field must be signed; if a field does not deserve signing, remove it from the proof"
  );
});

test("STRUCTURAL: an unsigned extra field on a proof cannot be made to verify", () => {
  // The rest-spread's real payoff, and the reason this holds with every test
  // deleted: signing sees the unsigned view and verification RE-DERIVES it from
  // the finished proof, so a field carried but not signed makes the two disagree.
  // There is no way to smuggle an unsigned field past the verifier.
  const identity = fakeIdentity();
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  assert.equal(verifyEnrollmentProof(proof), true);

  const smuggled = { ...proof, capabilities: ["admin"] };
  assert.equal(
    verifyEnrollmentProof(smuggled),
    false,
    "an extra field is covered by the re-derived payload, so it cannot ride along unsigned"
  );
  // And the extra field really is in the derived payload — coverage is automatic,
  // not enumerated.
  assert.ok(
    Object.keys(enrollmentProofSignedPayload(smuggled)).includes("capabilities"),
    "the rest-spread must pick up a field nobody listed"
  );
});

test("the signed payload strips the signature and NOTHING else", () => {
  const identity = fakeIdentity();
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  const payload = enrollmentProofSignedPayload(proof);
  assert.ok(!("signature" in payload), "the signature is the one field a signature cannot cover");
  // Passing the unsigned view and the full proof must derive the SAME bytes —
  // that identity is what makes sign-time and verify-time agree.
  assert.deepEqual(payload, enrollmentProofSignedPayload(payload));
});

test("each signed field is cryptographically covered — tampering ANY of them fails", () => {
  const identity = fakeIdentity();
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  const payload = enrollmentProofSignedPayload(proof);
  const other = fakeIdentity("codex:someone-else:0002");

  const tampers = {
    type: "h2a-enrollment-proof-v2",
    nonce: gatewayNonce(),
    instance: "claude:attacker-chosen:9999",
    publicKeyPem: other.publicKeyPem
  };
  for (const [field, value] of Object.entries(tampers)) {
    assert.notEqual(value, payload[field], `${field}: the tamper must actually change the value`);
    assert.equal(
      verifyCanonical({ ...payload, [field]: value }, proof.signature, identity.publicKeyPem),
      false,
      `tampering ${field} must break verification — otherwise it is not really signed`
    );
  }
});

test("a TAMPERED NONCE fails verification", () => {
  const identity = fakeIdentity();
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  const tampered = { ...proof, nonce: gatewayNonce() };
  assert.notEqual(tampered.nonce, proof.nonce);
  assert.equal(
    verifyEnrollmentProof(tampered),
    false,
    "a signature over one nonce must not verify over another"
  );
});

test("a TAMPERED PAYLOAD (signature value) fails verification", () => {
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity: fakeIdentity() });
  // Flip one bit of the signature — the smallest possible tamper.
  const raw = Buffer.from(proof.signature.value, "base64");
  raw[0] ^= 0xff;
  const tampered = {
    ...proof,
    signature: { ...proof.signature, value: raw.toString("base64") }
  };
  assert.notEqual(tampered.signature.value, proof.signature.value);
  assert.equal(verifyEnrollmentProof(tampered), false, "a mutated signature must not verify");
});

test("a MISMATCHED KEY fails verification", () => {
  const identity = fakeIdentity();
  const other = fakeIdentity("codex:someone-else:0002");
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  assert.notEqual(other.publicKeyPem, proof.publicKeyPem);
  assert.equal(
    verifyCanonical(enrollmentProofSignedPayload(proof), proof.signature, other.publicKeyPem),
    false,
    "a proof must not verify against another agent's key"
  );
});

test("the ceremony refuses to emit a proof it cannot verify itself", () => {
  // A private key paired with someone else's public key: the gateway would see
  // this as indistinguishable from an attack, so it must fail HERE, locally.
  const a = fakeIdentity();
  const b = fakeIdentity();
  assert.throws(
    () =>
      signEnrollmentChallenge({
        challenge: { nonce: NONCE },
        identity: {
          instance: a.instance,
          privateKeyPem: a.privateKeyPem,
          publicKeyPem: b.publicKeyPem
        }
      }),
    /does not verify against its own public key/
  );
});

test("REGRESSION: an enrollment signature can never satisfy verifyReclaimProof", () => {
  // The signing-oracle collision, eliminated BY CONSTRUCTION rather than by a
  // refusal. `keys prove-control` signs a caller-supplied value with the identity
  // key, and the reclaim proof-of-possession signs a fully DERIVABLE string
  // (`identity-reclaim:<instance>:<sha256(pubPem)[0..16]>`) with the same
  // primitive. Signing the bare nonce made a byte-identical forgery possible;
  // signing an OBJECT makes it impossible, because canonicalize type-tags a
  // string differently from an object.
  //
  // There is deliberately NO guard against this in the source: a guard that
  // cannot fire is the defect this work spent its time finding. The property is
  // proved here instead.
  const identity = fakeIdentity();
  const fingerprint = createHash("sha256")
    .update(identity.publicKeyPem, "utf8")
    .digest("hex")
    .slice(0, 16);
  const reclaimMessage = `identity-reclaim:${identity.instance}:${fingerprint}`;

  // Hand the derivable reclaim message in as the nonce. It is not base64url, so
  // the shape check refuses it outright — the first line of defence.
  assert.throws(
    () => signEnrollmentChallenge({ challenge: { nonce: reclaimMessage }, identity }),
    /not base64url/
  );

  // And even if the shape check did not exist, the signature could not forge a
  // PoP, because the signed payload is an object and the reclaim message is a
  // string.
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  assert.equal(
    verifyReclaimProof(reclaimMessage, proof.signature, [identity.publicKeyPem]),
    false,
    "an enrollment signature must never satisfy the reclaim proof-of-possession"
  );
  // Belt and braces: the composite serialized as a string also fails, so no
  // re-encoding of the payload turns into a valid PoP either.
  assert.equal(
    verifyReclaimProof(JSON.stringify(enrollmentProofSignedPayload(proof)), proof.signature, [
      identity.publicKeyPem
    ]),
    false
  );
});

// ---------------------------------------------------------------------------
// Challenge validation: narrowing only, and the nonce shape stated POSITIVELY.
// ---------------------------------------------------------------------------

test("an empty or missing nonce is refused", () => {
  assert.throws(() => assertSignableEnrollmentChallenge({ nonce: "" }, 1000), /carries no nonce/);
  assert.throws(() => assertSignableEnrollmentChallenge({}, 1000), /carries no nonce/);
});

test("the nonce is accepted by POSITIVE SHAPE, not by being under a bound", () => {
  // A negative bound accepts everything not yet excluded; a positive shape
  // accepts only what was specified. So these are refused for FAILING THE SHAPE,
  // not for having been enumerated as bad.
  // VALUE-PINNING, not behaviour-pinning — same limitation, same annotation as in
  // THE BRACKET below (ceil(257 / 6) is also 43, so a 256→257 edit is bit-identical
  // and is caught only because the constant is asserted directly). Annotated here too
  // so no instance of it is left for a reader to mistake for behavioural coverage.
  assert.equal(H2A_ENROLLMENT_NONCE_MIN_BITS, 256);
  assert.equal(H2A_ENROLLMENT_NONCE_MIN_LENGTH, 43, "ceil(256 / 6) base64url chars");
  assert.ok(H2A_ENROLLMENT_NONCE_PATTERN.test(gatewayNonce()));

  // Right length, wrong alphabet: standard base64 (`+`/`=`), free text, a URL,
  // JSON, and a message borrowed from another protocol.
  for (const bad of [
    "abcd+efghijklmnopqrstuvwxyz0123456789ABCDEFGH=",
    "the quick brown fox jumps over the lazy dog and then some",
    "https://gateway.example/challenge/abcdefghijklmnopqrstuvwxyz012345",
    '{"nonce":"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"}',
    "identity-reclaim:claude:acme-merger:0123456789abcdef0123"
  ]) {
    assert.ok(
      bad.length >= H2A_ENROLLMENT_NONCE_MIN_LENGTH,
      `${bad}: long enough that only the shape can be the reason`
    );
    assert.throws(
      () => assertSignableEnrollmentChallenge({ nonce: bad }, 1000),
      /not base64url/,
      `must refuse a non-base64url nonce: ${bad}`
    );
  }
});

test("THE BRACKET: a floor that protects strength, a ceiling that does not claim to", () => {
  // Four bounds, each with a stated purpose. The floor and the ceiling are
  // different parameters and must not be read as one: the floor speaks about
  // strength, the ceiling only says "beyond this it is not a nonce".
  // VALUE-PINNING, NOT BEHAVIOUR-PINNING — the FLOOR carries EXACTLY the same
  // limitation as the ceiling below, annotated identically because an un-annotated
  // instance of a known limitation is worse than an annotated one: the annotation is
  // the only thing stopping the next reader inferring behavioural coverage from a
  // green line. A 256→257 edit is bit-identical in behaviour (ceil(257 / 6) is also
  // 43), so it is caught here ONLY because the declared value is asserted directly.
  // That pin is wanted: the declared security parameter is what the architect ruled
  // on and a silent edit to it should be visible. It is not behavioural coverage.
  assert.equal(H2A_ENROLLMENT_NONCE_MIN_BITS, 256, "floor: security-bearing");
  assert.equal(H2A_ENROLLMENT_NONCE_MIN_LENGTH, 43, "derived: ceil(256 / 6)");
  // VALUE-PINNING, NOT BEHAVIOUR-PINNING — read this green for what it is. A
  // 1024→1025 edit is bit-identical in behaviour (ceil(1025 / 6) is also 171), so
  // it is caught here ONLY because the declared value is asserted directly. That
  // pin is wanted: the stated security parameter is what the architect ruled on and
  // a silent edit to it should be visible. It is not behavioural coverage.
  assert.equal(H2A_ENROLLMENT_NONCE_MAX_BITS, 1024, "ceiling: SANITY, not security");
  assert.equal(H2A_ENROLLMENT_NONCE_MAX_LENGTH, 171, "derived: ceil(1024 / 6)");
  assert.equal(H2A_ENROLLMENT_MAX_NONCE_LENGTH, 4096, "pre-parse DoS guard only");

  // Under the floor: refused, and the reason is entropy.
  const short = randomBytes(16).toString("base64url"); // 128 bits, 22 chars
  assert.ok(H2A_ENROLLMENT_NONCE_PATTERN.test(short), "correct alphabet, insufficient entropy");
  assert.throws(() => assertSignableEnrollmentChallenge({ nonce: short }, 1000), /under the 43/);

  // THE POINT OF A MINIMUM: a STRONGER nonce than specified is accepted, because
  // the issuer does not exist yet and pinning it to one value would turn their
  // safer choice into our outage. 32B/43ch (the floor), 48B/64ch, 64B/86ch,
  // 128B/171ch (the ceiling exactly) all pass.
  for (const bytes of [32, 48, 64, 128]) {
    const nonce = randomBytes(bytes).toString("base64url");
    assert.ok(nonce.length <= H2A_ENROLLMENT_NONCE_MAX_LENGTH, `${bytes}B fits under the ceiling`);
    assertSignableEnrollmentChallenge({ nonce }, 1000);
  }
  // Arithmetic worth pinning because the comment justifying the ceiling misstated
  // it as 88: a 64-byte nonce is 86 base64url chars, not 88. A 512-bit ceiling
  // derives to ceil(512 / 6) = 86 too, so it would land EXACTLY on such a nonce and
  // ACCEPT it — "512 would reject a 64-byte nonce" was never true. The real
  // objection to 512 is zero margin: the very next byte of issuer entropy, or
  // padding it does not strip, would breach a bound never meant to bound entropy.
  // 1024 buys the margin; the corrected number does not weaken the choice.
  assert.equal(randomBytes(64).toString("base64url").length, 86);
  assert.equal(Math.ceil(512 / 6), 86, "a 512-bit ceiling would sit flush on a 64-byte nonce");

  // Over the ceiling: refused as NOT-A-NONCE, and the message says so explicitly
  // rather than implying an entropy judgement.
  const tooLong = randomBytes(256).toString("base64url"); // 2048 bits, 342 chars
  assert.ok(tooLong.length > H2A_ENROLLMENT_NONCE_MAX_LENGTH);
  assert.throws(
    () => assertSignableEnrollmentChallenge({ nonce: tooLong }, 1000),
    /sanity ceiling/,
    "a ceiling breach is not an entropy complaint"
  );
  assert.throws(
    () => assertSignableEnrollmentChallenge({ nonce: tooLong }, 1000),
    /NOT a statement that less entropy is enough/
  );
});

test("the byte cap is a pre-parse guard, and is separate from the shape", () => {
  const huge = "n".repeat(H2A_ENROLLMENT_MAX_NONCE_LENGTH + 1);
  assert.throws(
    () => assertSignableEnrollmentChallenge({ nonce: huge }, 1000),
    /pre-parse cap/,
    "an oversized blob is dropped before the regex walks it"
  );
});

test("an EXPIRED challenge is refused; a live one is accepted", () => {
  const expiresAt = new Date(10_000).toISOString();
  assert.throws(
    () => assertSignableEnrollmentChallenge({ nonce: NONCE, expiresAt }, 10_001),
    /expired at/
  );
  assertSignableEnrollmentChallenge({ nonce: NONCE, expiresAt }, 9_999);
  // The advisory expiry is also enforced on the signing path itself.
  assert.throws(
    () =>
      signEnrollmentChallenge({
        challenge: { nonce: NONCE, expiresAt },
        identity: fakeIdentity(),
        now: () => 10_001
      }),
    /expired at/
  );
});

test("a non-ISO expiresAt is refused, not ignored", () => {
  assert.throws(
    () => assertSignableEnrollmentChallenge({ nonce: NONCE, expiresAt: "soon" }, 1000),
    /not an ISO-8601 instant/
  );
});

// ---------------------------------------------------------------------------
// (c) The agent never RECEIVES a principal id, and the proof leaks nothing.
// ---------------------------------------------------------------------------

/** Run the verb against a literal challenge document. */
function proveControlWithChallengeJson(json) {
  const { cwd, root, cleanup } = scratch();
  const challengePath = join(cwd, "challenge.json");
  try {
    writeFileSync(challengePath, json, "utf8");
    const streams = captureStreams(cwd);
    const rc = withConversation("enroll-challenge-shape", () =>
      runCli(
        ["keys", "prove-control", "--root", root, "--host", "claude", "--challenge", challengePath],
        streams
      )
    );
    return { rc, stdout: streams.stdoutText, stderr: streams.stderrText };
  } finally {
    cleanup();
  }
}

test("the challenge is an ALLOWLIST: only nonce and expiresAt may appear", () => {
  assert.deepEqual([...H2A_ENROLLMENT_CHALLENGE_KEYS], ["nonce", "expiresAt"]);
  // Directly, on the library path — not only through the CLI.
  assert.throws(
    () => assertSignableEnrollmentChallenge({ nonce: NONCE, extra: 1 }, 1000),
    /unexpected field\(s\) "extra"/
  );
  // Multiple offenders are all named, so the owner fixes the document once.
  assert.throws(
    () => assertSignableEnrollmentChallenge({ nonce: NONCE, a: 1, b: 2 }, 1000),
    /unexpected field\(s\) "a", "b"/
  );
  // The accepted pair is accepted.
  assertSignableEnrollmentChallenge(
    { nonce: NONCE, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    Date.now()
  );
});

test("a challenge carrying a TOP-LEVEL principalSub is REFUSED at receipt", () => {
  // Minimal disclosure beats verified non-retention. The agent signs a nonce; it
  // has no functional need for the principal's identifier, and the gateway
  // already knows which session it issued the nonce to. So the field is refused
  // on the way IN rather than merely proven absent on the way out.
  const { rc, stdout, stderr } = proveControlWithChallengeJson(
    JSON.stringify({ nonce: NONCE, principalSub: PRINCIPAL_SUB })
  );
  assert.equal(rc, 1, "a challenge naming a principal must be refused");
  assert.match(stderr, /unexpected field\(s\) "principalSub"/);
  assert.match(stderr, /MUST NOT be sent to the agent/, "the specific harm is still named");
  assert.equal(stdout, "", "no proof may be emitted for such a challenge");
  assert.ok(!stdout.includes(PRINCIPAL_SUB) && !stderr.includes(PRINCIPAL_SUB));
});

test("a NESTED principalSub is REFUSED — the harm is a principal id reaching the agent", () => {
  // This passed the old top-level blocklist (measured: exit 0, accepted). It does
  // exactly what the amendment forbids — puts a principal id into this process —
  // so a control that lets it through does not cover its own stated harm.
  const { rc, stdout, stderr } = proveControlWithChallengeJson(
    JSON.stringify({ nonce: NONCE, meta: { principalSub: PRINCIPAL_SUB } })
  );
  assert.equal(rc, 1, "a nested principal id must be refused");
  assert.match(stderr, /unexpected field\(s\) "meta"/);
  assert.equal(stdout, "");
  assert.ok(
    !stdout.includes(PRINCIPAL_SUB) && !stderr.includes(PRINCIPAL_SUB),
    "and the value is never echoed back"
  );
});

test("a __proto__-nested principalSub is REFUSED", () => {
  // Also passed the old blocklist: `JSON.parse` defines `"__proto__"` as an OWN
  // property rather than reassigning the prototype, so `"principalSub" in parsed`
  // was false. `Object.keys` sees it, so the allowlist refuses it — without the
  // allowlist having to know that `__proto__` is special.
  const { rc, stdout, stderr } = proveControlWithChallengeJson(
    `{"nonce":"${NONCE}","__proto__":{"principalSub":"${PRINCIPAL_SUB}"}}`
  );
  assert.equal(rc, 1, "a __proto__-nested principal id must be refused");
  assert.match(stderr, /unexpected field\(s\) "__proto__"/);
  assert.equal(stdout, "");
  assert.ok(!stdout.includes(PRINCIPAL_SUB) && !stderr.includes(PRINCIPAL_SUB));
  // Sanity: the prototype was NOT polluted, so the refusal is the only control
  // being tested here and not an accident of prototype semantics.
  assert.equal({}.principalSub, undefined);
});

test("a non-string expiresAt is refused — no place for structure to hide", () => {
  const { rc, stderr } = proveControlWithChallengeJson(
    JSON.stringify({ nonce: NONCE, expiresAt: { principalSub: PRINCIPAL_SUB } })
  );
  assert.equal(rc, 1);
  assert.match(stderr, /expiresAt must be an ISO-8601 STRING/);
});

test("a nonce that is not a string is refused, so it cannot smuggle structure", () => {
  assert.throws(
    () => assertSignableEnrollmentChallenge({ nonce: { principalSub: PRINCIPAL_SUB } }, 1000),
    /carries no nonce/
  );
});

test("the allowlist uses OWN KEYS, not `in`, so an inherited name is not mistaken for a field", () => {
  // `in` walks the prototype chain and would ask the wrong question in both
  // directions. This challenge inherits `nonce` from its prototype and has none of
  // its own: `"nonce" in challenge` is true, `Object.keys` is empty. The allowlist
  // must see the truth, which is that there is no nonce here.
  const inherited = Object.create({ nonce: NONCE, principalSub: PRINCIPAL_SUB });
  assert.ok("nonce" in inherited, "the trap: `in` would say there is a nonce");
  assert.deepEqual(Object.keys(inherited), [], "but it carries nothing of its own");
  assert.throws(
    () => assertSignableEnrollmentChallenge(inherited, 1000),
    /carries no nonce/,
    "an inherited nonce is not a carried nonce"
  );
});

test("an INHERITED expiresAt is not a carried field either — the same rule, generalised", () => {
  // THE GENERALISATION THE FIRST FIX MISSED, and the reviewer's exact reproduction.
  // `nonce` was guarded with `Object.hasOwn`; `expiresAt` was still read THROUGH the
  // prototype chain by the validator, and the sanitizer copied the inherited value
  // IN as an own field. An allowlist is only as strong as the accessor the consumer
  // uses after it, and a rule applied to one of two allowlisted fields is a habit
  // rather than a guarantee.
  const future = new Date(Date.now() + 600_000).toISOString();
  const withInheritedExpiry = (expiresAt) => {
    const challenge = Object.create({ expiresAt });
    challenge.nonce = NONCE;
    return challenge;
  };

  // The trap, stated explicitly: the allowlist sees only `nonce`, while plain
  // property access happily reads the inherited value.
  const trap = withInheritedExpiry(future);
  assert.deepEqual(Object.keys(trap), ["nonce"], "it carries only a nonce");
  assert.equal(trap.expiresAt, future, "the trap: property access reads through the chain");
  assert.equal(Object.hasOwn(trap, "expiresAt"), false, "but it is not a carried field");

  // THE FIX. This is the assertion that failed before it: the inherited value was
  // copied in and `Object.hasOwn(clean, "expiresAt")` came back true.
  const clean = sanitizeEnrollmentChallenge(withInheritedExpiry(future), Date.now());
  assert.equal(
    Object.hasOwn(clean, "expiresAt"),
    false,
    "an inherited expiresAt must NOT be copied in as an own field"
  );
  assert.deepEqual(Object.keys(clean), ["nonce"], "only carried fields survive sanitize");

  // The challenge is ACCEPTED, because `expiresAt` is optional: a field the document
  // does not carry is ABSENT, not invalid. `nonce` is required, so an inherited one
  // is an error instead — the same rule, a different obligation.
  assertSignableEnrollmentChallenge(withInheritedExpiry(future), Date.now());

  // THE TWO INPUTS THAT FLIPPED — framed as the carriage rule, which is how they must
  // be read, because this is the line a future auditor will try to "restore". NOT
  // "used to refuse, now accepts": an inherited field is not carried, therefore not
  // present, so the behaviour FOLLOWS FROM THE CARRIAGE RULE and is not a special case
  // for expiresAt. An inherited PAST expiresAt (once refused as expired) and an
  // inherited non-string expiresAt (once refused as not an instant) are both simply
  // absent now. The old refusal was the validator acting on a field the allowlist says
  // is not there — the same divergence, pointing the other way.
  //
  // RESTORING THE REFUSAL MEANS REINTRODUCING A SECOND READER: to refuse an inherited
  // value you must first read it through the chain. You cannot say "I never read
  // inherited fields, except to reject them" without being two readers again.
  //
  // Security check, on the record because the flip is toward acceptance: agent-side
  // expiry is ADVISORY and the gateway remains the TTL authority (Part B flow step
  // 5a); suppressing the advisory check requires ALREADY controlling the challenge
  // object, and the authoritative server-side check is unaffected. One bypassable
  // defence-in-depth layer against a party who already owns the input, traded for
  // eliminating an entire defect class. Full argument at the field in ceremony.ts.
  assertSignableEnrollmentChallenge(
    withInheritedExpiry(new Date(Date.now() - 600_000).toISOString()),
    Date.now()
  );
  assertSignableEnrollmentChallenge(withInheritedExpiry(12_345), Date.now());

  // A CARRIED expiry is still honoured in both directions — the fix narrows what is
  // read, not what an actual expiry means.
  assertSignableEnrollmentChallenge({ nonce: NONCE, expiresAt: future }, Date.now());
  assert.throws(
    () =>
      assertSignableEnrollmentChallenge(
        { nonce: NONCE, expiresAt: new Date(1000).toISOString() },
        2000
      ),
    /expired at/,
    "a carried expiry is still enforced"
  );
});

test("the SIGNED nonce is read off the sanitized copy, not off the caller's object", () => {
  // Validation and consumption must read ONE object. Signing used to read
  // `input.challenge.nonce`, which was own only because the validator had already
  // rejected an inherited nonce — correct by ORDERING, not by construction. It now
  // reads the null-prototype copy, so no ordering can reintroduce the divergence.
  const identity = fakeIdentity();
  const challenge = Object.create({ expiresAt: new Date(Date.now() + 600_000).toISOString() });
  challenge.nonce = NONCE;

  const proof = signEnrollmentChallenge({ challenge, identity, now: () => Date.now() });
  assert.equal(proof.nonce, NONCE, "the carried nonce is what got signed");
  assert.ok(verifyEnrollmentProof(proof), "and the proof still verifies");
  // The inherited field reached neither the proof nor the signed payload.
  assert.deepEqual(
    Object.keys(enrollmentProofSignedPayload(proof)).sort(),
    ["instance", "nonce", "publicKeyPem", "type"],
    "no inherited field can ride into the signed payload"
  );
});

test("VALIDATE-THEN-REREAD is a TOCTOU: the nonce is read ONCE and the read value is signed", () => {
  // This is what makes "read off the sanitized copy" a BEHAVIOUR rather than a
  // structural nicety. Own-ness alone does not make a field stable: an own
  // ENUMERABLE GETTER passes `Object.keys` and `Object.hasOwn` and can still answer
  // differently on a second read. So a validator that checks the caller's object and
  // a signer that re-reads it are checking one value and signing another — a nonce
  // that would have been REFUSED gets signed, with a perfectly valid signature over
  // it. Reading once into the null-prototype copy is what closes that window.
  //
  // Not reachable from a `JSON.parse` document (which has only plain data
  // properties); this pins the read-once discipline on the library path.
  const identity = fakeIdentity();
  const REFUSABLE = "!!not-base64url-and-far-too-short!!";
  let reads = 0;
  const challenge = {};
  Object.defineProperty(challenge, "nonce", {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return reads === 1 ? NONCE : REFUSABLE;
    }
  });

  // The trap is real: the allowlist and the own-ness check both accept this object.
  assert.deepEqual(Object.keys(challenge), ["nonce"]);
  assert.ok(Object.hasOwn(challenge, "nonce"));

  const proof = signEnrollmentChallenge({ challenge, identity, now: () => Date.now() });
  assert.equal(reads, 1, "the challenge nonce is read exactly ONCE, then never again");
  assert.equal(proof.nonce, NONCE, "what was validated is what was signed");
  assert.notEqual(proof.nonce, REFUSABLE, "a second-read value must never reach the proof");
  assert.ok(verifyEnrollmentProof(proof));

  // And the same object sanitized yields a STABLE plain value, not a live getter.
  reads = 0;
  const clean = sanitizeEnrollmentChallenge(challenge, Date.now());
  assert.equal(clean.nonce, NONCE);
  assert.equal(clean.nonce, NONCE, "re-reading the sanitized copy cannot change the answer");
  assert.equal(
    Object.getOwnPropertyDescriptor(clean, "nonce").get,
    undefined,
    "the copy holds a value, not an accessor"
  );
});

test("sanitizeEnrollmentChallenge returns a FRESH null-prototype object", () => {
  // Refuse-the-rest means refuse; what flows onward is then a new object with no
  // prototype, so a parsed document's own `"__proto__"` key can never propagate
  // past this boundary even if some future caller spreads the result.
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const clean = sanitizeEnrollmentChallenge({ nonce: NONCE, expiresAt }, Date.now());
  assert.equal(Object.getPrototypeOf(clean), null, "no prototype at all");
  assert.deepEqual(Object.keys(clean).sort(), ["expiresAt", "nonce"]);
  assert.equal(clean.nonce, NONCE);
  assert.equal(clean.expiresAt, expiresAt);

  // Absent optional stays absent — not defaulted to undefined-as-a-key.
  const minimal = sanitizeEnrollmentChallenge({ nonce: NONCE }, Date.now());
  assert.deepEqual(Object.keys(minimal), ["nonce"]);

  // And it refuses, rather than quietly dropping, anything outside the allowlist.
  assert.throws(
    () => sanitizeEnrollmentChallenge({ nonce: NONCE, meta: { principalSub: PRINCIPAL_SUB } }, 1),
    /unexpected field\(s\) "meta"/
  );
});

test("a well-formed challenge document is accepted and its proof verifies", () => {
  const { cwd, root, cleanup } = scratch();
  const challengePath = join(cwd, "challenge.json");
  try {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    writeFileSync(challengePath, JSON.stringify({ nonce: NONCE, expiresAt }), "utf8");
    const streams = captureStreams(cwd);
    const rc = withConversation("enroll-challenge-doc", () =>
      runCli(
        ["keys", "prove-control", "--root", root, "--host", "claude", "--challenge", challengePath],
        streams
      )
    );
    assert.equal(rc, 0, streams.stderrText);
    const envelope = JSON.parse(streams.stdoutText);
    assert.equal(verifyEnrollmentProof(envelope.proof), true);
    assert.deepEqual(envelope.signedFields, ["instance", "nonce", "publicKeyPem", "type"]);
  } finally {
    cleanup();
  }
});

test("the serialized proof carries no private key material and no filesystem path", () => {
  const { parent, cwd, root, cleanup } = scratch();
  try {
    const built = withConversation("enroll-opacity-1", () =>
      buildEnrollmentProof({ root, host: "claude", cwd, challenge: { nonce: NONCE } })
    );
    const serialized = JSON.stringify(built.proof);

    // The bait is REAL: the resolver genuinely read this directory tree to
    // resolve the identity, and the keypair genuinely lives under this root.
    assert.ok(!serialized.includes(parent), "the proof leaked the enclosing directory path");
    assert.ok(!serialized.includes(cwd), "the proof leaked the workspace path");
    assert.ok(!serialized.includes(root), "the proof leaked the store root");
    assert.ok(!serialized.includes("private-clients"), "the proof leaked a path fragment");
    assert.ok(!serialized.includes("/keys/"), "the proof leaked a key path");
    assert.ok(!serialized.includes("BEGIN PRIVATE KEY"), "the proof leaked a private key");

    // No path separator in any field that is not key material. (The PEM and the
    // base64 signature legitimately contain `/`, so they are excluded rather
    // than the assertion being weakened to nothing.)
    const nonKeyFields = JSON.stringify({
      nonce: built.proof.nonce,
      instance: built.proof.instance,
      by: built.proof.signature.by
    });
    assert.ok(!nonKeyFields.includes("/"), "a non-key field carries a path separator");

    // And byte-for-byte against the actual private key on disk.
    const keyFile = readdirSync(join(root, "keys")).find((f) => f.endsWith(".key.pem"));
    assert.ok(keyFile, "expected the ceremony to have resolved a real keypair on disk");
    const privateKeyPem = readFileSync(join(root, "keys", keyFile), "utf8");
    assert.ok(!serialized.includes(privateKeyPem.trim()), "the proof leaked the private key PEM");

    // The PUBLIC key is supposed to be there — that is the point of the proof.
    assert.ok(built.proof.publicKeyPem.includes("BEGIN PUBLIC KEY"));
  } finally {
    cleanup();
  }
});

test("DOCUMENTED LIMIT: the instance id carries the workspace LABEL, never a path", () => {
  // Stated rather than discovered. An instance id is `<host>:<label>:<uuid>`,
  // and the label is the host-native session name or the workspace basename. Part
  // A's opacity boundary permits exactly that — "never a filesystem path beyond a
  // human LABEL" — and `instanceId` is already a feed field. But it IS free text
  // the owner controls, so a consumer must escape it like any user content
  // (joint plan §9), and it is why the assertions above bait the enclosing PATH
  // rather than the basename.
  const { parent, cwd, root, cleanup } = scratch();
  try {
    const built = withConversation("enroll-label-1", () =>
      buildEnrollmentProof({ root, host: "claude", cwd, challenge: { nonce: NONCE } })
    );
    assert.match(built.proof.instance, /^claude:acme-merger:[0-9a-f]+$/);
    assert.ok(
      built.proof.instance.includes("acme-merger"),
      "the label is present — that is the documented limit, not a defect"
    );
    assert.ok(!built.proof.instance.includes(parent), "but never the enclosing path");
    assert.ok(!built.proof.instance.includes(cwd), "and never the full workspace path");
  } finally {
    cleanup();
  }
});

test("the CLI STDOUT envelope is path-free — it exists to be pasted into a browser", () => {
  // SCOPED TO STDOUT on purpose. stderr legitimately prints absolute paths (the
  // unusable-key warning names a key file, and `warnIfCwdRootFallback` names two
  // roots) — that is diagnostic output for the owner's own terminal, not the
  // artifact anyone copies. The copyable artifact is stdout.
  const { cwd, root, cleanup } = scratch();
  try {
    const streams = captureStreams(cwd);
    const rc = withConversation("enroll-cli-1", () =>
      runCli(
        ["keys", "prove-control", "--root", root, "--host", "claude", "--nonce", NONCE],
        streams
      )
    );
    assert.equal(rc, 0, streams.stderrText);
    const envelope = JSON.parse(streams.stdoutText);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.proof.nonce, NONCE);
    assert.equal(verifyEnrollmentProof(envelope.proof), true);
    // A mint is never silent, even on the happy path.
    assert.equal(envelope.identityAction, "mint");
    // "Not attempted" is an established fact from an explicit branch, not a
    // defaulted absence: h2a ships no transport at all.
    assert.deepEqual(envelope.submission, {
      attempted: false,
      reason: "no-transport-configured"
    });
    assert.match(envelope.authority, /SIGNED IS NOT AUTHORIZED/);

    const out = streams.stdoutText;
    assert.ok(!out.includes(cwd), "the CLI envelope leaked the workspace path");
    assert.ok(!out.includes(root), "the CLI envelope leaked the store root");
    assert.ok(!out.includes("BEGIN PRIVATE KEY"), "the CLI envelope leaked a private key");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// (d) RE-ENROLLMENT. The operationally important half: the previously enrolled
//     key is stale (agents re-anchored), so the ceremony must prove the key
//     that is LIVE NOW, and must never fall back on a recorded id.
// ---------------------------------------------------------------------------

test("after a re-anchor the ceremony proves the CURRENT key, not the recorded one", () => {
  const { cwd, root, cleanup } = scratch();
  try {
    // First enrollment, conversation A.
    const first = withConversation("re-anchor-conversation-A", () =>
      buildEnrollmentProof({ root, host: "claude", cwd, challenge: { nonce: NONCE } })
    );
    const store = createLocalStore({ root });
    const firstKeys = store.listInstanceKeys(first.instance);
    assert.equal(firstKeys.length, 1, "expected the first ceremony to register one key");

    // The re-anchor: same machine, same workspace, NEW provider conversation —
    // which is the identity stability unit since 2026-06-07. A new instance is
    // minted with a new keypair, and the old one stays recorded in the registry.
    const second = withConversation("re-anchor-conversation-B", () =>
      buildEnrollmentProof({ root, host: "claude", cwd, challenge: { nonce: NONCE } })
    );

    assert.notEqual(
      second.instance,
      first.instance,
      "the re-anchor must produce a different live instance for this test to mean anything"
    );
    const secondKeys = store.listInstanceKeys(second.instance);
    assert.deepEqual(secondKeys, [second.proof.publicKeyPem]);
    assert.notEqual(second.proof.publicKeyPem, first.proof.publicKeyPem);

    // THE property: the second proof is for the CURRENT key.
    assert.equal(
      verifyEnrollmentProof(second.proof),
      true,
      "the re-enrollment proof must verify against the live key"
    );
    // And it is NOT the stale key — this is the 401 that step 3 exists to kill.
    assert.equal(
      verifyCanonical(
        enrollmentProofSignedPayload(second.proof),
        second.proof.signature,
        firstKeys[0]
      ),
      false,
      "the re-enrollment proof must NOT verify against the pre-re-anchor key"
    );
    // Now that `instance` is signed, a stale id cannot even be swapped in
    // afterwards without breaking the signature.
    assert.equal(
      verifyEnrollmentProof({ ...second.proof, instance: first.instance }),
      false,
      "substituting the stale instance must invalidate the proof"
    );

    // The stale id was genuinely available to be picked up and was not: it is
    // still in the registry, with its key still listed active locally.
    assert.ok(store.findInstance(first.instance), "the stale instance is still recorded");
    assert.equal(store.listInstanceKeys(first.instance).length, 1);
    assert.equal(second.proof.instance, second.instance);
    assert.notEqual(second.proof.instance, first.instance);
  } finally {
    cleanup();
  }
});

test("the ceremony surface has NO instance input — a recorded id cannot be passed in", () => {
  // The structural half of the anti-rot rule: there is no parameter to hold a
  // stale id, so no caller can supply one. The CLI enforces the same at its
  // boundary, where an owner might reflexively reach for --instance.
  const { cwd, root, cleanup } = scratch();
  try {
    const streams = captureStreams(cwd);
    const rc = withConversation("enroll-refuse-instance", () =>
      runCli(
        [
          "keys",
          "prove-control",
          "--root",
          root,
          "--host",
          "claude",
          "--nonce",
          NONCE,
          "--instance",
          "claude:stale-from-june:dead"
        ],
        streams
      )
    );
    assert.equal(rc, 1, "an explicit instance override must be refused");
    assert.match(streams.stderrText, /--instance is refused/);
    assert.equal(streams.stdoutText, "", "no proof may be emitted for an overridden identity");
  } finally {
    cleanup();
  }
});

test("a locally revoked key is NEVER the key proved — the ceremony re-anchors instead", () => {
  const { cwd, root, cleanup } = scratch();
  try {
    const first = withConversation("enroll-revoked-1", () =>
      buildEnrollmentProof({ root, host: "claude", cwd, challenge: { nonce: NONCE } })
    );
    // Revoke locally. h2a-side validity is NECESSARY but not sufficient for
    // exposure (the binding governs that, Part B fail-closed item 4) — so a key
    // h2a considers revoked must never be offered up for a NEW binding.
    createLocalStore({ root }).revokeInstanceKey(first.instance, first.proof.publicKeyPem);

    // OBSERVED BEHAVIOUR, pinned: with no active key the reclaim proof
    // (`provesLocalKey`) fails, so live resolution MINTS a fresh identity rather
    // than handing back the revoked one. The ceremony therefore self-heals, and
    // the property that matters holds either way — the proof is never for the
    // revoked key.
    const second = withConversation("enroll-revoked-1", () =>
      buildEnrollmentProof({ root, host: "claude", cwd, challenge: { nonce: NONCE } })
    );
    assert.notEqual(second.instance, first.instance);
    assert.notEqual(second.proof.publicKeyPem, first.proof.publicKeyPem);
    assert.equal(second.identityAction, "mint", "the mint is reported, never silent");
    assert.equal(
      verifyCanonical(
        enrollmentProofSignedPayload(second.proof),
        second.proof.signature,
        first.proof.publicKeyPem
      ),
      false,
      "the revoked key must not be the one proved"
    );
    assert.equal(verifyEnrollmentProof(second.proof), true);
    assert.deepEqual(createLocalStore({ root }).listInstanceKeys(first.instance), []);
  } finally {
    cleanup();
  }
});

test("OBSERVED BEHAVIOUR: a CORRUPTED private key mints a new identity, exit 0", () => {
  // The behaviour that replaces three guards that cannot fire. It is NOT
  // fail-closed: a corrupt, truncated or passphrase-protected private key makes
  // `provesLocalKey` return false, so live resolution mints a fresh identity and
  // the ceremony succeeds on a BRAND-NEW key. The corrupt file is left on disk
  // and the old instance stays listed active.
  //
  // Pinned because it masks tampering, and the mitigation is that it is no longer
  // SILENT: the key file is named on stderr and the mint is reported in the
  // envelope. If this behaviour ever changes, this test must be what notices.
  const { cwd, root, cleanup } = scratch();
  try {
    const first = withConversation("enroll-corrupt-1", () =>
      buildEnrollmentProof({ root, host: "claude", cwd, challenge: { nonce: NONCE } })
    );
    const keyFile = readdirSync(join(root, "keys")).find((f) => f.endsWith(".key.pem"));
    const keyPath = join(root, "keys", keyFile);

    // Corrupt the private key in place, keeping the PEM framing so nothing but a
    // real parse can tell.
    writeFileSync(
      keyPath,
      "-----BEGIN PRIVATE KEY-----\nbm90LWEta2V5LWF0LWFsbA==\n-----END PRIVATE KEY-----\n",
      "utf8"
    );
    assert.deepEqual(
      listUnusablePrivateKeys(root),
      [keyPath],
      "the damaged key must be detectable by path"
    );

    const streams = captureStreams(cwd);
    const rc = withConversation("enroll-corrupt-1", () =>
      runCli(
        ["keys", "prove-control", "--root", root, "--host", "claude", "--nonce", NONCE],
        streams
      )
    );
    // Exit 0 — this is the surprising part, and it is the pinned part.
    assert.equal(rc, 0, streams.stderrText);
    const envelope = JSON.parse(streams.stdoutText);
    assert.notEqual(envelope.instance, first.instance, "a DIFFERENT identity was minted");
    assert.notEqual(envelope.publicKeyFingerprint, first.publicKeyFingerprint);
    assert.equal(envelope.identityAction, "mint");
    assert.equal(verifyEnrollmentProof(envelope.proof), true, "and it verifies under its own key");

    // The mitigation: not silent. The bad file is named, on stderr.
    assert.match(streams.stderrText, /WARNING — private key at/);
    assert.ok(streams.stderrText.includes(keyPath), "the warning must name the unusable key path");

    // And the corrupt file is still there, untouched — the ceremony repaired
    // nothing, it worked around it.
    assert.ok(statSync(keyPath).isFile());
    assert.deepEqual(listUnusablePrivateKeys(root), [keyPath]);
  } finally {
    cleanup();
  }
});

test("listUnusablePrivateKeys reports nothing on a healthy or absent store", () => {
  const { cwd, root, cleanup } = scratch();
  try {
    // No keys directory yet: an EXPLICIT empty, meaning "there is no key
    // directory", not a defaulted absence.
    assert.deepEqual(listUnusablePrivateKeys(root), []);
    withConversation("enroll-healthy-1", () =>
      buildEnrollmentProof({ root, host: "claude", cwd, challenge: { nonce: NONCE } })
    );
    assert.deepEqual(listUnusablePrivateKeys(root), [], "a healthy keypair is not reported");

    // A passphrase-protected key cannot sign unattended, so it IS reported.
    const { privateKey } = generateKeyPairSync("ed25519");
    const encrypted = privateKey
      .export({
        format: "pem",
        type: "pkcs8",
        cipher: "aes-256-cbc",
        passphrase: "hunter2"
      })
      .toString();
    const encPath = join(root, "keys", "claude-passphrased.key.pem");
    writeFileSync(encPath, encrypted, "utf8");
    chmodSync(encPath, 0o600);
    assert.deepEqual(listUnusablePrivateKeys(root), [encPath]);
  } finally {
    cleanup();
  }
});

test("assertKeyIsLocallyActive refuses an empty keyring and a non-member key", () => {
  // The guard behind the revoked path. Exercised directly because live resolution
  // mints around it, and an unexercised fail-closed check is a decoration.
  const key = fakeIdentity().publicKeyPem;
  const other = fakeIdentity().publicKeyPem;
  assert.throws(
    () => assertKeyIsLocallyActive({ instance: "claude:x:1", publicKeyPem: key, activeKeys: [] }),
    /NO active key in the local registry/
  );
  assert.throws(
    () =>
      assertKeyIsLocallyActive({
        instance: "claude:x:1",
        publicKeyPem: key,
        activeKeys: [other]
      }),
    /not active in the local registry/
  );
  // The one accepting case: the key IS listed.
  assertKeyIsLocallyActive({
    instance: "claude:x:1",
    publicKeyPem: key,
    activeKeys: [other, key]
  });
});

// ---------------------------------------------------------------------------
// (e) No network, and no binding store.
// ---------------------------------------------------------------------------

test("with no injected transport the ceremony sends nothing, and says so", async () => {
  const identity = fakeIdentity();
  const result = await runEnrollmentCeremony({
    root: "/unused",
    host: "claude",
    cwd: "/unused",
    challenge: { nonce: NONCE },
    resolveIdentityImpl: () => identity
  });
  assert.deepEqual(result.submission, { attempted: false, reason: "no-transport-configured" });
  assert.equal(verifyEnrollmentProof(result.proof), true);
});

test("the transport is an INJECTED seam and receives the proof unchanged", async () => {
  const identity = fakeIdentity();
  const sent = [];
  const result = await runEnrollmentCeremony({
    root: "/unused",
    host: "claude",
    cwd: "/unused",
    challenge: { nonce: NONCE },
    resolveIdentityImpl: () => identity,
    submitImpl: async (proof) => {
      sent.push(proof);
      return { bindingId: "opaque-minted-by-sentropic" };
    }
  });
  assert.equal(sent.length, 1, "the injected submitter must be the only transport");
  assert.deepEqual(sent[0], result.proof);
  assert.deepEqual(result.submission, {
    attempted: true,
    response: { bindingId: "opaque-minted-by-sentropic" }
  });
  // Nothing on the submit path names a principal either.
  assert.ok(!JSON.stringify(sent[0]).includes(PRINCIPAL_SUB));
});

test("the ceremony writes NO binding record anywhere under the root", () => {
  // The binding is sentropic's to own and store — h2a has no concept of a
  // 39-auth principal, so a local binding store would be h2a asserting an
  // authority it does not have. Nothing under the root may mention the nonce.
  const { cwd, root, cleanup } = scratch();
  try {
    withConversation("enroll-no-binding-store", () =>
      buildEnrollmentProof({ root, host: "claude", cwd, challenge: { nonce: NONCE } })
    );
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(root);
    assert.ok(files.length > 0, "expected the ceremony to have touched the identity store");
    for (const path of files) {
      const content = readFileSync(path, "utf8");
      assert.ok(
        !content.includes(PRINCIPAL_SUB),
        `${path} recorded a 39-auth principal — h2a must own no binding`
      );
      assert.ok(!content.includes(NONCE), `${path} recorded the gateway nonce`);
    }
  } finally {
    cleanup();
  }
});
