import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_NHI_EXPORT_KEY_USE,
  nhiKeyFingerprint,
  nhiSpiffeId,
  nhiTrustBundle
} from "../dist/index.js";

test("nhiSpiffeId builds a spec-valid spiffe:// URI", () => {
  assert.equal(
    nhiSpiffeId("example.org", "worker"),
    "spiffe://example.org/worker"
  );
});

test("nhiSpiffeId encodes h2a instance-id chars outside the SPIFFE path set", () => {
  // `:` -> `.` and `~` -> `--` so the path is legal [a-zA-Z0-9._-].
  assert.equal(nhiSpiffeId("example.org", "claude:p1"), "spiffe://example.org/claude.p1");
  assert.equal(
    nhiSpiffeId("example.org", "claude:p1~reader"),
    "spiffe://example.org/claude.p1--reader"
  );
});

test("nhiSpiffeId rejects an empty or invalid trust domain", () => {
  assert.throws(() => nhiSpiffeId("", "worker"), /invalid trust domain/);
  // Uppercase host is not allowed by SPIFFE-ID.md (host MUST be lowercase).
  assert.throws(() => nhiSpiffeId("Example.org", "worker"), /invalid trust domain/);
  // Spaces / illegal chars rejected.
  assert.throws(() => nhiSpiffeId("ex ample", "worker"), /invalid trust domain/);
});

test("nhiTrustBundle emits a JWKS-shaped bundle, one key entry per active key", () => {
  const bundle = nhiTrustBundle({
    instance: "claude:p1",
    trustDomain: "example.org",
    activeKeys: ["KEY-A", "KEY-B"]
  });

  assert.equal(bundle.trust_domain, "example.org");
  // spiffe_id matches the standalone mapping (composability).
  assert.equal(bundle.spiffe_id, nhiSpiffeId("example.org", "claude:p1"));

  assert.equal(bundle.keys.length, 2);
  const a = bundle.keys[0];
  assert.equal(a.kid, nhiKeyFingerprint("KEY-A"));
  assert.equal(a.kty, "OKP");
  assert.equal(a.h2a_public_key_pem, "KEY-A");
  assert.equal(a.h2a_use, H2A_NHI_EXPORT_KEY_USE);
  // Honest tag: NOT a real SVID use value.
  assert.notEqual(a.h2a_use, "x509-svid");
  assert.notEqual(a.h2a_use, "jwt-svid");

  // Optional SPIFFE fields are absent unless supplied.
  assert.equal(bundle.spiffe_sequence, undefined);
  assert.equal(bundle.spiffe_refresh_hint, undefined);
});

test("nhiTrustBundle yields an empty (well-formed) bundle for no active keys", () => {
  const bundle = nhiTrustBundle({
    instance: "codex:p2",
    trustDomain: "example.org",
    activeKeys: []
  });
  assert.deepEqual(bundle.keys, []);
  assert.equal(bundle.spiffe_id, "spiffe://example.org/codex.p2");
});

test("nhiTrustBundle includes spiffe_sequence/refresh_hint only when supplied", () => {
  const bundle = nhiTrustBundle({
    instance: "worker",
    trustDomain: "example.org",
    activeKeys: ["K"],
    sequence: 7,
    refreshHint: 300
  });
  assert.equal(bundle.spiffe_sequence, 7);
  assert.equal(bundle.spiffe_refresh_hint, 300);
});

test("nhiTrustBundle is deterministic and carries no private material", () => {
  const args = {
    instance: "claude:p1",
    trustDomain: "example.org",
    activeKeys: ["PUBLIC-PEM-1"]
  };
  const a = nhiTrustBundle(args);
  const b = nhiTrustBundle(args);
  assert.deepEqual(a, b);
  // The PEM present is the public key (a trust bundle's purpose); ensure nothing
  // resembling a private key sneaks in.
  const json = JSON.stringify(a);
  assert.ok(!json.includes("PRIVATE"));
});
