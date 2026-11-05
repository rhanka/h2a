import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  appendJournalEntry,
  computeHash,
  createJournalEntry,
  signCanonical,
  verifyCanonical,
} from "@sentropic/h2a";
import { createLocalStore } from "../dist/index.js";
import { consentPairId, projectConsent } from "../dist/runtime/drive/consent.js";
import { negotiationJournalFile } from "../dist/runtime/local-files/paths.js";
import {
  H2A_AGENT_SESSION_ID,
  authorizeAgentLaunch,
  spawnOnAuthorizedLaunch,
} from "../dist/runtime/governance/agent-launch-seam.js";
import {
  BLOCKED_EXTERNAL,
  buildCaptureFacts,
  buildSourceAssociation,
  evaluateRecordTrust,
  openFactRegistry,
  registerCustody,
  resolveSession,
  signDriveConsentAck,
  verifyRecordShape,
} from "../dist/runtime/governance/authority-native.js";
import {
  assertConsentPair,
  checkBindingRevision,
  openSourceConsentFence,
} from "../dist/runtime/drive/consent-fence.js";

// RC2 B4 `feat/rc2-authority-native` — AUTHORITY-NATIVE + CONSENT-PAIR.
// Fail-closed native authority: no route, no transport, §5 gates stay closed.
// Fixtures: vendored r3 bytes under ../src/fixtures/.../authority-native/.

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(
  HERE,
  "..",
  "src",
  "fixtures",
  "session-content",
  "v3",
  "authority-native",
);
const loadJson = (rel) =>
  JSON.parse(readFileSync(join(FIX, rel)).toString("utf8"));
const sha256Hex = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const loadBytes = (name) =>
  readFileSync(join(FIX, "vectors", name));

const MANIFEST_SHA256 =
  "6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715";
const MANIFEST_JSON_SHA256 =
  "88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565";
// Manifest-record vector hashes (remote-session-contract-manifest.v1.json).
const MANIFEST_VECTOR_SHA256 = {
  "RemoteDriveConsentBindingV1.json":
    "943c3a09b59fd31e79f2de4d4d5e55f6e04cd697f23949f2630d80677df4d961",
  "RemoteDriveConsentAckV1.json":
    "3b94705c6783fee33ab05df285d2a66526607cdccecf3902a5a0a60c354aa111",
  "RemoteSourceAssociationV1.json":
    "fdf788ede22b72f067113f5b0d08cee701092122f7966eb9b1bf984a1651a2bb",
  "SessionCaptureCapabilitiesV1.json":
    "b2ea97551d1472044cb91a54eb70bde7f93d472620d1813fe6045aa1ef995d1e",
  "RoleScopePolicyV1.json":
    "c7464a2cc111dd0ee960178d745bdcccf8ce60feca44e0d3db8ebe783b31db95",
  "RegistryReaderV1.json":
    "89d40ab3db167d63b88928150a73ac3d52bbd453fea8de667875308b9b6a24be",
  "RegistryInstanceViewV1.json":
    "a07552879cdb4439d3904201ac3720751d5209cb5932a497f3e8a3b9993fc90d",
  "SessionAdmissionEvidenceV1.json":
    "81c31e08c6a7505247ed66c5a53632544083915c05c28caeeefc5d7129cbb4d8",
  "RoleAgentAttestationV1.json":
    "0bdbda0284a4f00cc1524d8c57fdaadfd5fff1c0680369aa26bf4962a068a936",
};

test("B4-PIN: r3 pin and every vendored vector byte", () => {
  const pin = loadJson("pin.json");
  assert.equal(pin.format, "h2a.rc2-b4-pin/1");
  assert.equal(pin.revision, "r3");
  assert.equal(pin.manifestSha256, MANIFEST_SHA256);
  assert.equal(pin.manifestJsonSha256, MANIFEST_JSON_SHA256);
  const names = Object.keys(pin.vectors).sort();
  assert.equal(names.length, 19);
  for (const name of names) {
    assert.match(pin.vectors[name], /^[a-f0-9]{64}$/);
    assert.equal(sha256Hex(loadBytes(name)), pin.vectors[name]);
  }
  for (const [name, sha] of Object.entries(MANIFEST_VECTOR_SHA256)) {
    assert.equal(sha256Hex(loadBytes(name)), sha);
    assert.equal(pin.vectors[name], sha);
  }
});

// ---------------------------------------------------------------------------
// CONSENT-PAIR against the real writers + real projectConsent.
// ---------------------------------------------------------------------------

const SCOPE = { action: "drive.instruction", direction: "from->to" };
const A = "pair:a";
const B = "pair:b";

function keys() {
  const k = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: k.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: k.publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

function pairFixture(t, { principal = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rc2-b4-pair-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createLocalStore({ root });
  const ka = keys();
  const kb = keys();
  const kp = keys();
  const now = Date.now();
  const iso = (n) => new Date(n).toISOString();
  store.registerInstance({
    id: A,
    instance: A,
    agentUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    roles: ["AGENTS"],
    scopes: [A],
    capabilities: [],
    endpoints: [],
    publicKeys: [ka.publicKeyPem],
    acceptedPolicies: [],
    createdAt: iso(now),
  });
  store.registerInstance({
    id: B,
    instance: B,
    agentUuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    roles: ["AGENTS"],
    scopes: [B],
    capabilities: [],
    endpoints: [],
    publicKeys: [kb.publicKeyPem],
    ...(principal ? { principal: "pair:principal" } : {}),
    acceptedPolicies: [],
    createdAt: iso(now),
  });
  if (principal) {
    store.registerInstance({
      id: "pair:principal",
      instance: "pair:principal",
      agentUuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      roles: ["PRINCIPAL"],
      scopes: ["shared"],
      capabilities: [],
      endpoints: [],
      publicKeys: [kp.publicKeyPem],
      acceptedPolicies: [],
      createdAt: iso(now),
    });
  }
  return { root, store, ka, kb, kp, now, iso };
}

function bodies(f, { from = A, to = B, created = f.now } = {}) {
  const a = f.store.findInstance(from);
  const b = f.store.findInstance(to);
  const binding = {
    from,
    to,
    ...(a?.agentUuid ? { fromAgentUuid: a.agentUuid } : {}),
    ...(b?.agentUuid ? { toAgentUuid: b.agentUuid } : {}),
  };
  const request = {
    kind: "h2a.drive.consent.request",
    v: 1,
    requestId: "33333333-3333-4333-8333-333333333333",
    ...binding,
    scope: SCOPE,
    createdAt: f.iso(created),
    answerBy: f.iso(created + 900000),
    requestedNotAfter: f.iso(created + 3600000),
  };
  const grant = {
    kind: "h2a.drive.consent.grant",
    v: 1,
    requestId: request.requestId,
    requestHash: computeHash(request),
    ...binding,
    scope: SCOPE,
    notBefore: f.iso(created),
    notAfter: f.iso(created + 3600000),
    issuedAt: f.iso(created),
  };
  return { request, grant };
}

function event(f, payload, key, by) {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    type: payload.kind.endsWith("request")
      ? "propose"
      : payload.kind.endsWith("refusal")
        ? "reject"
        : payload.kind.endsWith("revocation")
          ? "withdraw"
          : "accept",
    actor: { instance: by, role: "AGENTS", scope: "drive-consent" },
    negotiationId: consentPairId(payload.from, payload.to),
    createdAt: f.iso(
      payload.issuedAt
        ? Date.parse(payload.issuedAt)
        : payload.createdAt
          ? Date.parse(payload.createdAt)
          : f.now,
    ),
    body: {
      kind: payload.kind,
      payload,
      signature: signCanonical(payload, { by, privateKeyPem: key.privateKeyPem }),
    },
  };
}

function raw(f, entry) {
  const file = negotiationJournalFile(f.store.paths, entry.negotiationId);
  mkdirSync(join(file, ".."), { recursive: true });
  const entries = f.store.readNegotiationJournal(entry.negotiationId);
  const prev = entries.at(-1);
  appendFileSync(
    file,
    JSON.stringify(prev ? appendJournalEntry(prev, entry) : createJournalEntry(entry)) +
      "\n",
  );
}

function seedPair(f, { coSigned = false } = {}) {
  const p = bodies(f);
  raw(f, event(f, p.request, f.ka, p.request.from));
  const grant = { ...p.grant };
  if (coSigned) grant.principal = "pair:principal";
  const entry = event(f, grant, f.kb, p.grant.to);
  if (coSigned) {
    // Real mechanism (consent-tools cosign): the co-signature sits beside
    // payload/signature in the journal body, over the grant payload.
    entry.body.coSignature = signCanonical(grant, {
      by: "pair:principal",
      privateKeyPem: f.kp.privateKeyPem,
    });
  }
  raw(f, entry);
  return { request: p.request, grant };
}

function project(f, from = A, to = B, now = f.now + 1000) {
  const entries = f.store
    .readNegotiationJournal(consentPairId(from, to))
    .map((e) => e.entry ?? e);
  return projectConsent(f.store, from, to, entries, now);
}

test("CONSENT-PAIR: principal-absent positive against real writers", (t) => {
  const f = pairFixture(t);
  const p = seedPair(f);
  const out = project(f);
  assert.equal(out.decision.ok, true);
  assert.equal(out.decision.via, "consent");
  assert.equal(out.decision.requestId, p.request.requestId);
  assert.equal(out.decision.grantId, computeHash(p.grant));
  assert.equal(out.decision.principalDecision, "principal-absent");
});

test("CONSENT-PAIR: co-signed positive against real writers", (t) => {
  const f = pairFixture(t, { principal: true });
  const p = seedPair(f, { coSigned: true });
  const out = project(f);
  assert.equal(out.decision.ok, true);
  assert.equal(out.decision.principalDecision, "co-signed");
  assert.equal(out.decision.grantId, computeHash(p.grant));
});

test("CONSENT-PAIR: exact selected grant — other positive must not authorize", (t) => {
  const f = pairFixture(t);
  const p1 = bodies(f);
  const request2 = {
    ...p1.request,
    requestId: "55555555-5555-4555-8555-555555555555",
  };
  const grant2 = {
    ...p1.grant,
    requestId: request2.requestId,
    requestHash: computeHash(request2),
  };
  raw(f, event(f, p1.request, f.ka, A));
  raw(f, event(f, request2, f.ka, A));
  raw(f, event(f, grant2, f.kb, B));
  const out = project(f);
  assert.equal(out.decision.ok, true);
  assert.equal(out.decision.requestId, request2.requestId);
  // A binding selected for request 1 is NOT covered by the projection.
  assert.deepEqual(
    assertConsentPair(
      { requestId: out.decision.requestId, grantId: out.decision.grantId },
      { requestId: p1.request.requestId, grantId: computeHash(p1.grant) },
    ),
    { ok: false, reason: "pair_mismatch" },
  );
  assert.deepEqual(
    assertConsentPair(
      { requestId: out.decision.requestId, grantId: out.decision.grantId },
      { requestId: request2.requestId, grantId: computeHash(grant2) },
    ),
    { ok: true },
  );
});

test("CONSENT-PAIR: substituted executor refuses", (t) => {
  const f = pairFixture(t);
  const p = bodies(f);
  const forged = {
    ...p.request,
    fromAgentUuid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  };
  raw(f, event(f, forged, f.ka, A));
  raw(f, event(f, p.grant, f.kb, B));
  assert.equal(project(f).decision.ok, false);
});

test("CONSENT-PAIR: substituted human refuses", (t) => {
  const f = pairFixture(t);
  const p = bodies(f);
  const forged = {
    ...p.request,
    toAgentUuid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  };
  raw(f, event(f, forged, f.ka, A));
  raw(f, event(f, p.grant, f.kb, B));
  assert.equal(project(f).decision.ok, false);
});

test("CONSENT-PAIR: missing journal refuses", (t) => {
  const f = pairFixture(t);
  const out = projectConsent(f.store, A, B, [], f.now + 1000);
  assert.equal(out.decision.ok, false);
});

test("CONSENT-PAIR: scope mismatch refuses", (t) => {
  const f = pairFixture(t);
  const p = bodies(f);
  const offScope = { ...p.request, scope: { action: "other", direction: "from->to" } };
  raw(f, event(f, offScope, f.ka, A));
  assert.equal(project(f).decision.ok, false);
});

test("CONSENT-PAIR: grant hash mismatch refuses", (t) => {
  const f = pairFixture(t);
  const p = bodies(f);
  raw(f, event(f, p.request, f.ka, A));
  raw(f, event(f, { ...p.grant, requestHash: computeHash({ other: 1 }) }, f.kb, B));
  const out = project(f);
  assert.equal(out.decision.ok, false);
});

test("CONSENT-PAIR: expired grant refuses", (t) => {
  const f = pairFixture(t);
  seedPair(f);
  const out = project(f, A, B, f.now + 7200000);
  assert.deepEqual(out.decision, { ok: false, reason: "consent-expired" });
});

test("CONSENT-PAIR: grant committed at answerBy refuses", (t) => {
  const f = pairFixture(t);
  const p = bodies(f);
  raw(f, event(f, p.request, f.ka, A));
  const late = {
    ...event(f, p.grant, f.kb, B),
    createdAt: f.iso(f.now + 900000),
  };
  raw(f, late);
  assert.equal(project(f).decision.ok, false);
});

test("CONSENT-PAIR: missing principal co-signature refuses", (t) => {
  const f = pairFixture(t, { principal: true });
  const p = bodies(f);
  raw(f, event(f, p.request, f.ka, A));
  raw(
    f,
    event(f, { ...p.grant, principal: "pair:principal" }, f.kb, B),
  );
  const out = project(f);
  assert.deepEqual(out.decision, {
    ok: false,
    reason: "consent-principal-unavailable",
  });
});

test("CONSENT-PAIR: conflicting grants refuse", (t) => {
  const f = pairFixture(t);
  const p = bodies(f);
  raw(f, event(f, p.request, f.ka, A));
  raw(f, event(f, p.grant, f.kb, B));
  raw(
    f,
    event(
      f,
      { ...p.grant, notAfter: f.iso(f.now + 1800000) },
      f.kb,
      B,
    ),
  );
  const out = project(f);
  assert.deepEqual(out.decision, { ok: false, reason: "consent-invalid" });
});

function revoke(f, p, by, key, pair = false) {
  const payload = pair
    ? {
        kind: "h2a.drive.consent.revocation",
        v: 1,
        from: A,
        to: B,
        pair: true,
        requestId: p.request.requestId,
        requestHash: computeHash(p.request),
        at: f.iso(f.now + 500),
        notAfter: f.iso(f.now + 3600000),
      }
    : {
        kind: "h2a.drive.consent.revocation",
        v: 1,
        from: A,
        to: B,
        requestId: p.request.requestId,
        requestHash: computeHash(p.request),
        at: f.iso(f.now + 500),
      };
  raw(f, event(f, payload, key, by));
}

test("CONSENT-PAIR: pair revocation overrides a positive", (t) => {
  const f = pairFixture(t);
  const p = seedPair(f);
  revoke(f, p, B, f.kb, true);
  const out = project(f);
  assert.deepEqual(out.decision, { ok: false, reason: "consent-revoked" });
});

test("CONSENT-PAIR: request refusal wins", (t) => {
  const f = pairFixture(t);
  const p = bodies(f);
  raw(f, event(f, p.request, f.ka, A));
  raw(
    f,
    event(
      f,
      {
        kind: "h2a.drive.consent.refusal",
        v: 1,
        from: A,
        to: B,
        requestId: p.request.requestId,
        requestHash: computeHash(p.request),
        at: f.iso(f.now + 500),
      },
      f.kb,
      B,
    ),
  );
  const out = project(f);
  assert.deepEqual(out.decision, { ok: false, reason: "consent-refused" });
});

test("CONSENT-PAIR: withdrawal by either side revokes", (t) => {
  for (const by of [A, B]) {
    const f = pairFixture(t);
    const p = seedPair(f);
    revoke(f, p, by, by === A ? f.ka : f.kb, false);
    const out = project(f);
    assert.deepEqual(out.decision, { ok: false, reason: "consent-revoked" });
  }
});

test("CONSENT-PAIR: r3 vector digests execute (hash, linkage, pair, scope)", () => {
  const v = loadJson("vectors/consent-native-canonical.json");
  assert.equal(v.format, "rc2.native-consent-fixtures/1");
  assert.equal(v.cases.length, 9);
  assert.equal(
    v.scopeDigest,
    computeHash({ action: "drive.instruction", direction: "from->to" }),
  );
  for (const c of v.cases) {
    const reqHashes = new Set();
    for (const e of c.entries) {
      assert.equal(e.negotiationId, v.pairId);
      assert.equal(e.negotiationId, consentPairId("native-from-fixture", "native-to-fixture"));
      const p = e.body.payload;
      if (p.kind === "h2a.drive.consent.request") reqHashes.add(computeHash(p));
    }
    assert.ok(reqHashes.size > 0);
    assert.ok(reqHashes.has(v.requestHash));
    for (const e of c.entries) {
      const p = e.body.payload;
      if (p.kind === "h2a.drive.consent.grant") {
        assert.match(p.requestHash, /^sha256:[a-f0-9]{64}$/);
        assert.ok(reqHashes.has(p.requestHash));
      }
    }
  }
});

test("CONSENT-PAIR: durable sourceConsentRevision fence", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rc2-b4-fence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pairId = consentPairId(A, B);
  const fence = openSourceConsentFence(dir);
  assert.equal(fence.revisionOf(pairId), 0);
  assert.equal(fence.commitSnapshot(pairId, "sha256:aaa"), 1);
  assert.equal(fence.revisionOf(pairId), 1);
  assert.equal(fence.commitSnapshot(pairId, "sha256:aaa"), 1);
  assert.equal(fence.commitSnapshot(pairId, "sha256:bbb"), 2);
  const reopened = openSourceConsentFence(dir);
  assert.equal(reopened.revisionOf(pairId), 2);
  // A/B axes never merge: the other direction has its own counter.
  assert.equal(reopened.revisionOf(consentPairId(B, A)), 0);
  assert.deepEqual(
    checkBindingRevision(
      { pairId, consentRevision: 1, sourceConsentRevision: 2 },
      reopened,
    ),
    { ok: true },
  );
  assert.deepEqual(
    checkBindingRevision(
      { pairId, consentRevision: 1, sourceConsentRevision: 1 },
      reopened,
    ),
    { ok: false, reason: "revision_mismatch" },
  );
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "not a dir");
  assert.throws(() => openSourceConsentFence(join(blocker, "sub")), /fence_unavailable/);
  writeFileSync(join(dir, "source-consent-revisions.json"), "{corrupt");
  assert.throws(() => openSourceConsentFence(dir), /fence_unavailable/);
});

// ---------------------------------------------------------------------------
// AUTHORITY-NATIVE: H-shapes, binding/ack trust, association, capabilities.
// ---------------------------------------------------------------------------

const H_RECORDS = [
  "RoleScopePolicyV1",
  "RegistryReaderV1",
  "RegistryInstanceViewV1",
  "SessionAdmissionEvidenceV1",
  "RoleAgentAttestationV1",
];

test("AUTHORITY-NATIVE: H-shape positives parse, signed bytes stay BLOCKED_EXTERNAL", () => {
  for (const record of H_RECORDS) {
    const v = loadJson(`vectors/${record}.json`);
    for (const p of v.positive) {
      if (p.expect === "ACCEPT_SHAPE") {
        assert.equal(verifyRecordShape(record, p.value), "ACCEPT_SHAPE");
      } else if (p.expect === "BLOCKED_EXTERNAL") {
        assert.equal(
          evaluateRecordTrust(record, p.value, null).verdict,
          "BLOCKED_EXTERNAL",
        );
      } else {
        throw new Error(`unexpected H expectation ${p.expect}`);
      }
    }
    for (const n of v.negative) {
      assert.equal(n.expect, "REJECT_SCHEMA");
      assert.equal(verifyRecordShape(record, n.value), "REJECT_SCHEMA");
    }
  }
});

function testAuthority(issuer, kid) {
  const k = generateKeyPairSync("ed25519");
  const privateKeyPem = k.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = k.publicKey.export({ format: "pem", type: "spki" }).toString();
  return {
    issuer,
    kid,
    knownIssuers: [issuer, "fixture-wrong-purpose-fixture"],
    verify: (body, signature) => {
      if (signature?.alg !== "Ed25519" || typeof signature?.value !== "string") return false;
      try {
        return verifyCanonical(
          body,
          { by: issuer, alg: "ed25519", value: signature.value },
          publicKeyPem,
        );
      } catch {
        return false;
      }
    },
    sign: (body) => ({
      alg: "Ed25519",
      value: signCanonical(body, { by: issuer, privateKeyPem }).value,
    }),
  };
}

for (const record of ["RemoteDriveConsentBindingV1", "RemoteDriveConsentAckV1"]) {
  test(`AUTHORITY-NATIVE: ${record} shape matrix executes`, () => {
    const v = loadJson(`vectors/${record}.json`);
    assert.equal(v.positive.length, 1);
    assert.equal(verifyRecordShape(record, v.positive[0].value), "ACCEPT_SHAPE");
    for (const n of v.negative) {
      if (n.expect === "REJECT_SCHEMA") {
        assert.equal(verifyRecordShape(record, n.value), "REJECT_SCHEMA");
      }
    }
  });

  test(`AUTHORITY-NATIVE: ${record} trust matrix executes`, () => {
    const v = loadJson(`vectors/${record}.json`);
    const auth = testAuthority(
      v.positive[0].value.body.issuer,
      v.positive[0].value.body.kid,
    );
    // No enrolled A authority: every signed byte refuses fail-closed.
    assert.equal(
      evaluateRecordTrust(record, v.positive[0].value, null).verdict,
      "BLOCKED_EXTERNAL",
    );
    const bad = v.negative.find((n) => n.expect === "REJECT_SIGNATURE");
    const role = v.negative.find((n) => n.expect === "REJECT_ROLE");
    assert.equal(evaluateRecordTrust(record, bad.value, auth).verdict, "REJECT_SIGNATURE");
    assert.equal(evaluateRecordTrust(record, role.value, auth).verdict, "REJECT_ROLE");
    // Re-signed by the enrolled test authority: trusted.
    const body = v.positive[0].value.body;
    const resigned = { body, signature: auth.sign(body) };
    assert.equal(verifyRecordShape(record, resigned), "ACCEPT_SHAPE");
    assert.deepEqual(evaluateRecordTrust(record, resigned, auth).verdict, "TRUSTED");
  });
}

test("AUTHORITY-NATIVE: association shapes and producer (U-RC tuple)", () => {
  const v = loadJson("vectors/RemoteSourceAssociationV1.json");
  assert.equal(v.positive.length, 3);
  for (const p of v.positive) {
    assert.equal(p.expect, "ACCEPT_SHAPE");
    assert.equal(verifyRecordShape("RemoteSourceAssociationV1", p.value), "ACCEPT_SHAPE");
  }
  assert.equal(verifyRecordShape("RemoteSourceAssociationV1", v.negative[0].value), "REJECT_SCHEMA");
  const sessionRef = {
    originInstanceId: "pair:b",
    sessionId: "sess-1",
    incarnation: "inc-1",
  };
  const sourceRef = {
    sourceSessionId: "src-1",
    sourceGeneration: 1,
    streamIncarnation: "stream-1",
  };
  const cli = buildSourceAssociation({
    kind: "managed-cli",
    sessionRef,
    sourceRef,
    agentSessionId: "agent-session:abc123",
    decisionDigest: `sha256:${"d".repeat(64)}`,
    bindingDigest: `sha256:${"e".repeat(64)}`,
  });
  assert.equal(verifyRecordShape("RemoteSourceAssociationV1", cli), "ACCEPT_SHAPE");
  assert.equal(cli.originAgentSessionId, "agent-session:abc123");
  assert.equal(cli.childEnvironmentAgentSessionId, "agent-session:abc123");
  const chat = buildSourceAssociation({ kind: "app-chat", sessionRef, sourceRef });
  assert.equal(verifyRecordShape("RemoteSourceAssociationV1", chat), "ACCEPT_SHAPE");
  assert.equal(chat.originAgentSessionId, null);
  assert.equal(chat.childEnvironmentAgentSessionId, null);
});

test("AUTHORITY-NATIVE: capabilities facts gate (no capture before SG-R15)", () => {
  const v = loadJson("vectors/SessionCaptureCapabilitiesV1.json");
  assert.equal(verifyRecordShape("SessionCaptureCapabilitiesV1", v.positive[0].value), "ACCEPT_SHAPE");
  assert.equal(
    verifyRecordShape("SessionCaptureCapabilitiesV1", v.negative[0].value),
    "REJECT_SCHEMA",
  );
  const measured = structuredClone(v.positive[0].value);
  const issued = buildCaptureFacts(measured);
  assert.equal(verifyRecordShape("SessionCaptureCapabilitiesV1", issued), "ACCEPT_SHAPE");
  for (const key of Object.keys(issued)) {
    assert.ok(!/activ|admiss/i.test(key), `no activation key: ${key}`);
  }
  assert.throws(
    () => buildCaptureFacts({ ...measured, activation: { committed: true } }),
    /capture_not_activated/,
  );
});

test("AUTHORITY-NATIVE: resolveSession binds locally, never mints writer bytes", () => {
  const digest = computeHash({ instanceId: "pair:b", pid: 4242, startedAt: "2026-11-01T08:00:00.000Z" });
  const ok = resolveSession({
    processBindingRef: { id: "pb-1", revision: 1, digest },
    localInstanceId: "pair:b",
    pid: 4242,
    startedAt: "2026-11-01T08:00:00.000Z",
    sessionId: "sess-1",
    incarnation: "inc-1",
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.sessionRef, {
    originInstanceId: "pair:b",
    sessionId: "sess-1",
    incarnation: "inc-1",
  });
  for (const key of ["writerEpoch", "originRevision", "projectionDigest"]) {
    assert.ok(!(key in ok), `no writer byte: ${key}`);
  }
  assert.deepEqual(
    resolveSession({
      processBindingRef: { id: "pb-1", revision: 1, digest: "sha256:ffff" },
      localInstanceId: "pair:b",
      pid: 4242,
      startedAt: "2026-11-01T08:00:00.000Z",
      sessionId: "sess-1",
      incarnation: "inc-1",
    }),
    { ok: false, reason: "binding_refused" },
  );
  assert.deepEqual(
    resolveSession({
      processBindingRef: { id: "pb-1", revision: 1, digest },
      localInstanceId: "pair:b",
      pid: 4242,
      startedAt: "2026-11-01T08:00:00.000Z",
      sessionId: "sess-1",
      incarnation: "inc-1",
      originInstanceId: "foreign-origin",
    }),
    { ok: false, reason: "origin_unresolved" },
  );
});

test("AUTHORITY-NATIVE: fact registry is idempotent (no realloc on retry)", () => {
  const reg = openFactRegistry();
  const a = reg.allocFact("pair:b/sess-1", { kind: "started" });
  const b = reg.allocFact("pair:b/sess-1", { kind: "started" });
  assert.deepEqual(a, b);
  assert.equal(reg.allocations, 1);
  const c = reg.allocFact("pair:b/sess-1", { kind: "stopped" });
  assert.equal(c.revision, a.revision + 1);
  assert.equal(reg.allocations, 2);
});

test("AUTHORITY-NATIVE: registry digests pin domains, native mints nothing", () => {
  const v = loadJson("vectors/registry-revision-digests.json");
  assert.equal(v.format, "rc2.registry-digest-vectors/1");
  const domains = new Set(v.positive.map((p) => p.domain));
  assert.ok(domains.has("cluster-mesh.session-listing/1/coarse-v1\0"));
  for (const n of v.negative) assert.equal(n.expected, "digest-mismatch");
  assert.ok(v.activatedSignedSnapshot.body.writerEpoch !== undefined);
  // Writer epoch/revision stay mesh-owned: resolveSession emits neither.
});

const ROUTE_PINS = [
  {
    file: "route-drive-binding-fetch.json",
    routeId: "drive-binding-fetch",
    method: "GET",
    path: "/mesh/v1/remote-sessions/:sessionId/drive-bindings/:bindingId/:consentRevision",
    successStatus: 200,
    body: "zero entity bytes; any entity refuses",
    stage: "bound",
    lane: "lifecycle",
  },
  {
    file: "route-drive-binding-ack.json",
    routeId: "drive-binding-ack",
    method: "POST",
    path: "/mesh/v1/remote-sessions/:sessionId/drive-bindings/:bindingId/:consentRevision/acks",
    successStatus: 200,
    stage: "bound",
    lane: "lifecycle",
  },
  {
    file: "route-listing-grant-fetch.json",
    routeId: "listing-grant-fetch",
    method: "GET",
    path: "/mesh/v1/remote-sessions/:sessionId/listing-grants/:grantId",
    successStatus: 200,
    body: "zero entity bytes; any entity refuses",
    stage: "listing",
    lane: "lifecycle",
  },
  {
    file: "route-listing-grant-ack.json",
    routeId: "listing-grant-ack",
    method: "POST",
    path: "/mesh/v1/remote-sessions/:sessionId/listing-grants/:grantId/acks",
    successStatus: 200,
    stage: "listing",
    lane: "lifecycle",
  },
];

test("AUTHORITY-NATIVE: bilateral route interface pins (no handler implemented)", async () => {
  for (const pin of ROUTE_PINS) {
    const v = loadJson(`vectors/${pin.file}`);
    assert.equal(v.routeId, pin.routeId);
    assert.equal(v.method, pin.method);
    assert.equal(v.path, pin.path);
    assert.equal(v.successStatus, pin.successStatus);
    if (pin.body !== undefined) assert.equal(v.http.body, pin.body);
    assert.ok(v.positive.length > 0);
    assert.ok(v.negative.length > 0);
  }
  const seam = await import("../dist/runtime/governance/agent-launch-seam.js");
  const native = await import("../dist/runtime/governance/authority-native.js");
  const fence = await import("../dist/runtime/drive/consent-fence.js");
  for (const mod of [seam, native, fence]) {
    const routed = Object.keys(mod).filter((k) =>
      /^(handle|serve|route|listen|fetch|connect|tunnel|socket)/i.test(k),
    );
    assert.deepEqual(routed, []);
  }
  const srcDir = join(HERE, "..", "src", "runtime");
  for (const rel of [
    "governance/agent-launch-seam.ts",
    "governance/authority-native.ts",
    "drive/consent-fence.ts",
  ]) {
    const src = readFileSync(join(srcDir, rel)).toString("utf8");
    assert.ok(!/from\s+"node:http"/.test(src), `${rel}: no http server`);
    assert.ok(!/from\s+"node:net"/.test(src), `${rel}: no sockets`);
    assert.ok(!/WebSocket/.test(src), `${rel}: no websocket`);
    assert.ok(!/\bfetch\s*\(/.test(src), `${rel}: no fetch`);
    assert.ok(!/cluster-mesh\/src/.test(src), `${rel}: no mesh source`);
    assert.ok(!/from\s+"@sentropic\/cluster-mesh"/.test(src), `${rel}: no mesh import`);
  }
});

test("AUTHORITY-NATIVE: custody admits caller-held signers only", () => {
  const k = generateKeyPairSync("ed25519");
  const privateKeyPem = k.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const custody = registerCustody({
    role: "native-source",
    issuer: "pair:b-native-source",
    kid: "pair:b-native-source-key",
    signer: (body) => signCanonical(body, { by: "pair:b-native-source", privateKeyPem }),
  });
  assert.equal(custody.role, "native-source");
  assert.match(custody.fingerprint, /^[a-f0-9]{16}$/);
  for (const bad of [
    { role: "native-source", keyFile: "/tmp/k.pem" },
    { role: "native-source", envVar: "NATIVE_KEY" },
    { role: "native-source", privateKeyPem },
  ]) {
    assert.throws(() => registerCustody(bad), /custody_unqualified/);
  }
});

test("AUTHORITY-NATIVE: drive-ACK signer path (enrolled native role only)", () => {
  const v = loadJson("vectors/RemoteDriveConsentAckV1.json");
  const k = generateKeyPairSync("ed25519");
  const privateKeyPem = k.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const custody = registerCustody({
    role: "native-source",
    issuer: "pair:b-native-source",
    kid: "pair:b-native-source-key",
    signer: (body) => signCanonical(body, { by: "pair:b-native-source", privateKeyPem }),
  });
  const body = structuredClone(v.positive[0].value.body);
  body.issuer = "pair:b-native-source";
  body.kid = "pair:b-native-source-key";
  const ack = signDriveConsentAck(custody, body);
  assert.equal(verifyRecordShape("RemoteDriveConsentAckV1", ack), "ACCEPT_SHAPE");
  assert.equal(ack.signature.alg, "Ed25519");
  assert.throws(
    () =>
      signDriveConsentAck(
        { role: "observer", issuer: "x", kid: "y", fingerprint: "0123456789abcdef" },
        body,
      ),
    /source_role_unavailable/,
  );
});

// ---------------------------------------------------------------------------
// LAUNCH: production spawn witnesses (MH-SEAM-ENV).
// ---------------------------------------------------------------------------

function launchRequest() {
  return {
    h2aWorkspaceId: "ws:11111111-1111-4111-8111-111111111111",
    durableWorkspaceIdHint: "ws:dddd",
    realpath: "/tmp/ws",
    instanceId: "pair:b",
    cliKind: "claude",
  };
}

function allowDecision() {
  return {
    allow: true,
    agentSessionId: "agent-session:decided-1",
    policyRevision: "pr-7",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
}

test("LAUNCH: harness-only env fails closed, spawn never runs", async () => {
  let calls = 0;
  const decided = await authorizeAgentLaunch(launchRequest());
  assert.deepEqual(decided, { ok: false, reason: "policy_unavailable" });
  const out = spawnOnAuthorizedLaunch(decided, () => {
    calls += 1;
    return 0;
  }, {});
  assert.deepEqual(out, { ok: false, reason: "policy_unavailable" });
  assert.equal(calls, 0);
});

test("LAUNCH: refusal spawns nothing", async () => {
  let calls = 0;
  const decided = await authorizeAgentLaunch(launchRequest(), () => ({
    allow: false,
    reason: "agent_not_active",
  }));
  assert.deepEqual(decided, {
    ok: true,
    decision: { allow: false, reason: "agent_not_active" },
  });
  const out = spawnOnAuthorizedLaunch(decided, () => {
    calls += 1;
    return 0;
  }, {});
  assert.deepEqual(out, { ok: false, reason: "agent_not_active" });
  assert.equal(calls, 0);
});

test("LAUNCH: allow sets exactly H2A_AGENT_SESSION_ID (caller value overridden)", async () => {
  const seen = [];
  const decided = await authorizeAgentLaunch(launchRequest(), () => allowDecision());
  const out = spawnOnAuthorizedLaunch(
    decided,
    (env) => {
      seen.push({ ...env });
      return 7;
    },
    { H2A_AGENT_SESSION_ID: "agent-session:caller", MARK: "kept" },
  );
  assert.deepEqual(out, { ok: true, value: 7 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][H2A_AGENT_SESSION_ID], "agent-session:decided-1");
  assert.equal(seen[0].MARK, "kept");
});

test("LAUNCH: child-observed ID equals the verified decision", async () => {
  const decided = await authorizeAgentLaunch(launchRequest(), () => allowDecision());
  let childEnv = null;
  const out = spawnOnAuthorizedLaunch(
    decided,
    (env) => {
      const r = spawnSync(process.execPath, ["-e", "console.log(process.env.H2A_AGENT_SESSION_ID)"], {
        env: { ...env, PATH: process.env.PATH },
        encoding: "utf8",
      });
      assert.equal(r.status, 0);
      childEnv = r.stdout.trim();
      return childEnv;
    },
    { H2A_AGENT_SESSION_ID: "agent-session:caller" },
  );
  assert.deepEqual(out, { ok: true, value: "agent-session:decided-1" });
  assert.equal(childEnv, "agent-session:decided-1");
});

test("LAUNCH: malformed decision or request never spawns", async () => {
  let calls = 0;
  const spawn = () => {
    calls += 1;
    return 0;
  };
  const badDecision = await authorizeAgentLaunch(launchRequest(), () => ({
    allow: true,
    agentSessionId: "not a valid id!!",
    policyRevision: "pr-7",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  }));
  assert.deepEqual(badDecision, { ok: false, reason: "invalid_decision" });
  assert.deepEqual(spawnOnAuthorizedLaunch(badDecision, spawn, {}), {
    ok: false,
    reason: "invalid_decision",
  });
  const badRequest = await authorizeAgentLaunch({ ...launchRequest(), instanceId: "" }, () =>
    allowDecision(),
  );
  assert.deepEqual(badRequest, { ok: false, reason: "invalid_request" });
  const throwing = await authorizeAgentLaunch(launchRequest(), () => {
    throw new Error("port down");
  });
  assert.deepEqual(throwing, { ok: false, reason: "policy_unavailable" });
  assert.equal(calls, 0);
});
