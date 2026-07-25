// Part B of the session-exposure feed contract (ratified 2026-07-24, amended
// 2026-07-25): h2a's side of the principal↔agent enrollment ceremony.
//
// What these tests are FOR, stated once so nothing here drifts into decoration:
//
//   The 39-auth PRINCIPAL is the authorizing authority. h2a's whole part is to
//   prove control of the agent's ed25519 key over a challenge the gateway
//   issued. A valid signature proves AUTHORSHIP, never AUTHORIZATION. So the
//   properties worth pinning are (a) a well-formed challenge yields a proof the
//   gateway's own verifier accepts, (b) every tamper is REJECTED, (c) the proof
//   leaks nothing, (d) the ceremony always proves the key that is LIVE — never
//   one named by a recorded id — and (e) nothing here can reach a network or
//   mint a binding.
//
// Every test is offline. The one transport seam is injected; there is no default
// implementation to accidentally hit.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertKeyIsLocallyActive,
  assertSignableEnrollmentChallenge,
  buildEnrollmentProof,
  createLocalStore,
  runCli,
  runEnrollmentCeremony,
  signEnrollmentChallenge,
  verifyCanonical,
  H2A_ENROLLMENT_MAX_NONCE_LENGTH
} from "../dist/index.js";

const NONCE = "gw-nonce-3f9c1a7e5b2d40c8";
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

test("a well-formed challenge yields a proof verifyCanonical accepts", () => {
  const identity = fakeIdentity();
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });

  // This is literally the gateway's check, Part B flow step 5b.
  assert.equal(
    verifyCanonical(proof.nonce, proof.signature, proof.publicKeyPem),
    true,
    "the gateway's own verification of the proof must pass"
  );
  assert.equal(proof.nonce, NONCE, "the nonce is echoed verbatim");
  assert.equal(proof.instance, identity.instance);
  assert.equal(proof.publicKeyPem, identity.publicKeyPem);
  assert.equal(proof.signature.alg, "ed25519");
  assert.equal(proof.signature.by, identity.instance);
});

test("the proof carries EXACTLY the four fields of Part B step 4", () => {
  const proof = signEnrollmentChallenge({
    challenge: { nonce: NONCE, principalSub: PRINCIPAL_SUB },
    identity: fakeIdentity()
  });
  assert.deepEqual(
    Object.keys(proof).sort(),
    ["instance", "nonce", "publicKeyPem", "signature"],
    "any extra field is a new contract term; any missing field breaks the gateway"
  );
  assert.deepEqual(Object.keys(proof.signature).sort(), ["alg", "by", "value"]);
});

test("a principalSub on the challenge NEVER reaches the proof", () => {
  // h2a cannot verify a 39-auth principal, so no payload of h2a's may appear to
  // assert one. Authorization is the gateway's lookup, not a field we ship.
  const proof = signEnrollmentChallenge({
    challenge: { nonce: NONCE, principalSub: PRINCIPAL_SUB },
    identity: fakeIdentity()
  });
  assert.ok(
    !JSON.stringify(proof).includes(PRINCIPAL_SUB),
    "the proof must not carry a principal claim"
  );
});

// ---------------------------------------------------------------------------
// (b) Every tamper is REJECTED. One property per test, so the failure names
//     which property broke.
// ---------------------------------------------------------------------------

test("a TAMPERED NONCE fails verification", () => {
  const identity = fakeIdentity();
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  const tampered = `${NONCE}x`;
  assert.notEqual(tampered, proof.nonce);
  assert.equal(
    verifyCanonical(tampered, proof.signature, proof.publicKeyPem),
    false,
    "a signature over one nonce must not verify over another"
  );
});

test("a TAMPERED PAYLOAD (signature value) fails verification", () => {
  const identity = fakeIdentity();
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  // Flip one base64 character of the signature — the smallest possible tamper.
  const raw = Buffer.from(proof.signature.value, "base64");
  raw[0] ^= 0xff;
  const tampered = { ...proof.signature, value: raw.toString("base64") };
  assert.notEqual(tampered.value, proof.signature.value);
  assert.equal(
    verifyCanonical(proof.nonce, tampered, proof.publicKeyPem),
    false,
    "a mutated signature must not verify"
  );
});

test("a MISMATCHED KEY fails verification", () => {
  const identity = fakeIdentity();
  const other = fakeIdentity("codex:someone-else:0002");
  const proof = signEnrollmentChallenge({ challenge: { nonce: NONCE }, identity });
  assert.notEqual(other.publicKeyPem, proof.publicKeyPem);
  assert.equal(
    verifyCanonical(proof.nonce, proof.signature, other.publicKeyPem),
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
        identity: { instance: a.instance, privateKeyPem: a.privateKeyPem, publicKeyPem: b.publicKeyPem }
      }),
    /does not verify against its own public key/
  );
});

// ---------------------------------------------------------------------------
// Challenge validation: narrowing only. It can refuse a signature, never grant.
// ---------------------------------------------------------------------------

test("an empty or missing nonce is refused", () => {
  assert.throws(() => assertSignableEnrollmentChallenge({ nonce: "" }, 1000), /carries no nonce/);
  assert.throws(() => assertSignableEnrollmentChallenge({}, 1000), /carries no nonce/);
});

test("an oversized nonce is refused rather than signed", () => {
  const huge = "n".repeat(H2A_ENROLLMENT_MAX_NONCE_LENGTH + 1);
  assert.throws(() => assertSignableEnrollmentChallenge({ nonce: huge }, 1000), /refusing to sign/);
  // The bound itself is inclusive.
  assertSignableEnrollmentChallenge({ nonce: "n".repeat(H2A_ENROLLMENT_MAX_NONCE_LENGTH) }, 1000);
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
// (c) The proof leaks nothing: no private key material, no filesystem path.
//     Same discipline as the feed's descriptors, applied to the one output
//     whose whole purpose is to leave the machine.
// ---------------------------------------------------------------------------

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

test("the CLI envelope is path-free too — it exists to be pasted into a browser", () => {
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
    assert.equal(
      verifyCanonical(envelope.proof.nonce, envelope.proof.signature, envelope.proof.publicKeyPem),
      true
    );
    // "Not attempted" is an established fact from an explicit branch, not a
    // defaulted absence: h2a ships no transport at all.
    assert.deepEqual(envelope.submission, {
      attempted: false,
      reason: "no-transport-configured"
    });
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
      verifyCanonical(NONCE, second.proof.signature, second.proof.publicKeyPem),
      true,
      "the re-enrollment proof must verify against the live key"
    );
    // And it is NOT the stale key — this is the 401 that step 3 exists to kill.
    assert.equal(
      verifyCanonical(NONCE, second.proof.signature, firstKeys[0]),
      false,
      "the re-enrollment proof must NOT verify against the pre-re-anchor key"
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
    assert.equal(
      verifyCanonical(NONCE, second.proof.signature, first.proof.publicKeyPem),
      false,
      "the revoked key must not be the one proved"
    );
    assert.equal(verifyCanonical(NONCE, second.proof.signature, second.proof.publicKeyPem), true);
    assert.deepEqual(createLocalStore({ root }).listInstanceKeys(first.instance), []);
  } finally {
    cleanup();
  }
});

test("assertKeyIsLocallyActive refuses an empty keyring and a non-member key", () => {
  // The guard behind the path above. Exercised directly because live resolution
  // mints around it (see the previous test), and an unexercised fail-closed check
  // is a decoration.
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
  assert.equal(verifyCanonical(NONCE, result.proof.signature, identity.publicKeyPem), true);
});

test("the transport is an INJECTED seam and receives the proof unchanged", async () => {
  const identity = fakeIdentity();
  const sent = [];
  const result = await runEnrollmentCeremony({
    root: "/unused",
    host: "claude",
    cwd: "/unused",
    challenge: { nonce: NONCE, principalSub: PRINCIPAL_SUB },
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
  // Even on the submit path, no principal claim is shipped.
  assert.ok(!JSON.stringify(sent[0]).includes(PRINCIPAL_SUB));
});

test("the ceremony writes NO binding record anywhere under the root", () => {
  // The binding is sentropic's to own and store — h2a has no concept of a
  // 39-auth principal, so a local binding store would be h2a asserting an
  // authority it does not have. Nothing under the root may mention the sub.
  const { cwd, root, cleanup } = scratch();
  try {
    withConversation("enroll-no-binding-store", () =>
      buildEnrollmentProof({
        root,
        host: "claude",
        cwd,
        challenge: { nonce: NONCE, principalSub: PRINCIPAL_SUB }
      })
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
        `${path} recorded the 39-auth principal — h2a must own no binding`
      );
      assert.ok(!content.includes(NONCE), `${path} recorded the gateway nonce`);
    }
  } finally {
    cleanup();
  }
});
