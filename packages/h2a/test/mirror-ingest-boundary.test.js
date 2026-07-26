/**
 * The mirror's INGEST boundary — the symmetric half of `mirror-send-boundary`.
 *
 * The send boundary narrows what THIS CLI pushes. It protects nothing against a
 * DIFFERENT sender, and the ingest path used to write whatever a verified sender
 * handed it. So the subject here is a hostile push from an **un-upgraded sender**
 * — a client running a CLI older than the send boundary, which is not a
 * hypothetical adversary but the ordinary state of any agent that has not
 * updated — driven through the REAL `mirrorServerForStore` into a REAL store.
 *
 * ── HOW THESE TESTS TRY NOT TO BE VACUOUS ──────────────────────────────────
 *
 * Three failure modes were paid for on the send-boundary PR and are guarded
 * against explicitly here:
 *
 *  1. **A bait in a field nothing reads is inert.** `acceptMirrorEnvelope` only
 *     applies registrations whose `publicKeys` contain the verified key, presence
 *     whose `instance` is owned by one of them, and subagents whose
 *     `parentInstance` is. A bait outside those gates proves nothing. Every
 *     fixture below satisfies the gates, and {@link assertBaitWasActuallyApplied}
 *     asserts the RECORD COUNT at rest before any content assertion runs.
 *  2. **A 202 is not evidence.** A push that applied zero records also returns
 *     202. The count assertion comes first, so a test that stops proving anything
 *     fails on its precondition instead of passing on its conclusion.
 *  3. **An absolute instant is a time bomb.** `NOW` is the run clock; every
 *     fixture timestamp is an offset from it. The send-boundary suite was
 *     permanently red for a day because a pinned calendar instant fell outside
 *     the replay guard's freshness window, and two reviewers reproduced its green
 *     only because both ran inside the same 90-second window.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H2A_PROTOCOL,
  H2A_VERSION,
  INGEST_NARROWERS,
  buildInstanceMirror,
  createLocalStore,
  droppedKeyPaths,
  mirrorServerForStore,
  signEnvelope,
  writePresence
} from "../dist/index.js";

/**
 * The run clock. NOT a calendar constant — see the header. The replay guard has a
 * freshness window around "now", so a pinned instant makes every test here fail
 * once the window passes, and pass for anyone who happens to run it in time.
 */
const NOW = Date.now();

const INSTANCE = "agent:ingest-bait";
const SESSION_ID = "sess:ingest-bait";
const WORKSPACE_LABEL = "a2a-cli";

/**
 * Bait values. Distinctive enough that a substring scan over the bytes at rest
 * cannot match them by accident, and shaped like the real thing: the live
 * measurement that motivated this work found 28 of 28 presence records carrying
 * an absolute path, one of which was the owner's personal tax directory.
 */
const BAIT_DIR = "/home/victim/impots-2025-INGEST-BAIT";
const BAIT_COMMAND = "claude --dangerously-skip-permissions INGESTBAITCMD";
const BAIT_TTY = "/dev/pts/INGESTBAIT";
const BAIT_TMUX_SESSION = "tmux-INGESTBAIT";
const BAIT_TMUX_PANE = "%INGESTBAIT";
const BAIT_PID = 424242;
const BAIT_REPO = "git@github.com:victim/INGESTBAITREPO.git";
const BAIT_FILE_URI = `file://${BAIT_DIR}/.h2a`;
const BAIT_UNCLASSIFIED = "INGESTBAIT-UNCLASSIFIED-FIELD";
const BAIT_MIRRORED_AT = new Date(NOW - 86_400_000).toISOString();

/** Every bait string that must never reach disk. */
const FORBIDDEN = [
  BAIT_DIR,
  BAIT_COMMAND,
  BAIT_TTY,
  BAIT_TMUX_SESSION,
  BAIT_TMUX_PANE,
  String(BAIT_PID),
  BAIT_REPO,
  BAIT_FILE_URI,
  BAIT_UNCLASSIFIED,
  "launchContext",
  "file://"
];

function assertNothingForbidden(text, what) {
  const hits = FORBIDDEN.filter((needle) => text.includes(needle));
  assert.deepEqual(hits, [], `${what} must not carry ${JSON.stringify(hits)}`);
}

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ format: "pem", type: "spki" }).toString(),
    priv: privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  };
}

/** A workspace ref exactly as a pre-send-boundary CLI wrote it: with the path. */
function baitedWorkspace() {
  return {
    id: "ws:0123456789abcdef",
    host: "claude",
    label: WORKSPACE_LABEL,
    path: BAIT_DIR,
    repo: BAIT_REPO
  };
}

/**
 * A registration exactly as an UN-UPGRADED sender puts it on the wire: the raw
 * registry row, workspace path and `file://` endpoint included.
 *
 * `publicKeys` carries the verified pem because that is the gate
 * `acceptMirrorEnvelope` authorizes on — without it the record is dropped as
 * `instance-key-mismatch` and every assertion downstream would be vacuous.
 */
function baitedRegistration(pub) {
  return {
    id: INSTANCE,
    instance: INSTANCE,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: ["negotiate", "attest"],
    publicKeys: [pub],
    acceptedPolicies: [],
    createdAt: new Date(NOW - 3_600_000).toISOString(),
    endpoints: [
      { kind: "local-files", uri: BAIT_FILE_URI },
      { kind: "remote", uri: "https://mirror.example/h2a/mirror" }
    ],
    workspace: baitedWorkspace()
  };
}

/** A presence record exactly as an UN-UPGRADED sender puts it on the wire. */
function baitedSession() {
  return {
    sessionId: SESSION_ID,
    instance: INSTANCE,
    host: "claude",
    name: "ingest-bait",
    startedAt: new Date(NOW - 3_600_000).toISOString(),
    heartbeatAt: new Date(NOW - 2_000).toISOString(),
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [],
    pid: BAIT_PID,
    launchContext: {
      cwd: BAIT_DIR,
      command: BAIT_COMMAND,
      tty: BAIT_TTY,
      tmux: { session: BAIT_TMUX_SESSION, pane: BAIT_TMUX_PANE }
    },
    workspace: baitedWorkspace(),
    // A sender-forged provenance stamp. The receiver must overwrite it, because
    // `deriveLiveness` reads `mirroredAt` to decide staleness.
    mirroredAt: BAIT_MIRRORED_AT,
    // A field NO plan classifies — the ingest-side version of "a new field must
    // not travel by default". `applyPlan` iterates the plan, so it is never read.
    evilUnclassifiedField: BAIT_UNCLASSIFIED
  };
}

function baitedSubagent() {
  return {
    // `validateSubagentBinding` requires id === `${parentInstance}~${name}`.
    id: `${INSTANCE}~helper`,
    parentInstance: INSTANCE,
    name: "helper",
    capabilities: ["negotiate"],
    createdAt: new Date(NOW - 1_000).toISOString()
  };
}

/** The envelope an un-upgraded sender produces: raw records, nothing narrowed. */
function unUpgradedEnvelope(pub, seq, mutate = (body) => body) {
  return {
    protocol: H2A_PROTOCOL,
    version: H2A_VERSION,
    id: `mirror:${INSTANCE}:${seq}`,
    type: "event",
    actor: { instance: INSTANCE, role: "AGENTS", scope: "scope:default" },
    target: { instance: INSTANCE },
    body: mutate({
      kind: "mirror.instances",
      registrations: [baitedRegistration(pub)],
      presence: [baitedSession()],
      seq,
      subagents: [baitedSubagent()]
    }),
    createdAt: new Date(seq).toISOString()
  };
}

/** A receiver store on a fresh mkdtemp root. Never touches a live h2a root. */
function receiver() {
  const tmp = mkdtempSync(join(tmpdir(), "h2a-ingest-boundary-"));
  const root = join(tmp, ".h2a");
  return { tmp, root, store: createLocalStore({ root }) };
}

async function post(server, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/h2a/mirror`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // A bounded wait, so a regression that stops responding fails the test
    // instead of hanging the suite. Before the apply-throw was contained, the
    // ingester died mid-request and the client waited forever.
    signal: AbortSignal.timeout(15_000)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Run `fn` against a live in-process ingester on 127.0.0.1. Never a real host. */
async function withIngester(store, options, fn) {
  const server = mirrorServerForStore(store, options);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(server);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function presenceFiles(root) {
  const dir = join(root, "presence");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
}

function instanceRows(root) {
  const file = join(root, "registry", "instances.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
}

/**
 * The precondition, asserted BEFORE any content claim: the push actually landed
 * records. A 202 alone is compatible with zero records applied, which is exactly
 * how a boundary test quietly stops testing anything.
 */
function assertBaitWasActuallyApplied(root) {
  assert.equal(
    presenceFiles(root).length,
    1,
    "the baited presence record must have been APPLIED, or every assertion below is vacuous"
  );
  assert.equal(
    instanceRows(root).length,
    1,
    "the baited registration must have been APPLIED, or every assertion below is vacuous"
  );
}

// ── 1. The whole point ──────────────────────────────────────────────────────

test("an UN-UPGRADED sender cannot land a path through the real ingest path", async () => {
  const k = keypair();
  const { tmp, root, store } = receiver();
  try {
    const signed = signEnvelope(unUpgradedEnvelope(k.pub, NOW), {
      by: INSTANCE,
      privateKeyPem: k.priv
    });

    // The bait must be ON THE WIRE, or this test proves nothing about ingest.
    const onTheWire = JSON.stringify(signed);
    for (const needle of [BAIT_DIR, BAIT_COMMAND, String(BAIT_PID), BAIT_FILE_URI]) {
      assert.ok(onTheWire.includes(needle), `the pushed envelope must carry ${needle}`);
    }

    const res = await withIngester(store, { enrolledKeys: [k.pub] }, (s) => post(s, signed));
    assert.equal(res.status, 202, "an un-upgraded sender must still be accepted, not refused");

    assertBaitWasActuallyApplied(root);

    // Bytes at rest, not a status code.
    const stored = readFileSync(join(root, "presence", presenceFiles(root)[0]), "utf8");
    assertNothingForbidden(stored, "the stored presence record");
    const session = JSON.parse(stored);
    assert.equal(session.launchContext, undefined);
    assert.equal(session.pid, undefined);
    assert.equal(session.evilUnclassifiedField, undefined);
    assert.equal(session.workspace.path, undefined);
    assert.equal(session.workspace.repo, undefined);
    // What must SURVIVE — narrowing that also destroys the feature is not a fix.
    assert.equal(session.workspace.label, WORKSPACE_LABEL);
    assert.equal(session.sessionId, SESSION_ID);
    assert.equal(session.instance, INSTANCE);
    assert.deepEqual(session.interests, { scopes: ["scope:default"], negotiations: [] });
    assert.notEqual(session.mirroredAt, BAIT_MIRRORED_AT, "the receiver must stamp provenance itself");

    const rows = instanceRows(root);
    assertNothingForbidden(rows.join("\n"), "the stored registry row");
    const reg = JSON.parse(rows[0]);
    assert.equal(reg.workspace.path, undefined);
    assert.deepEqual(
      reg.endpoints,
      [{ kind: "remote", uri: "https://mirror.example/h2a/mirror" }],
      "the file:// endpoint must be filtered and the network one kept"
    );
    assert.deepEqual(reg.publicKeys, [k.pub], "publicKeys must survive — the receiver authorizes on it");
    assert.deepEqual(reg.capabilities, ["negotiate", "attest"], "capabilities gate receiver-side authorization");

    // The subagent binding is the third payload member and lands too.
    const subagents = readFileSync(join(root, "registry", "subagents.jsonl"), "utf8");
    assertNothingForbidden(subagents, "the stored subagent binding");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 2. Ordering: nothing reaches disk before verification ───────────────────

test("a record that FAILS verification lands nothing at all", async () => {
  const k = keypair();
  const other = keypair();
  const { tmp, root, store } = receiver();
  try {
    // Signed by a key the receiver does not trust: verification fails, so the
    // apply callbacks — and therefore narrowing — are never reached. This is the
    // evidence for "narrowing happens AFTER verification and nothing raw is
    // written before it": if any raw record were written pre-verification, it
    // would be on disk here.
    const signed = signEnvelope(unUpgradedEnvelope(k.pub, NOW), {
      by: INSTANCE,
      privateKeyPem: other.priv
    });
    const res = await withIngester(store, { enrolledKeys: [k.pub] }, (s) => post(s, signed));
    assert.equal(res.status, 401);
    assert.equal(presenceFiles(root).length, 0, "a rejected push must write no presence");
    assert.equal(instanceRows(root).length, 0, "a rejected push must write no registry row");

    // The ONLY thing the ingest path writes before narrowing is the sequence
    // fence, and it is reached only after verification. Named precisely rather
    // than claiming "nothing is written": it stores the verified signer's id and
    // a number, and no record field.
    const fence = join(root, "identity", "mirror-seq.json");
    if (existsSync(fence)) assertNothingForbidden(readFileSync(fence, "utf8"), "the sequence fence");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("the sequence fence carries only the signer id and a number", async () => {
  const k = keypair();
  const { tmp, root, store } = receiver();
  try {
    const signed = signEnvelope(unUpgradedEnvelope(k.pub, NOW), {
      by: INSTANCE,
      privateKeyPem: k.priv
    });
    await withIngester(store, { enrolledKeys: [k.pub] }, (s) => post(s, signed));
    const fence = readFileSync(join(root, "identity", "mirror-seq.json"), "utf8");
    assertNothingForbidden(fence, "the sequence fence");
    assert.deepEqual(Object.keys(JSON.parse(fence)), [INSTANCE]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 3. Staleness is visible, not silent ────────────────────────────────────

test("the 202 reports WHAT was narrowed, so an un-upgraded sender is not silent", async () => {
  const k = keypair();
  const { tmp, store } = receiver();
  try {
    const signed = signEnvelope(unUpgradedEnvelope(k.pub, NOW), {
      by: INSTANCE,
      privateKeyPem: k.priv
    });
    const res = await withIngester(store, { enrolledKeys: [k.pub] }, (s) => post(s, signed));
    assert.equal(res.status, 202);
    assert.ok(res.json.narrowed.records >= 2, "both the registration and the presence record were narrowed");
    const fields = res.json.narrowed.fields;
    for (const expected of ["launchContext", "pid", "workspace.path", "workspace.repo", "endpoints[]"]) {
      assert.ok(fields.includes(expected), `the report must name ${expected}, got ${JSON.stringify(fields)}`);
    }
    // Names, never values.
    assertNothingForbidden(JSON.stringify(res.json), "the 202 response body");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("NEGATIVE CONTROL: an UP-TO-DATE sender narrows nothing and reports zero", async () => {
  const k = keypair();
  const sender = receiver();
  const recv = receiver();
  try {
    // Built by the real send boundary, so the records are already narrowed.
    sender.store.registerInstance(baitedRegistration(k.pub));
    writePresence(sender.root, baitedSession());
    const envelope = buildInstanceMirror(sender.store, INSTANCE, NOW);
    assert.equal(envelope.body.presence.length, 1, "the sender must actually be pushing a record");
    const signed = signEnvelope(envelope, { by: INSTANCE, privateKeyPem: k.priv });

    const res = await withIngester(recv.store, { enrolledKeys: [k.pub] }, (s) => post(s, signed));
    assert.equal(res.status, 202);
    assertBaitWasActuallyApplied(recv.root);
    assert.deepEqual(
      res.json.narrowed,
      { records: 0, fields: [] },
      "a sender with the send boundary must have nothing left to narrow — if this is non-zero the two boundaries disagree"
    );
  } finally {
    rmSync(sender.tmp, { recursive: true, force: true });
    rmSync(recv.tmp, { recursive: true, force: true });
  }
});

// ── 4. The ingest ratchet ──────────────────────────────────────────────────

test("every record-carrying member of the mirror body has an ingest narrower", () => {
  // The compile-time half is `INGEST_NARROWERS satisfies { [K in
  // MirrorBodyRecordMember]: ... }` — adding `tasks: H2ATask[]` to
  // `H2AInstanceMirrorBody` fails the build. Verified by doing it: tsc reports
  // "Property 'tasks' is missing in type ... but required in type ...".
  //
  // This runtime test covers the hole that cannot close: a member typed `any[]`
  // (or `any`) resolves BOTH branches of the conditional, so the mapped type
  // stops requiring it and the compiler says nothing. It reads the real body a
  // real sender builds, so it cannot be silenced by editing a fixture.
  const k = keypair();
  const sender = receiver();
  try {
    sender.store.registerInstance(baitedRegistration(k.pub));
    writePresence(sender.root, baitedSession());
    const body = buildInstanceMirror(sender.store, INSTANCE, NOW).body;

    const recordMembers = Object.entries(body)
      .filter(([, value]) => Array.isArray(value) && value.every((e) => typeof e === "object" && e !== null))
      .filter(([, value]) => value.length > 0)
      .map(([key]) => key);
    assert.ok(recordMembers.length >= 3, "the fixture must exercise every payload member");

    const unnarrowed = recordMembers.filter((member) => typeof INGEST_NARROWERS[member] !== "function");
    assert.deepEqual(
      unnarrowed,
      [],
      "a body member carrying records with no ingest narrower lands them RAW — give it one in INGEST_NARROWERS"
    );
  } finally {
    rmSync(sender.tmp, { recursive: true, force: true });
  }
});

test("droppedKeyPaths is empty exactly when narrowing removed nothing", () => {
  assert.deepEqual(droppedKeyPaths({ a: 1 }, { a: 1 }), []);
  // Absent-and-empty is not a removal — otherwise every unset optional field
  // would be reported and the real signal would drown.
  assert.deepEqual(droppedKeyPaths({ a: 1, b: undefined, c: null }, { a: 1 }), []);
  assert.deepEqual(droppedKeyPaths({ a: 1, b: 2 }, { a: 1 }), ["b"]);
  assert.deepEqual(droppedKeyPaths({ w: { keep: 1, drop: 2 } }, { w: { keep: 1 } }), ["w.drop"]);
  assert.deepEqual(droppedKeyPaths({ e: [1, 2] }, { e: [1] }), ["e[]"]);
});

// ── 5. A boundary that dies is not a boundary ──────────────────────────────

test("a repeat beat is idempotent — it does not throw, duplicate, or kill the ingester", async () => {
  const k = keypair();
  const { tmp, root, store } = receiver();
  try {
    await withIngester(store, { enrolledKeys: [k.pub] }, async (s) => {
      const first = await post(s, signEnvelope(unUpgradedEnvelope(k.pub, NOW), { by: INSTANCE, privateKeyPem: k.priv }));
      assert.equal(first.status, 202);
      // A mirror daemon beats every 15-30 s. Before this fix the SECOND beat threw
      // `Instance already registered` out of the request handler as an uncaught
      // exception, terminating the ingester — and the sender got no response at
      // all, so the test process reaching this line is itself the assertion.
      const second = await post(s, signEnvelope(unUpgradedEnvelope(k.pub, NOW + 1_000), { by: INSTANCE, privateKeyPem: k.priv }));
      assert.equal(second.status, 202, "the second beat must be accepted, not fatal");
      const third = await post(s, signEnvelope(unUpgradedEnvelope(k.pub, NOW + 2_000), { by: INSTANCE, privateKeyPem: k.priv }));
      assert.equal(third.status, 202, "the ingester must still be serving");
    });
    assert.equal(instanceRows(root).length, 1, "a repeat beat must not duplicate the registry row");
    assert.equal(presenceFiles(root).length, 1);
    assertNothingForbidden(readFileSync(join(root, "presence", presenceFiles(root)[0]), "utf8"), "presence after 3 beats");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("a store-writer throw becomes a 500 and leaves the ingester serving", async () => {
  const k = keypair();
  const { tmp, store } = receiver();
  try {
    await withIngester(store, { enrolledKeys: [k.pub] }, async (s) => {
      // `validateSubagentBinding` rejects an id that is not `parent~name`, and
      // `registerSubagent` throws `Invalid subagent binding (…)` — one of the
      // three throws the existing `/already registered/i` filter does NOT catch.
      const bad = signEnvelope(
        unUpgradedEnvelope(k.pub, NOW, (body) => ({
          ...body,
          subagents: [{ ...baitedSubagent(), id: "nhi:not-an-address" }]
        })),
        { by: INSTANCE, privateKeyPem: k.priv }
      );
      const res = await post(s, bad);
      assert.equal(res.status, 500, "a store-writer throw must be answered, not fatal");
      // No exception message: they interpolate record content.
      assertNothingForbidden(JSON.stringify(res.json), "the 500 body");
      assert.equal(res.json.error, "apply-failed");

      // The process is alive and the server still serving — which is the whole
      // claim. Before this, the throw escaped as an uncaught exception.
      const ok = await post(s, signEnvelope(unUpgradedEnvelope(k.pub, NOW + 1_000), { by: INSTANCE, privateKeyPem: k.priv }));
      assert.equal(ok.status, 202, "the ingester must still be serving after a store-writer throw");
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
