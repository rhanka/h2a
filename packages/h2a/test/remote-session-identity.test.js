import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
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
  isEnrolledCustody,
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
  "consent-native-canonical.json":
    "436d59008001e58252000b040509d1dc551d9aa82370a57f6c514cdd8360d10a",
  "port-SessionOriginRegistryPortV1-ingestCapabilities.json":
    "6a323ecef9c4359aa75bc8467bc69967222cd1a4c7dbc32b0b363f48451f4e83",
  "port-SessionOriginRegistryPortV1-ingestLifecycle.json":
    "ea46feb8c640049ded42eeb1e083fa0b3ccb71c861c02ada9a13a87b07485e64",
  "registry-revision-digests.json":
    "31a375ea904d32f605c1560df3c6deee15d0c528f7059009e00d1cbf74568003",
  "route-drive-binding-ack.json":
    "2284c04fa886ed0fc135aa0be62675bce8d3ab728847a8b0339018366578fdc3",
  "route-drive-binding-fetch.json":
    "1785998e25a3a93eb9f2e2935b0756c86206974d14be939cb948f617875a8069",
  "route-lifecycle-publish.json":
    "078cc15260f9fa8291491f99178627e94ca93edf8320a252a55ec24db8a55cdf",
  "route-listing-grant-ack.json":
    "147690f35239c66d3a880d23996409690d52ee5edab09565e28a7748f1735b6b",
  "route-listing-grant-fetch.json":
    "0046d35b1bc8698203741279922653efff01f5a2cb334ce2c18c0d664f9605c2",
  "route-listing-publish.json":
    "98ac691268eb226e98ab7d4051be9b4e41cfd03341a54d02071390f5873870b1",
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
  // P2-5: all 19 vectors anchored to the manifest copy (not 9/19).
  assert.equal(Object.keys(MANIFEST_VECTOR_SHA256).length, 19);
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

// P2-5: every r3 consent case replays through the real projectConsent and
// its decision equals the vector `expected` — the oracle no longer reads
// only hashes and linkage.
test("CONSENT-PAIR: r3 vector cases project to expected", (t) => {
  const v = loadJson("vectors/consent-native-canonical.json");
  const FROM = "native-from-fixture";
  const TO = "native-to-fixture";
  for (const c of v.cases) {
    const root = mkdtempSync(join(tmpdir(), "rc2-b4-vector-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const store = createLocalStore({ root });
    const keyOf = {};
    for (const reg of v.registrations) {
      const k = keys();
      keyOf[reg.id] = k;
      store.registerInstance({
        id: reg.id,
        instance: reg.id,
        agentUuid: reg.agentUuid,
        roles: reg.id === c.registeredPrincipal ? ["PRINCIPAL"] : ["AGENTS"],
        scopes: ["shared"],
        capabilities: [],
        endpoints: [],
        publicKeys: [k.publicKeyPem],
        // The driven side declares its principal (same wiring as the
        // local pairFixture helper).
        ...(reg.id === TO && c.registeredPrincipal ? { principal: c.registeredPrincipal } : {}),
        acceptedPolicies: [],
        createdAt: new Date(c.now).toISOString(),
      });
    }
    for (const e of c.entries) {
      const payload = e.body.payload;
      const by = e.actor.instance;
      const entry = {
        id: `evt-${e.id}`,
        type: e.type,
        actor: { instance: by, role: "AGENTS", scope: "drive-consent" },
        negotiationId: e.negotiationId,
        createdAt: e.createdAt,
        body: {
          kind: payload.kind,
          payload,
          signature: signCanonical(payload, {
            by,
            privateKeyPem: keyOf[by].privateKeyPem,
          }),
        },
      };
      // Co-signatures are re-minted with the fixture principal key so the
      // projection verifies them against the registered principal.
      if (e.body.coSignature && c.registeredPrincipal) {
        entry.body.coSignature = signCanonical(payload, {
          by: c.registeredPrincipal,
          privateKeyPem: keyOf[c.registeredPrincipal].privateKeyPem,
        });
      }
      const file = negotiationJournalFile(store.paths, entry.negotiationId);
      mkdirSync(join(file, ".."), { recursive: true });
      const entries = store.readNegotiationJournal(entry.negotiationId);
      const prev = entries.at(-1);
      appendFileSync(
        file,
        JSON.stringify(prev ? appendJournalEntry(prev, entry) : createJournalEntry(entry)) +
          "\n",
      );
    }
    const entries = store
      .readNegotiationJournal(consentPairId(FROM, TO))
      .map((e) => e.entry ?? e);
    const out = projectConsent(store, FROM, TO, entries, c.now);
    assert.deepEqual(out.decision, c.expected, `case ${c.id}`);
  }
});

test("CONSENT-PAIR: durable sourceConsentRevision fence", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rc2-b4-fence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pairId = consentPairId(A, B);
  const D1 = `sha256:${"a".repeat(64)}`;
  const D2 = `sha256:${"b".repeat(64)}`;
  const fence = openSourceConsentFence(dir);
  assert.equal(fence.revisionOf(pairId), 0);
  assert.equal(fence.commitSnapshot(pairId, D1), 1);
  assert.equal(fence.revisionOf(pairId), 1);
  assert.equal(fence.commitSnapshot(pairId, D1), 1);
  assert.equal(fence.commitSnapshot(pairId, D2), 2);
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
  // P1-3: revision 0 never authorises — neither on the binding side nor
  // on an uncommitted pair — and unknown pairs refuse.
  assert.deepEqual(
    checkBindingRevision(
      { pairId, consentRevision: 1, sourceConsentRevision: 0 },
      reopened,
    ),
    { ok: false, reason: "revision_mismatch" },
  );
  assert.deepEqual(
    checkBindingRevision(
      { pairId: consentPairId(B, A), consentRevision: 1, sourceConsentRevision: 0 },
      reopened,
    ),
    { ok: false, reason: "revision_mismatch" },
  );
  assert.deepEqual(
    checkBindingRevision(
      { pairId: consentPairId(B, A), consentRevision: 1, sourceConsentRevision: 1 },
      reopened,
    ),
    { ok: false, reason: "revision_mismatch" },
  );
  // P1-3: opaque non-digest strings never advance the fence.
  assert.throws(() => reopened.commitSnapshot(pairId, "not-a-digest"), /fence_unavailable/);
  assert.throws(() => reopened.commitSnapshot(pairId, "sha256:zzz"), /fence_unavailable/);
  assert.equal(reopened.revisionOf(pairId), 2);
  const blocker = join(dir, "blocker");
  writeFileSync(blocker, "not a dir");
  assert.throws(() => openSourceConsentFence(join(blocker, "sub")), /fence_unavailable/);
  writeFileSync(join(dir, "source-consent-revisions.json"), "{corrupt");
  assert.throws(() => openSourceConsentFence(dir), /fence_unavailable/);
  // P1-3: a corrupt entry refuses instead of resetting to 0.
  writeFileSync(
    join(dir, "source-consent-revisions.json"),
    JSON.stringify({ format: "h2a.source-consent-fence/1", pairs: { [pairId]: { revision: 0, digest: D1 } } }),
  );
  assert.throws(() => openSourceConsentFence(dir), /fence_unavailable/);
});

// P1-1 round 3: the fence never serves a stale revision and never resets
// silently — revisionOf re-reads durable state on every call; only an
// absent file is (explicitly) created; anything else refuses.
test("CONSENT-PAIR: fence never serves stale revisions or silent resets", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rc2-b4-fence-r3-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pairId = consentPairId(A, B);
  const D1 = `sha256:${"a".repeat(64)}`;
  const D2 = `sha256:${"b".repeat(64)}`;
  const file = join(dir, "source-consent-revisions.json");
  const fenceA = openSourceConsentFence(dir);
  assert.equal(fenceA.commitSnapshot(pairId, D1), 1);
  // Second handle opened while durable state is rev 1.
  const fenceB = openSourceConsentFence(dir);
  assert.equal(fenceB.revisionOf(pairId), 1);
  // A advances to rev 2: B must see rev 2, never its stale rev 1.
  assert.equal(fenceA.commitSnapshot(pairId, D2), 2);
  assert.equal(fenceB.revisionOf(pairId), 2);
  assert.deepEqual(
    checkBindingRevision(
      { pairId, consentRevision: 1, sourceConsentRevision: 1 },
      fenceB,
    ),
    { ok: false, reason: "revision_mismatch" },
  );
  assert.deepEqual(
    checkBindingRevision(
      { pairId, consentRevision: 1, sourceConsentRevision: 2 },
      fenceB,
    ),
    { ok: true },
  );
  // Unreadable fence file: reopen and revisionOf refuse, durable bytes
  // stay untouched (no empty-state rewrite).
  const before = readFileSync(file, "utf8");
  chmodSync(file, 0o000);
  try {
    assert.throws(() => openSourceConsentFence(dir), /fence_unavailable/);
    assert.throws(() => fenceA.revisionOf(pairId), /fence_unavailable/);
    assert.deepEqual(
      checkBindingRevision(
        { pairId, consentRevision: 1, sourceConsentRevision: 2 },
        fenceA,
      ),
      { ok: false, reason: "revision_mismatch" },
    );
  } finally {
    chmodSync(file, 0o644);
  }
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(fenceA.revisionOf(pairId), 2);
  // Extra key in an entry: corrupt, never defaulted to a fresh state.
  writeFileSync(
    file,
    JSON.stringify({
      format: "h2a.source-consent-fence/1",
      genesis: "test-genesis",
      pairs: { [pairId]: { revision: 2, digest: D2, extra: true } },
    }),
  );
  assert.throws(() => openSourceConsentFence(dir), /fence_unavailable/);
  // Envelope without format/genesis, or with an empty genesis: refused.
  writeFileSync(
    file,
    JSON.stringify({ pairs: { [pairId]: { revision: 2, digest: D2 } } }),
  );
  assert.throws(() => openSourceConsentFence(dir), /fence_unavailable/);
  writeFileSync(
    file,
    JSON.stringify({ format: "h2a.source-consent-fence/1", genesis: "", pairs: {} }),
  );
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
      // P2-5: H negatives also go through the trust path. H gates stay
      // closed before shape (fail-closed precedence): malformed H bytes
      // refuse BLOCKED_EXTERNAL, never TRUSTED.
      assert.equal(
        evaluateRecordTrust(record, n.value, null).verdict,
        "BLOCKED_EXTERNAL",
      );
    }
  }
});

test("AUTHORITY-NATIVE: binding/ack r3 constraints refuse one by one", () => {
  const b = loadJson("vectors/RemoteDriveConsentBindingV1.json");
  const good = structuredClone(b.positive[0].value);
  assert.equal(verifyRecordShape("RemoteDriveConsentBindingV1", good), "ACCEPT_SHAPE");
  const cases = [
    ["pairId short prefix", (x) => { x.body.pairId = "drive-consent:x"; }],
    ["principalDecision free string", (x) => { x.body.principalDecision = "whatever"; }],
    ["actionScopes empty", (x) => { x.body.actionScopes = []; }],
    ["actionScopes unknown enum", (x) => { x.body.actionScopes = ["remote.admin"]; }],
    ["actionScopes duplicated", (x) => { x.body.actionScopes = ["remote.input", "remote.input"]; }],
    ["actionScopes three items", (x) => { x.body.actionScopes = ["remote.input", "remote.permission.respond", "remote.input"]; }],
    ["float counter", (x) => { x.body.consentRevision = 1.5; }],
    ["negative timestamp", (x) => { x.body.issuedAt = -1; }],
    ["short signature", (x) => { x.signature.value = "AAAA"; }],
    ["entryRef sha256 digest", (x) => { x.body.requestEntryRef.digest = `sha256:${"a".repeat(64)}`; }],
    ["entryRef float revision", (x) => { x.body.requestEntryRef.revision = 1.5; }],
    ["principalRef Id accepted", null],
  ];
  for (const [name, fn] of cases) {
    if (fn === null) continue;
    const mut = structuredClone(good);
    fn(mut);
    assert.equal(verifyRecordShape("RemoteDriveConsentBindingV1", mut), "REJECT_SCHEMA", name);
  }
  // P2-1 inverted case: principalRef as Id is schema-valid (was rejected).
  const withPrincipal = structuredClone(good);
  withPrincipal.body.principalRef = "principal-1";
  withPrincipal.body.principalDecision = "co-signed";
  assert.equal(
    verifyRecordShape("RemoteDriveConsentBindingV1", withPrincipal),
    "ACCEPT_SHAPE",
    "principalRef Id accepted",
  );
  const a = loadJson("vectors/RemoteDriveConsentAckV1.json");
  const ackGood = structuredClone(a.positive[0].value);
  assert.equal(verifyRecordShape("RemoteDriveConsentAckV1", ackGood), "ACCEPT_SHAPE");
  const ackMut = structuredClone(ackGood);
  ackMut.body.status = "refused";
  assert.equal(verifyRecordShape("RemoteDriveConsentAckV1", ackMut), "REJECT_SCHEMA");
  const ackMut2 = structuredClone(ackGood);
  ackMut2.body.bindingDigest = "sha256:bad";
  assert.equal(verifyRecordShape("RemoteDriveConsentAckV1", ackMut2), "REJECT_SCHEMA");
});

// P2-1: r3 $def constraints refuse one by one (the vector corpus only
// covers the unknown-field case).
test("AUTHORITY-NATIVE: H admission verdict const is enforced", () => {
  const v = loadJson("vectors/SessionAdmissionEvidenceV1.json");
  const good = structuredClone(v.positive.find((p) => p.expect === "ACCEPT_SHAPE").value);
  assert.equal(verifyRecordShape("SessionAdmissionEvidenceV1", good), "ACCEPT_SHAPE");
  const refused = structuredClone(good);
  refused.verdict = "refused";
  assert.equal(verifyRecordShape("SessionAdmissionEvidenceV1", refused), "REJECT_SCHEMA");
});

// P2-1 round 3: every r3 $def constraint refuses one by one — types and
// items, enums, consts, Id/Digest shapes, exact bit/column entry keys,
// 5-bit / 8-column cardinalities, typed optionals, expiresAt admitted.
test("AUTHORITY-NATIVE: capabilities $def constraints refuse one by one", () => {
  const v = loadJson("vectors/SessionCaptureCapabilitiesV1.json");
  const good = structuredClone(v.positive[0].value);
  assert.equal(verifyRecordShape("SessionCaptureCapabilitiesV1", good), "ACCEPT_SHAPE");
  const cases = [
    ["hostKind free string", (x) => { x.hostKind = "evil"; }],
    ["cliExecutableDigest non-hex", (x) => { x.cliExecutableDigest = "zzzz"; }],
    ["matrixDigest non-hex", (x) => { x.matrixDigest = "abc"; }],
    ["providerTupleDigest non-hex", (x) => { x.providerTupleDigest = "sha256:zzz"; }],
    ["rc0CapabilitiesDigest non-hex", (x) => { x.rc0CapabilitiesDigest = 123; }],
    ["matrixSource free string", (x) => { x.matrixSource = "evil"; }],
    ["bits empty", (x) => { x.bits = {}; }],
    ["bits extra key", (x) => { x.bits.evilBit = structuredClone(x.bits.ptyBytes); }],
    ["bits missing a key", (x) => { delete x.bits.ptyBytes; }],
    ["bit missing digests", (x) => {
      delete x.bits.ptyBytes.executableDigest;
      delete x.bits.ptyBytes.pluginDigest;
      delete x.bits.ptyBytes.receiptDigest;
    }],
    ["bit extra key", (x) => { x.bits.ptyBytes.evil = 1; }],
    ["bit state free string", (x) => { x.bits.ptyBytes.state = "evil"; }],
    ["bit executableDigest non-hex", (x) => { x.bits.ptyBytes.executableDigest = "nope"; }],
    ["columns empty", (x) => { x.columns = []; }],
    ["columns wrong count", (x) => { x.columns = x.columns.slice(0, 7); }],
    ["column missing receiptDigest/sourceGap", (x) => {
      delete x.columns[0].receiptDigest;
      delete x.columns[0].sourceGap;
    }],
    ["column extra key", (x) => { x.columns[0].evil = 1; }],
    ["column state free string", (x) => { x.columns[0].state = "evil"; }],
    ["column name free string", (x) => { x.columns[0].column = "evil"; }],
    ["declaredLosses unknown enum", (x) => { x.declaredLosses = ["nope"]; }],
    ["declaredLosses duplicated", (x) => { x.declaredLosses = [...x.declaredLosses, x.declaredLosses[0]]; }],
    ["declaredLosses non-string item", (x) => { x.declaredLosses = [123]; }],
    ["pointOrdering string", (x) => { x.pointOrdering = "ordered"; }],
    ["originAgentSessionId number", (x) => { x.originAgentSessionId = 123; }],
    ["capabilityRevision float", (x) => { x.capabilityRevision = 1.5; }],
  ];
  for (const [name, fn] of cases) {
    const mut = structuredClone(good);
    fn(mut);
    assert.equal(verifyRecordShape("SessionCaptureCapabilitiesV1", mut), "REJECT_SCHEMA", name);
  }
});

test("AUTHORITY-NATIVE: RoleScope $def constraints refuse one by one", () => {
  const v = loadJson("vectors/RoleScopePolicyV1.json");
  const good = structuredClone(v.positive.find((p) => p.expect === "ACCEPT_SHAPE").value);
  assert.equal(verifyRecordShape("RoleScopePolicyV1", good), "ACCEPT_SHAPE");
  const cases = [
    ["signingClass outside enum", (x) => { x.signingClass = "D9"; }],
    ["memoryScopes free string", (x) => { x.memoryScopes = ["evil"]; }],
    ["governanceRoles non-string item", (x) => { x.governanceRoles = [123]; }],
    ["allowedCliKinds non-string item", (x) => { x.allowedCliKinds = ["ok", 123]; }],
    ["mcpRights tools non-string item", (x) => { x.mcpRights.tools = [123]; }],
    ["policyId number", (x) => { x.policyId = 123; }],
    ["revision float", (x) => { x.revision = 1.5; }],
    ["effortCeiling wrong type", (x) => { x.effortCeiling = "high"; }],
    ["validUntil wrong type", (x) => { x.validUntil = 123; }],
    ["unknown optional", (x) => { x.evilOptional = 1; }],
  ];
  for (const [name, fn] of cases) {
    const mut = structuredClone(good);
    fn(mut);
    assert.equal(verifyRecordShape("RoleScopePolicyV1", mut), "REJECT_SCHEMA", name);
  }
  // Typed optionals: a Counter ceiling, string validUntil/supersedes accept.
  for (const extra of [{ effortCeiling: 123 }, { validUntil: "2030-01-01" }, { supersedes: "policy-9" }]) {
    const mut = structuredClone(good);
    Object.assign(mut, extra);
    assert.equal(verifyRecordShape("RoleScopePolicyV1", mut), "ACCEPT_SHAPE", JSON.stringify(extra));
  }
});

test("AUTHORITY-NATIVE: RegistryView $def constraints refuse one by one", () => {
  const v = loadJson("vectors/RegistryInstanceViewV1.json");
  const good = structuredClone(v.positive.find((p) => p.expect === "ACCEPT_SHAPE").value);
  assert.equal(verifyRecordShape("RegistryInstanceViewV1", good), "ACCEPT_SHAPE");
  const cases = [
    ["instances non-record item", (x) => { x.instances = [123]; }],
    ["keys malformed item", (x) => { x.keys = [{ bad: true }]; }],
    ["launchName number", (x) => { x.launchName = 123; }],
    ["offboardTombstone string", (x) => { x.offboardTombstone = "flat"; }],
    ["unknown optional", (x) => { x.evilOptional = 1; }],
  ];
  for (const [name, fn] of cases) {
    const mut = structuredClone(good);
    fn(mut);
    assert.equal(verifyRecordShape("RegistryInstanceViewV1", mut), "REJECT_SCHEMA", name);
  }
  // Typed optionals: string launchName and record tombstone accept.
  const withLaunch = structuredClone(good);
  withLaunch.launchName = "launch-1";
  assert.equal(verifyRecordShape("RegistryInstanceViewV1", withLaunch), "ACCEPT_SHAPE");
  const withTomb = structuredClone(good);
  withTomb.offboardTombstone = { instance: "i", revokedKeys: 0, revokedSubagents: [], at: "t" };
  assert.equal(verifyRecordShape("RegistryInstanceViewV1", withTomb), "ACCEPT_SHAPE");
});

test("AUTHORITY-NATIVE: Attestation $def constraints refuse one by one", () => {
  const v = loadJson("vectors/RoleAgentAttestationV1.json");
  const good = structuredClone(v.positive.find((p) => p.expect === "ACCEPT_SHAPE").value);
  assert.equal(verifyRecordShape("RoleAgentAttestationV1", good), "ACCEPT_SHAPE");
  const cases = [
    ["agentUuid number", (x) => { x.agentUuid = 123; }],
    ["issuedAt number", (x) => { x.issuedAt = 123; }],
    ["keyIds non-string item", (x) => { x.keyIds = [123]; }],
    ["expiresAt wrong type", (x) => { x.expiresAt = 123; }],
    ["unknown field", (x) => { x.evil = 1; }],
  ];
  for (const [name, fn] of cases) {
    const mut = structuredClone(good);
    fn(mut);
    assert.equal(verifyRecordShape("RoleAgentAttestationV1", mut), "REJECT_SCHEMA", name);
  }
  // expiresAt is an admitted optional (parallel to issuedAt): string accepts.
  const withExpiry = structuredClone(good);
  withExpiry.expiresAt = "2030-01-01T00:00:00.000Z";
  assert.equal(verifyRecordShape("RoleAgentAttestationV1", withExpiry), "ACCEPT_SHAPE");
  const withKeys = structuredClone(good);
  withKeys.keyIds = ["key-1"];
  assert.equal(verifyRecordShape("RoleAgentAttestationV1", withKeys), "ACCEPT_SHAPE");
});

test("AUTHORITY-NATIVE: association Id bounds refuse one by one", () => {
  const v = loadJson("vectors/RemoteSourceAssociationV1.json");
  const good = structuredClone(v.positive[0].value);
  assert.equal(verifyRecordShape("RemoteSourceAssociationV1", good), "ACCEPT_SHAPE");
  const long = structuredClone(good);
  long.originAgentSessionId = "x".repeat(500);
  assert.equal(verifyRecordShape("RemoteSourceAssociationV1", long), "REJECT_SCHEMA");
  const numChild = structuredClone(good);
  numChild.childEnvironmentAgentSessionId = 123;
  assert.equal(verifyRecordShape("RemoteSourceAssociationV1", numChild), "REJECT_SCHEMA");
  const nullOrigin = structuredClone(good);
  nullOrigin.originAgentSessionId = null;
  assert.equal(verifyRecordShape("RemoteSourceAssociationV1", nullOrigin), "REJECT_SCHEMA");
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
    // Wire encoding is Sig64 (base64url, unpadded): same signature bytes
    // as signCanonical, in the r3 wire alphabet.
    sign: (body) => ({
      alg: "Ed25519",
      value: signCanonical(body, { by: issuer, privateKeyPem }).value
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
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
    // P2-5: vector negatives also go through the trust path with an
    // enrolled authority — schema negatives refuse before any signature
    // check, never TRUSTED.
    for (const n of v.negative) {
      if (n.expect === "REJECT_SCHEMA") {
        assert.equal(
          evaluateRecordTrust(record, n.value, auth).verdict,
          "REJECT_SCHEMA",
        );
      }
    }
    // P1-1 neutralisation: even well-formed, well-signed bytes never
    // return TRUSTED until the B5+ composition compares every bound field.
    const body = v.positive[0].value.body;
    const resigned = { body, signature: auth.sign(body) };
    assert.equal(verifyRecordShape(record, resigned), "ACCEPT_SHAPE");
    assert.equal(
      evaluateRecordTrust(record, resigned, auth).verdict,
      "BLOCKED_EXTERNAL",
    );
  });

  // Generic guard (same as B3): for EVERY body field, a validly re-signed
  // mutation must refuse — never TRUSTED. Shape-valid mutations refuse via
  // the P1-1 neutralisation (BLOCKED_EXTERNAL); shape-breaking ones via
  // REJECT_SCHEMA/REJECT_ROLE/REJECT_SIGNATURE.
  test(`AUTHORITY-NATIVE: ${record} every re-signed field mutation refuses`, () => {
    const v = loadJson(`vectors/${record}.json`);
    const base = structuredClone(v.positive[0].value.body);
    const auth = testAuthority("guard-issuer", "guard-kid");
    base.issuer = "guard-issuer";
    base.kid = "guard-kid";
    const mutate = (value) => {
      if (typeof value === "string") {
        if (/^[a-f0-9]{64}$/.test(value)) return "0".repeat(64);
        if (/^sha256:[a-f0-9]{64}$/.test(value)) return `sha256:${"1".repeat(64)}`;
        if (value === "binding") return "binding";
        if (value === "source-ack") return "source-ack";
        if (value === "accepted") return "accepted";
        if (value === "principal-absent") return "co-signed";
        if (value === "co-signed") return "principal-absent";
        if (value === "guard-issuer") return "guard-issuer-evil";
        if (value === "guard-kid") return "guard-kid-evil";
        return `${value}-evil`;
      }
      if (typeof value === "number") return value + 1;
      if (Array.isArray(value)) return [];
      if (value === null) return "evil";
      if (typeof value === "object") return null;
      return "evil";
    };
    let covered = 0;
    for (const field of Object.keys(base)) {
      const mut = structuredClone(base);
      mut[field] = mutate(base[field]);
      const resigned = { body: mut, signature: auth.sign(mut) };
      const verdict = evaluateRecordTrust(record, resigned, auth).verdict;
      assert.notEqual(
        verdict,
        "TRUSTED",
        `${record}.${field} re-signed mutation must refuse (got TRUSTED)`,
      );
      covered += 1;
    }
    assert.ok(covered === Object.keys(base).length && covered > 10);
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
    // r3 RevisionRef.digest is Digest (hex64, no sha256: prefix).
    decisionDigest: "d".repeat(64),
    bindingDigest: "e".repeat(64),
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

test("AUTHORITY-NATIVE: resolveSession trusts the host-observed tuple, never the bearer", () => {
  // P2-2 round 3: the liveness expectation (pid + startedAt) comes from a
  // host-observed port, never from the bearer bag — a self-minted tuple
  // with a hand-recomputed digest refuses. Without a port, the origin
  // stays unresolved (fail-closed until host wiring, B5+).
  const bearer = {
    processBindingRef: { id: "pb-1", revision: 1, digest: "" },
    localInstanceId: "pair:b",
    pid: 4242,
    startedAt: "2026-11-01T08:00:00.000Z",
    sessionId: "sess-1",
    incarnation: "inc-1",
    originInstanceId: "pair:b",
  };
  const digestFor = (pid, startedAt) => computeHash({
    instanceId: bearer.localInstanceId,
    pid,
    startedAt,
    sessionId: bearer.sessionId,
    incarnation: bearer.incarnation,
    refId: bearer.processBindingRef.id,
    refRevision: bearer.processBindingRef.revision,
  });
  const hostPort = (pid, startedAt) => ({
    observeProcess: () => ({ pid, startedAt }),
  });
  const digest = digestFor(4242, "2026-11-01T08:00:00.000Z");
  const minted = { ...bearer, processBindingRef: { ...bearer.processBindingRef, digest } };
  // Positive: the host observes the same live tuple the ref binds.
  const ok = resolveSession(minted, hostPort(4242, "2026-11-01T08:00:00.000Z"));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.sessionRef, {
    originInstanceId: "pair:b",
    sessionId: "sess-1",
    incarnation: "inc-1",
  });
  for (const key of ["writerEpoch", "originRevision", "projectionDigest"]) {
    assert.ok(!(key in ok), `no writer byte: ${key}`);
  }
  // No port (or a dead one): origin stays unresolved, never local-defaulted.
  assert.deepEqual(
    resolveSession(minted),
    { ok: false, reason: "origin_unresolved" },
  );
  assert.deepEqual(
    resolveSession(minted, null),
    { ok: false, reason: "origin_unresolved" },
  );
  assert.deepEqual(
    resolveSession(minted, { observeProcess: () => null }),
    { ok: false, reason: "origin_unresolved" },
  );
  // Self-minted bearer tuple is ignored: the host observes another process.
  const selfMinted = {
    ...minted,
    processBindingRef: {
      ...minted.processBindingRef,
      digest: digestFor(999999, "whenever"),
    },
    pid: 999999,
    startedAt: "whenever",
  };
  assert.deepEqual(
    resolveSession(selfMinted, hostPort(4242, "2026-11-01T08:00:00.000Z")),
    { ok: false, reason: "binding_refused" },
  );
  // The port is authoritative: bearer/observed agreement resolves, even
  // for a tuple the bearer chose — the bearer alone can never mint one.
  // (Live-process wiring of the port is the B5+ lot; here the port is stubbed.)
  const agreed = resolveSession(selfMinted, hostPort(999999, "whenever"));
  assert.equal(agreed.ok, true);
  assert.deepEqual(
    resolveSession({
      ...minted,
      processBindingRef: { id: "pb-1", revision: 1, digest: `sha256:${"f".repeat(64)}` },
    }, hostPort(4242, "2026-11-01T08:00:00.000Z")),
    { ok: false, reason: "binding_refused" },
  );
  assert.deepEqual(
    resolveSession(
      { ...minted, originInstanceId: "foreign-origin" },
      hostPort(4242, "2026-11-01T08:00:00.000Z"),
    ),
    { ok: false, reason: "origin_unresolved" },
  );
  // Omitted origin never resolves to local; a ref minted for one session
  // never resolves to another; non-integer revisions refuse.
  const { originInstanceId, ...noOrigin } = minted;
  assert.deepEqual(
    resolveSession(noOrigin, hostPort(4242, "2026-11-01T08:00:00.000Z")),
    { ok: false, reason: "origin_unresolved" },
  );
  assert.deepEqual(
    resolveSession(
      { ...minted, sessionId: "sess-evil" },
      hostPort(4242, "2026-11-01T08:00:00.000Z"),
    ),
    { ok: false, reason: "binding_refused" },
  );
  assert.deepEqual(
    resolveSession(
      { ...minted, processBindingRef: { id: "pb-1", revision: -1.5, digest } },
      hostPort(4242, "2026-11-01T08:00:00.000Z"),
    ),
    { ok: false, reason: "binding_refused" },
  );
  assert.deepEqual(
    resolveSession(
      { ...minted, processBindingRef: { id: "pb-1", revision: 0, digest } },
      hostPort(4242, "2026-11-01T08:00:00.000Z"),
    ),
    { ok: false, reason: "binding_refused" },
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
  // P2-5: positives are recomputed (sha256 over the decoded domain+JCS
  // bytes), not re-read from labels.
  for (const p of v.positive) {
    const raw = Buffer.from(p.inputBase64, "base64");
    assert.equal(createHash("sha256").update(raw).digest("hex"), p.projectionDigest);
  }
  for (const n of v.negative) assert.equal(n.expected, "digest-mismatch");
  // P2-5: mismatch detection is live — one flipped byte breaks the digest,
  // and no negative value collides with a pinned positive.
  const first = v.positive[0];
  const tampered = Buffer.from(first.inputBase64, "base64");
  tampered[tampered.length - 1] ^= 1;
  assert.notEqual(
    createHash("sha256").update(tampered).digest("hex"),
    first.projectionDigest,
  );
  const pinned = new Set(v.positive.map((p) => JSON.stringify(p.value)));
  for (const n of v.negative) {
    assert.ok(!pinned.has(JSON.stringify(n.value)), `negative ${n.id} must not equal a pinned positive`);
  }
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
    // P2-5: stage/lane asserted from the vector positive inputs (not from
    // the pin declaration). Guard/matrix positives carry enum stage/lane;
    // http-media positives carry the zero-entity-body contract instead.
    // The pin's declared stage/lane must appear among the positives.
    const STAGES = ["listing", "bootstrap", "bound"];
    const LANES = ["content", "actions", "results", "lifecycle"];
    let coversPin = false;
    for (const p of v.positive) {
      assert.equal(p.expected.decision, "allow");
      if (p.input.stage === undefined) {
        // HTTP-media contract from the pin: fetch routes carry zero entity
        // bytes; ack routes carry the 2-byte `{}` JSON envelope.
        if (pin.body !== undefined) {
          assert.equal(p.input.bodyBytes, 0, `${pin.file} ${p.id} zero entity bytes`);
        } else {
          assert.equal(p.input.contentType, "application/json");
          assert.equal(p.input.bodyBytes, 2, `${pin.file} ${p.id} ack envelope bytes`);
        }
        continue;
      }
      assert.ok(STAGES.includes(p.input.stage), `${pin.file} ${p.id} stage enum`);
      assert.ok(LANES.includes(p.input.lane), `${pin.file} ${p.id} lane enum`);
      if (p.input.stage === pin.stage && p.input.lane === pin.lane) coversPin = true;
    }
    assert.equal(coversPin, true, `${pin.file} must cover stage ${pin.stage}/lane ${pin.lane}`);
    for (const n of v.negative) {
      assert.notEqual(n.expected.decision, "allow", `${pin.file} ${n.id} must refuse`);
    }
  }
  // P2-5: the remaining 4 vectors (2 origin ports, 2 publish routes) are
  // loaded and pinned — still no handler implemented (B6).
  for (const file of [
    "port-SessionOriginRegistryPortV1-ingestCapabilities.json",
    "port-SessionOriginRegistryPortV1-ingestLifecycle.json",
    "route-lifecycle-publish.json",
    "route-listing-publish.json",
  ]) {
    const v = loadJson(`vectors/${file}`);
    assert.ok(v.positive.length > 0, `${file} positives`);
    assert.ok(v.negative.length > 0, `${file} negatives`);
  }
  for (const port of [
    "port-SessionOriginRegistryPortV1-ingestCapabilities.json",
    "port-SessionOriginRegistryPortV1-ingestLifecycle.json",
  ]) {
    const v = loadJson(`vectors/${port}`);
    assert.equal(v.port, "SessionOriginRegistryPortV1");
    assert.equal(typeof v.method, "string");
    // Port positives are shape cases: ACCEPT_SHAPE bytes must verify,
    // including the embedded capabilities value against the tightened
    // r3 validator.
    for (const p of v.positive) {
      const caps = p.value?.capabilities;
      if (p.expect === "ACCEPT_SHAPE" && caps?.kind === "capabilities") {
        assert.equal(
          verifyRecordShape("SessionCaptureCapabilitiesV1", caps),
          "ACCEPT_SHAPE",
          `${port} ${p.id}`,
        );
      }
    }
    assert.ok(
      v.positive.some((p) => p.expect === "ACCEPT_SHAPE"),
      `${port} must carry an ACCEPT_SHAPE positive`,
    );
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
  assert.equal(isEnrolledCustody(custody), true);
  // P2-2: closed spec + fail-closed material screen — exact names,
  // synonyms, long forms and unknown fields all refuse.
  for (const bad of [
    { role: "native-source", keyFile: "/tmp/k.pem" },
    { role: "native-source", envVar: "NATIVE_KEY" },
    { role: "native-source", privateKeyPem },
    { role: "native-source", issuer: "i", kid: "k", signer: () => ({}), privateKey: "SECRET" },
    { role: "native-source", issuer: "i", kid: "k", signer: () => ({}), secretKey: "SECRET" },
    { role: "native-source", issuer: "i", kid: "k", signer: () => ({}), keyMaterial: "SECRET" },
    { role: "native-source", issuer: "i", kid: "k", signer: () => ({}), passphraseFile: "/tmp/p" },
    { role: "native-source", issuer: "i", kid: "k", signer: () => ({}), token: "SECRET" },
    { role: "native-source", issuer: "i", kid: "k", signer: () => ({}), seedPhrase: "word ".repeat(12) },
    { role: "native-source", issuer: "i", kid: "k", signer: () => ({}), vaultKeyId: "v-1" },
    { role: "native-source", issuer: "i", kid: "k", signer: () => ({}), key_path: "/tmp/k.pem" },
    { role: "native-source", issuer: "i", kid: "k", signer: () => ({}), extra: "nope" },
  ]) {
    assert.throws(() => registerCustody(bad), /custody_unqualified/);
  }
  // P2-2: a fabricated handle (never enrolled) is not branded.
  assert.equal(
    isEnrolledCustody({ role: "native-source", issuer: "x", kid: "y", fingerprint: "0123456789abcdef" }),
    false,
  );
});

// P1-2 neutralisation: no signature is emitted on the ACK path until the
// B5+ composition exists — every call refuses, enrolled or not.
test("AUTHORITY-NATIVE: drive-ACK signer path refuses fail-closed", () => {
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
  assert.throws(() => signDriveConsentAck(custody, body), /source_role_unavailable/);
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

// P2-3: an expired allow never authorises and never spawns.
test("LAUNCH: expired allow refuses, spawn never runs", async () => {
  let calls = 0;
  const spawn = () => {
    calls += 1;
    return 0;
  };
  const expired = await authorizeAgentLaunch(launchRequest(), () => ({
    allow: true,
    agentSessionId: "agent-session:decided-1",
    policyRevision: "pr-7",
    expiresAt: "2000-01-01T00:00:00.000Z",
  }));
  assert.deepEqual(expired, { ok: false, reason: "invalid_decision" });
  assert.deepEqual(spawnOnAuthorizedLaunch(expired, spawn, {}), {
    ok: false,
    reason: "invalid_decision",
  });
  assert.equal(calls, 0);
});

// P2-3: a fabricated wrapper never spawns — shape and expiry are
// revalidated just before the spawn step.
test("LAUNCH: fabricated wrapper never spawns", async () => {
  let calls = 0;
  const spawn = () => {
    calls += 1;
    return 0;
  };
  const forged = {
    ok: true,
    decision: {
      allow: true,
      agentSessionId: "not-a-session-id",
      policyRevision: "pr-7",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
  assert.deepEqual(spawnOnAuthorizedLaunch(forged, spawn, {}), {
    ok: false,
    reason: "invalid_decision",
  });
  const stale = {
    ok: true,
    decision: {
      allow: true,
      agentSessionId: "agent-session:decided-1",
      policyRevision: "pr-7",
      expiresAt: "2000-01-01T00:00:00.000Z",
    },
  };
  assert.deepEqual(spawnOnAuthorizedLaunch(stale, spawn, {}), {
    ok: false,
    reason: "invalid_decision",
  });
  assert.equal(calls, 0);
});
