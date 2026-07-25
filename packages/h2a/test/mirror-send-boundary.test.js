// The mirror's SEND BOUNDARY — `runtime/mirror/sanitize.ts`.
//
// Contract under test:
//   docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md
//     § "Send boundary (the mirror)"
//   docs/specs/2026-07-25-p1-joint-plan-h2a-sessions-in-sentropic-ui.md § 7, § 9
//
// The gap being closed: the feed sanitized what a browser READS while the mirror
// pushed `listPresence(...)` records and registry rows VERBATIM, so the working
// directory, the command line, the tmux coordinates, the pid, `workspace.path`
// and the `file://<root>` endpoint uri came to rest in a hosted store. A
// read-side sanitizer cannot protect data at rest on someone else's disk.
//
// The load-bearing properties, and why each is pinned:
//  1. ALLOWLIST, not denylist. The transmitted field set is exact and the plan
//     classifies EVERY field of the source record. A field added to the record
//     and left unclassified is reported (test 3) — a denylist would simply ship
//     it. This is the whole reason the fix is a field plan and not a scrub.
//  2. HOSTILE VALUES DO NOT SURVIVE SERIALIZATION. The bait is planted in the
//     fields the builder actually reads — the presence file `listPresence`
//     returns and the registration `findInstance` returns — never in a field
//     nothing reads, which would make the assertion inert.
//  3. THE SIGNATURE STILL COVERS WHAT IS TRANSMITTED. Sanitizing happens before
//     signing, so a JSON round-trip of the signed envelope still verifies.
//  4. THE INGESTER STILL WORKS. A narrowed push is accepted (202) by the real
//     loopback ingester and what comes to rest carries none of the withheld
//     fields — the end-to-end statement the disclosure in § 7 was about.
//  5. THE FEED STILL WORKS. `workspaceLabel` still resolves from a narrowed
//     record, so narrowing did not silently degrade the panel to 'unknown'.
//
// No network: the only server is a 127.0.0.1 ingester created in-process.

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MIRROR_ENDPOINT_PLAN,
  MIRROR_INTERESTS_PLAN,
  MIRROR_PRESENCE_PLAN,
  MIRROR_REGISTRATION_PLAN,
  MIRROR_SUBAGENT_PLAN,
  buildFeedResponse,
  buildInstanceMirror,
  createLocalStore,
  isH2ASession,
  isH2AWorkspaceRef,
  mirrorServerForStore,
  sanitizePresenceForMirror,
  sanitizeRegistrationForMirror,
  sanitizeWorkspaceRefForMirror,
  signEnvelope,
  unclassifiedMirrorFields,
  verifyEnvelopeSignature,
  writePresence
} from "../dist/index.js";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const INSTANCE = "claude:secret-ledger:aaaaaaaaaaaa";
const SESSION_ID = "sess:bait0001";

// ─── Hostile values ─────────────────────────────────────────────────────────
//
// Each one is planted in a WITHHELD field of a record the builder really reads.
// Nothing is planted in `workspace.label` / `name`: those are transmitted BY
// DESIGN (the disclosed free-text gap, joint plan § 9 item 1), so bait there
// would be testing the wrong rule.
const BAIT_CWD = "/home/victim/src/secret-ledger";
const BAIT_COMMAND = "h2a mcp-serve --host claude --token sk-live-BAITTOKEN";
const BAIT_RESUME = "claude -r 9f3c-BAITRESUME";
const BAIT_TTY = "/dev/pts/42";
const BAIT_TMUX_SESSION = "BAITTMUXSESSION";
const BAIT_TMUX_WINDOW = "BAITTMUXWINDOW";
const BAIT_TMUX_PANE = "%BAITPANE";
const BAIT_PID = 424242;
const BAIT_WORKSPACE_PATH = "/home/victim/src/secret-ledger";
const BAIT_REPO = "/home/victim/mirrors/secret-ledger.git";
const BAIT_ENDPOINT_URI = "file:///home/victim/.h2a";
const BAIT_MIRRORED_AT = "2099-01-01T00:00:00.000Z"; // forged freshness claim
// NESTED bait. `isInterests` (`session.ts`) is a two-field spot-check that does
// NOT reject extra keys, so this whole object is a well-formed `interests` as far
// as `isH2ASession` and therefore `writePresence` are concerned. While
// `interests` was classified `SEND`, `applyPlan` copied it BY REFERENCE and the
// nested payload reached the receiver's disk through a real 202. It is planted in
// the shared fixture on purpose, so every assertion below — the field-set tests,
// the serialized-push test and the end-to-end at-rest test — covers it.
const BAIT_NESTED_TMUX_SESSION = "NESTEDSESSION";
const BAIT_NESTED_TMUX_PANE = "%NESTEDPANE";
const BAIT_NESTED_CWD = "/home/victim/NESTEDCWD";
const BAIT_NESTED_PID = 987654;
const BAIT_NESTED_INTERESTS = {
  scopes: ["scope:default"],
  negotiations: [],
  lc: {
    tmux: { session: BAIT_NESTED_TMUX_SESSION, pane: BAIT_NESTED_TMUX_PANE },
    cwd: BAIT_NESTED_CWD,
    pid: BAIT_NESTED_PID
  }
};
// Same shape one level down on the OTHER unnarrowed composite: the endpoints
// ELEMENT. `Array.prototype.filter` is a pass-through, so a field added to the
// element type travelled whole even when the scheme filter kept the element.
const BAIT_ENDPOINT_EXTRA_FIELD = "/home/victim/.ssh/id_ed25519";

const WORKSPACE_ID = "ws:11111111-2222-5333-8444-555555555555";
const WORKSPACE_LABEL = "secret-ledger";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ format: "pem", type: "spki" }).toString(),
    priv: privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  };
}

/** A workspace ref exactly as `deriveWorkspaceId` writes it locally. */
function workspaceRef() {
  return {
    id: WORKSPACE_ID,
    path: BAIT_WORKSPACE_PATH,
    host: "claude",
    label: WORKSPACE_LABEL,
    repo: BAIT_REPO
  };
}

/**
 * A presence record carrying EVERY field of `H2ASession` — the fixture test 3
 * uses as the ratchet. Valid on purpose: `writePresence` validates with
 * `isH2ASession`, so the bait has to live inside a well-formed record.
 */
function baitedSession(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    instance: INSTANCE,
    host: "claude",
    pid: BAIT_PID,
    startedAt: new Date(NOW - 3_600_000).toISOString(),
    heartbeatAt: new Date(NOW - 2_000).toISOString(),
    state: "live",
    interests: BAIT_NESTED_INTERESTS,
    subscribedTopics: ["presence.peer_joined"],
    workStatus: "working",
    launchContext: {
      cwd: BAIT_CWD,
      command: BAIT_COMMAND,
      resumeCommand: BAIT_RESUME,
      tty: BAIT_TTY,
      tmux: {
        session: BAIT_TMUX_SESSION,
        window: BAIT_TMUX_WINDOW,
        pane: BAIT_TMUX_PANE
      }
    },
    workspace: workspaceRef(),
    name: WORKSPACE_LABEL,
    version: { cli: "0.85.25", skill: "0.66.0" },
    mirroredAt: BAIT_MIRRORED_AT,
    lastMcpActivityAt: new Date(NOW - 30_000).toISOString(),
    ...overrides
  };
}

/** A registry row carrying every field of `H2AActorRegistration`. */
function baitedRegistration(pub, overrides = {}) {
  return {
    id: INSTANCE,
    instance: INSTANCE,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    principal: "principal:owner",
    conductor: "claude:conductor:bbbbbbbbbbbb",
    capabilities: ["negotiate", "attest"],
    declaredCapabilities: ["code"],
    endpoints: [
      { kind: "local-files", uri: BAIT_ENDPOINT_URI },
      // Survives the scheme filter, so the ELEMENT itself is what must be
      // rebuilt from a plan rather than passed through.
      {
        kind: "remote",
        uri: "https://h2a.example.test/mirror",
        secretPath: BAIT_ENDPOINT_EXTRA_FIELD
      }
    ],
    publicKeys: [pub],
    acceptedPolicies: ["policy:default"],
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    agentUuid: "11111111-2222-4333-8444-555555555555",
    workspace: workspaceRef(),
    name: WORKSPACE_LABEL,
    ...overrides
  };
}

/** Every string/number that must never appear in a serialized push. */
const FORBIDDEN_SUBSTRINGS = [
  BAIT_CWD,
  BAIT_COMMAND,
  BAIT_RESUME,
  BAIT_TTY,
  BAIT_TMUX_SESSION,
  BAIT_TMUX_WINDOW,
  BAIT_TMUX_PANE,
  BAIT_WORKSPACE_PATH,
  BAIT_REPO,
  BAIT_ENDPOINT_URI,
  BAIT_MIRRORED_AT,
  String(BAIT_PID),
  BAIT_NESTED_TMUX_SESSION,
  BAIT_NESTED_TMUX_PANE,
  BAIT_NESTED_CWD,
  String(BAIT_NESTED_PID),
  BAIT_ENDPOINT_EXTRA_FIELD,
  "/home/",
  "/Users/",
  "file://",
  "sk-live-",
  "mcp-serve",
  "/dev/pts"
];

function assertNothingForbidden(serialized, what) {
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.ok(
      !serialized.includes(forbidden),
      `${what} must not contain ${JSON.stringify(forbidden)} — found it in: ${serialized}`
    );
  }
}

/**
 * A real local store with the baited presence record on disk, so the builder
 * reads it through `listPresence` exactly as the daemon does.
 */
function storeWithBait(pub) {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-send-boundary-")), ".h2a");
  const store = createLocalStore({ root });
  const reg = baitedRegistration(pub);
  store.registerInstance(reg);
  writePresence(root, baitedSession());
  return { root, store, reg };
}

function mirrorBodyFromBaitedStore(pub) {
  const { root, store } = storeWithBait(pub);
  try {
    const envelope = buildInstanceMirror(store, INSTANCE, NOW);
    return { envelope, body: envelope.body };
  } finally {
    rmSync(join(root, ".."), { recursive: true, force: true });
  }
}

// ─── 1. The exact transmitted field set ─────────────────────────────────────

test("the mirror transmits EXACTLY the allowlisted presence fields", () => {
  const k = keypair();
  const { body } = mirrorBodyFromBaitedStore(k.pub);
  assert.equal(body.presence.length, 1, "the baited session must have been read");
  assert.deepEqual(Object.keys(body.presence[0]).sort(), [
    "heartbeatAt",
    "host",
    "instance",
    "interests",
    "lastMcpActivityAt",
    "name",
    "sessionId",
    "startedAt",
    "state",
    "subscribedTopics",
    "version",
    "workStatus",
    "workspace"
  ]);
  assert.deepEqual(Object.keys(body.presence[0].workspace).sort(), [
    "host",
    "id",
    "label"
  ]);
});

test("the mirror transmits EXACTLY the allowlisted registration fields", () => {
  const k = keypair();
  const { body } = mirrorBodyFromBaitedStore(k.pub);
  assert.deepEqual(Object.keys(body.registrations[0]).sort(), [
    "acceptedPolicies",
    "agentUuid",
    "capabilities",
    "conductor",
    "createdAt",
    "declaredCapabilities",
    "endpoints",
    "id",
    "instance",
    "name",
    "principal",
    "publicKeys",
    "roles",
    "scopes",
    "workspace"
  ]);
});

// ─── 2. Allowlist, not denylist ─────────────────────────────────────────────

test("a field the plan does not classify is NEVER transmitted (allowlist, not denylist)", () => {
  // The exact failure mode a denylist has: a field nobody thought about.
  const sanitized = sanitizePresenceForMirror(
    baitedSession({ apiToken: "sk-live-LATER-ADDITION", cwd2: "/home/victim/x" })
  );
  assert.equal(sanitized.apiToken, undefined);
  assert.equal(sanitized.cwd2, undefined);
  assertNothingForbidden(JSON.stringify(sanitized), "a sanitized session");
  assert.ok(!JSON.stringify(sanitized).includes("LATER-ADDITION"));
});

// ─── 3. THE RATCHET: every field of the record must be classified ───────────

test("the presence plan classifies EVERY field of a fully-populated presence record", () => {
  // THIS IS THE RATCHET. Add a field to `H2ASession` (and therefore to
  // `baitedSession`) without classifying it in PRESENCE_PLAN and this fails,
  // naming the field. The compiler enforces the same thing at build time (the
  // plan is `satisfies MirrorPlanFor<H2ASession>`), so the omission has to get
  // past BOTH to become a leak.
  assert.deepEqual(unclassifiedMirrorFields(baitedSession(), MIRROR_PRESENCE_PLAN), []);
  // The reverse direction, so the fixture cannot rot while the plan grows.
  const fixtureKeys = new Set(Object.keys(baitedSession()));
  assert.deepEqual(
    Object.keys(MIRROR_PRESENCE_PLAN).filter((field) => !fixtureKeys.has(field)),
    []
  );
});

test("the registration plan classifies EVERY field of a fully-populated registry row", () => {
  const k = keypair();
  assert.deepEqual(
    unclassifiedMirrorFields(baitedRegistration(k.pub), MIRROR_REGISTRATION_PLAN),
    []
  );
  const fixtureKeys = new Set(Object.keys(baitedRegistration(k.pub)));
  assert.deepEqual(
    Object.keys(MIRROR_REGISTRATION_PLAN).filter((field) => !fixtureKeys.has(field)),
    []
  );
});

test("unclassifiedMirrorFields REPORTS an unclassified field (the ratchet can fire)", () => {
  // A guard on the guard: test 3 is only meaningful if this function can fail.
  assert.deepEqual(
    unclassifiedMirrorFields(baitedSession({ newlyAddedField: 1 }), MIRROR_PRESENCE_PLAN),
    ["newlyAddedField"]
  );
});

test("every withheld field records WHY, from the closed vocabulary", () => {
  const reasons = new Set([
    "filesystem-path",
    "command-line",
    "process-identity",
    "terminal-coordinates",
    "receiver-stamped",
    "not-consumed-downstream"
  ]);
  const withheld = Object.entries({
    ...MIRROR_PRESENCE_PLAN,
    ...MIRROR_REGISTRATION_PLAN,
    ...MIRROR_SUBAGENT_PLAN
  }).filter(([, plan]) => plan.kind === "withhold");
  assert.ok(withheld.length > 0, "something must be withheld or the fix is absent");
  for (const [field, plan] of withheld) {
    assert.ok(reasons.has(plan.because), `${field} withheld for an unlisted reason`);
  }
  // The presence fields this whole exercise is about.
  assert.equal(MIRROR_PRESENCE_PLAN.launchContext.kind, "withhold");
  assert.equal(MIRROR_PRESENCE_PLAN.pid.kind, "withhold");
  assert.equal(MIRROR_PRESENCE_PLAN.mirroredAt.kind, "withhold");
});

// ─── 4. Hostile values do not survive serialization ─────────────────────────

test("a serialized push carries no filesystem path, command line, tmux coordinate or pid", () => {
  const k = keypair();
  const { envelope } = mirrorBodyFromBaitedStore(k.pub);
  const signed = signEnvelope(envelope, { by: INSTANCE, privateKeyPem: k.priv });
  // Exactly the bytes that would go on the wire.
  assertNothingForbidden(JSON.stringify(signed), "the signed push");
});

test("the workspace ref keeps id/host/label and drops path/repo", () => {
  const sanitized = sanitizeWorkspaceRefForMirror(workspaceRef());
  assert.deepEqual(sanitized, {
    id: WORKSPACE_ID,
    host: "claude",
    label: WORKSPACE_LABEL
  });
  // Still a valid ref — that is what lets the hosted `writePresence` accept it.
  assert.ok(isH2AWorkspaceRef(sanitized));
});

test("registration endpoints: a file:// uri is withheld, a network locator survives", () => {
  const k = keypair();
  const onlyLocal = sanitizeRegistrationForMirror(
    baitedRegistration(k.pub, { endpoints: [{ kind: "local-files", uri: BAIT_ENDPOINT_URI }] })
  );
  assert.deepEqual(onlyLocal.endpoints, []);
  const remote = sanitizeRegistrationForMirror(
    baitedRegistration(k.pub, {
      endpoints: [
        { kind: "local-files", uri: BAIT_ENDPOINT_URI },
        { kind: "remote", uri: "https://h2a.example.test/mirror" },
        // A path mislabelled as remote: `kind` is self-declared, the scheme is
        // what actually decides. A kind-based filter would ship this.
        { kind: "remote", uri: "file:///home/victim/.h2a" }
      ]
    })
  );
  assert.deepEqual(remote.endpoints, [
    { kind: "remote", uri: "https://h2a.example.test/mirror" }
  ]);
});

// ─── 4b. The NESTED level: a plan at every composite, not only at the top ────

test("nested interests: a field the interests plan does not classify is NEVER transmitted", () => {
  // The defect this closes, exactly as it was demonstrated: `interests` was
  // classified SEND, `applyPlan` copied it by reference, `isInterests` tolerated
  // the extra key, and the nested tmux/cwd/pid landed on the receiver's disk
  // through a real 202. A top-level-only allowlist does not see one level down.
  const sanitized = sanitizePresenceForMirror(baitedSession());
  assert.deepEqual(Object.keys(sanitized.interests).sort(), ["negotiations", "scopes"]);
  assert.equal(sanitized.interests.lc, undefined);
  assertNothingForbidden(JSON.stringify(sanitized.interests), "sanitized interests");
  // And the narrowed object still satisfies the guard that gates the hosted
  // write — `isInterests` requires BOTH fields, so rebuilding must not drop one.
  assert.ok(isH2ASession(sanitized));
});

test("nested endpoints: a field the endpoint plan does not classify is NEVER transmitted", () => {
  const k = keypair();
  const sanitized = sanitizeRegistrationForMirror(baitedRegistration(k.pub));
  assert.deepEqual(sanitized.endpoints, [
    { kind: "remote", uri: "https://h2a.example.test/mirror" }
  ]);
  assertNothingForbidden(JSON.stringify(sanitized.endpoints), "sanitized endpoints");
});

test("the interests and endpoint plans classify EVERY field of their source type", () => {
  // The nested half of the ratchet's runtime companion. The compile-time half is
  // `satisfies MirrorPlanFor<H2ASessionInterests>` / `MirrorPlanFor<endpoint>`,
  // which is what actually fails the build; this names the field when it happens.
  assert.deepEqual(
    unclassifiedMirrorFields({ scopes: [], negotiations: [] }, MIRROR_INTERESTS_PLAN),
    []
  );
  assert.deepEqual(
    unclassifiedMirrorFields({ kind: "remote", uri: "https://h/" }, MIRROR_ENDPOINT_PLAN),
    []
  );
  // Both can fire — a guard that cannot fire proves nothing.
  assert.deepEqual(
    unclassifiedMirrorFields(BAIT_NESTED_INTERESTS, MIRROR_INTERESTS_PLAN),
    ["lc"]
  );
  assert.deepEqual(
    unclassifiedMirrorFields(
      { kind: "remote", uri: "https://h/", secretPath: BAIT_ENDPOINT_EXTRA_FIELD },
      MIRROR_ENDPOINT_PLAN
    ),
    ["secretPath"]
  );
});

// ─── 4c. The endpoint filter must not be able to kill the push ───────────────

test("a non-array endpoints field yields [] instead of throwing (availability)", () => {
  // `isH2AActorRegistration` would reject this, but it is NEVER called on any
  // production path: `handleRegisterInstance` validates `typeof === "object"` and
  // `store.registerInstance` validates nothing, so this row is accepted and
  // written to `instances.jsonl`. Pre-fix `build.ts` shipped `reg` verbatim and
  // never touched `endpoints`, so an unguarded `endpoints.filter` would be a
  // dead-push fault INTRODUCED by the send boundary — availability-negative for
  // no confidentiality gain.
  const k = keypair();
  const hostile = baitedRegistration(k.pub, {
    roles: "NOTANARRAY",
    endpoints: "nope",
    publicKeys: "nope"
  });
  const sanitized = sanitizeRegistrationForMirror(hostile);
  assert.deepEqual(sanitized.endpoints, []);
});

test("buildInstanceMirror survives a stored registration whose endpoints is not an array", () => {
  // The same thing where it actually mattered: the throw propagated out of
  // `buildInstanceMirror` and killed the beat.
  const k = keypair();
  const tmp = mkdtempSync(join(tmpdir(), "h2a-send-boundary-nonarray-"));
  const root = join(tmp, ".h2a");
  try {
    const store = createLocalStore({ root });
    store.registerInstance(
      baitedRegistration(k.pub, { endpoints: "nope", publicKeys: "nope" })
    );
    const envelope = buildInstanceMirror(store, INSTANCE, NOW);
    assert.deepEqual(envelope.body.registrations[0].endpoints, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── 4d. What the plans do NOT cover, asserted so it cannot be forgotten ─────

test("DISCLOSED GAP: free-text element values inside scopes[] still travel", () => {
  // Not a bug report — a pinned disclosure. A field plan bounds the SHAPE of what
  // travels; it cannot bound the CONTENT of a string an agent chose. A plain
  // `h2a_session_open` (which copies `interests.scopes` verbatim — see
  // `runtime/mcp/sessions.ts`) puts this on the hosted disk with no privilege, no
  // malformed record and no older CLI involved. If someone later closes this, the
  // test fails and the disclosure in the feed contract must be updated with it.
  const scope = "scope:/home/antoinefa/Documents/private-directory-name";
  const sanitized = sanitizePresenceForMirror(
    baitedSession({ interests: { scopes: [scope], negotiations: [] } })
  );
  assert.deepEqual(sanitized.interests.scopes, [scope]);
});

test("DISCLOSED GAP: the endpoint scheme filter is a locator test, not a content test", () => {
  // Vindicated where it claims to work — every scheme variant is rejected — and
  // honest about what it does not do: a network locator carrying a path, a query,
  // a fragment or credentials in its userinfo is still a network locator.
  const k = keypair();
  const uri = (u) => ({ kind: "remote", uri: u });
  const rejected = sanitizeRegistrationForMirror(
    baitedRegistration(k.pub, {
      endpoints: [
        uri("FILE:///home/victim/.h2a"),
        uri("File:///home/victim/.h2a"),
        uri("  file:///home/victim/.h2a"),
        uri("file:/home/victim/.h2a"),
        uri("data:text/plain,/home/victim"),
        uri("javascript:alert(1)"),
        uri("//h2a.example.test/mirror"),
        uri("/home/victim/.h2a")
      ]
    })
  );
  assert.deepEqual(rejected.endpoints, [], "no scheme variant may slip through");
  const travels = sanitizeRegistrationForMirror(
    baitedRegistration(k.pub, {
      endpoints: [
        uri("http://localhost/home/antoinefa/Documents"),
        uri("https://h/?cwd=/home/antoinefa"),
        uri("https://h/#/home/antoinefa"),
        uri("https://leakuser:sk-live-TOKEN@h/")
      ]
    })
  );
  assert.equal(travels.endpoints.length, 4, "all four are network locators, so all travel");
});

// ─── 5. The signature still covers the transmitted body ─────────────────────

test("the signature verifies over the sanitized body after a JSON round-trip", () => {
  const k = keypair();
  const { envelope } = mirrorBodyFromBaitedStore(k.pub);
  const signed = signEnvelope(envelope, { by: INSTANCE, privateKeyPem: k.priv });
  const onTheWire = JSON.parse(JSON.stringify(signed));
  assert.ok(verifyEnvelopeSignature(onTheWire, k.pub, { by: INSTANCE }));
  // And tampering with the sanitized body still breaks it (the guarantee is not
  // vacuous just because the body got smaller).
  const tampered = JSON.parse(JSON.stringify(signed));
  tampered.body.presence[0].workspace.label = "other";
  assert.ok(!verifyEnvelopeSignature(tampered, k.pub, { by: INSTANCE }));
});

// ─── 6. The narrowed record still satisfies the hosted write contract ───────

test("a narrowed presence record still satisfies isH2ASession (hosted writePresence)", () => {
  // `serve.ts` writes through `writePresence`, which THROWS on a record that
  // fails this guard — and that throw is uncaught in the HTTP handler. So this
  // is the property that keeps the ingester from 500-ing on a narrowed push.
  assert.ok(isH2ASession(sanitizePresenceForMirror(baitedSession())));
});

// ─── 7. End-to-end: the real ingester still accepts, and stores nothing bad ──

test("the real ingester accepts a narrowed push (202) and what comes to rest is clean", async () => {
  const k = keypair();
  const senderTmp = mkdtempSync(join(tmpdir(), "h2a-send-boundary-sender-"));
  const receiverTmp = mkdtempSync(join(tmpdir(), "h2a-send-boundary-recv-"));
  const senderRoot = join(senderTmp, ".h2a");
  const receiverRoot = join(receiverTmp, ".h2a");
  try {
    const senderStore = createLocalStore({ root: senderRoot });
    senderStore.registerInstance(baitedRegistration(k.pub));
    writePresence(senderRoot, baitedSession());

    const envelope = buildInstanceMirror(senderStore, INSTANCE, Date.now());
    const signed = signEnvelope(envelope, { by: INSTANCE, privateKeyPem: k.priv });

    const receiverStore = createLocalStore({ root: receiverRoot });
    const server = mirrorServerForStore(receiverStore, { enrolledKeys: [k.pub] });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    let status;
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/h2a/mirror`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signed)
      });
      status = res.status;
      await res.json();
    } finally {
      await new Promise((r) => server.close(r));
    }
    assert.equal(status, 202, "the narrowed push must still be accepted");

    // What came to rest on the receiver's disk — the thing a read-side
    // sanitizer could never have protected.
    const presenceDir = join(receiverRoot, "presence");
    const files = readdirSync(presenceDir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1);
    const stored = readFileSync(join(presenceDir, files[0]), "utf8");
    assertNothingForbidden(stored, "the stored presence record");
    const parsed = JSON.parse(stored);
    assert.equal(parsed.launchContext, undefined);
    assert.equal(parsed.pid, undefined);
    assert.equal(parsed.workspace.path, undefined);
    assert.equal(parsed.workspace.label, WORKSPACE_LABEL, "the label must survive");
    // `mirroredAt` is the RECEIVER's stamp, never the sender's forged one.
    assert.ok(parsed.mirroredAt !== BAIT_MIRRORED_AT);

    const instances = readFileSync(join(receiverRoot, "registry", "instances.jsonl"), "utf8");
    assertNothingForbidden(instances, "the stored registry row");
    const storedReg = JSON.parse(instances.trim().split("\n").pop());
    assert.deepEqual(storedReg.publicKeys, [k.pub], "publicKeys must survive");
    assert.deepEqual(storedReg.capabilities, ["negotiate", "attest"]);
  } finally {
    rmSync(senderTmp, { recursive: true, force: true });
    rmSync(receiverTmp, { recursive: true, force: true });
  }
});

// ─── 8. The feed still works on a narrowed record ───────────────────────────

test("the feed still derives a real workspaceLabel from a narrowed record", () => {
  const k = keypair();
  const sanitizedSession = sanitizePresenceForMirror(baitedSession());
  const sanitizedReg = sanitizeRegistrationForMirror(baitedRegistration(k.pub));
  const feed = buildFeedResponse({
    asOf: NOW,
    sessions: [sanitizedSession],
    registrations: [sanitizedReg]
  });
  assert.equal(feed.instances.length, 1);
  assert.equal(feed.instances[0].workspaceLabel, WORKSPACE_LABEL);
  assert.equal(feed.instances[0].host, "claude");
  assert.equal(feed.instances[0].role, "AGENTS");
  assert.equal(feed.sessions.length, 1);
  assert.equal(feed.sessions[0].topicOrTitle, WORKSPACE_LABEL);
  assert.equal(feed.sessions[0].activitySource, "mcp");
  assertNothingForbidden(JSON.stringify(feed), "the feed response");
});
