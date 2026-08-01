import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H2A_DRUMBEAT_RESUME_BODY_KIND,
  createEnvelope,
  createReplayGuard,
  parseDrumbeatResumeBody,
  signEnvelope
} from "@sentropic/h2a";
import {
  acceptRemoteEnvelope,
  createLocalStore,
  recordStop,
  readDrumbeatEntry,
  relanceFromInbox,
  remoteRelauncher,
  runDrumbeatRelanceInbox
} from "../dist/index.js";
import {
  drumbeatResumeInboxTargets,
  runDrumbeatWatch as runCliDrumbeatWatch
} from "../dist/cli.js";

const SIGNER = "codex:watch";
const TARGET = "claude:remote";

test("drumbeat watch bounds D4 inbox draining to actionable stop entries", () => {
  assert.deepEqual(
    drumbeatResumeInboxTargets([
      { instance: "claude:paused", workStatus: "paused" },
      { instance: "claude:done", workStatus: "done" },
      { instance: "claude:terminal", workStatus: "out-of-tokens", terminal: "escalate" }
    ]),
    ["claude:paused"]
  );
});

function freshRoot(prefix = "h2a-d4-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function writePem(root, pem) {
  const file = join(root, "key.pem");
  writeFileSync(file, pem, "utf8");
  return file;
}

function register(store, instance, overrides = {}) {
  store.registerInstance({
    id: instance,
    instance,
    roles: ["AGENTS"],
    scopes: ["scope:demo"],
    capabilities: ["drumbeat"],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-30T00:00:00.000Z",
    ...overrides
  });
}

function resumeEnvelope(id = "env-resume-1", body = {}) {
  return createEnvelope({
    id,
    type: "event",
    actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
    target: { instance: TARGET },
    body: {
      kind: H2A_DRUMBEAT_RESUME_BODY_KIND,
      target: TARGET,
      reason: "stopped",
      requestedBy: SIGNER,
      ...body
    },
    createdAt: new Date().toISOString()
  });
}

function finding(overrides = {}) {
  return {
    instance: TARGET,
    reason: "stopped",
    workStatus: "paused",
    relanceCount: 0,
    launchContext: { cwd: "/remote", command: "claude --resume" },
    ...overrides
  };
}

function captureStreams(cwd = () => process.cwd()) {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (c) => void (stdout += c) },
      stderr: { write: (c) => void (stderr += c) },
      cwd
    },
    out: () => stdout,
    err: () => stderr
  };
}

test("remoteRelauncher signs and posts a drumbeat.resume envelope to the resolved endpoint", async () => {
  const sent = [];
  const r = remoteRelauncher({
    actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
    privateKeyPem: "PRIVATE",
    resolveEndpoint: (instance) => (instance === TARGET ? "http://remote/h2a/envelopes" : undefined),
    sendImpl: async (url, envelope, options) => {
      sent.push({ url, envelope, options });
      return { status: 202, body: { ok: true } };
    }
  });

  const ok = await r.relance(finding());

  assert.equal(ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "http://remote/h2a/envelopes");
  assert.equal(sent[0].options.by, SIGNER);
  assert.equal(sent[0].options.privateKeyPem, "PRIVATE");
  assert.equal(sent[0].envelope.actor.instance, SIGNER);
  assert.equal(sent[0].envelope.target.instance, TARGET);
  assert.deepEqual(parseDrumbeatResumeBody(sent[0].envelope.body), {
    kind: H2A_DRUMBEAT_RESUME_BODY_KIND,
    target: TARGET,
    reason: "stopped",
    requestedBy: SIGNER
  });
});

test("remoteRelauncher declines without an endpoint or when the POST fails", async () => {
  const noEndpoint = remoteRelauncher({
    actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
    privateKeyPem: "PRIVATE",
    resolveEndpoint: () => undefined,
    sendImpl: async () => {
      throw new Error("should not send");
    }
  });
  assert.equal(await noEndpoint.relance(finding()), false);

  const rejected = remoteRelauncher({
    actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
    privateKeyPem: "PRIVATE",
    resolveEndpoint: () => "http://remote/h2a/envelopes",
    sendImpl: async () => ({ status: 503, body: { ok: false } })
  });
  assert.equal(await rejected.relance(finding()), false);

  const thrown = remoteRelauncher({
    actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
    privateKeyPem: "PRIVATE",
    resolveEndpoint: () => "http://remote/h2a/envelopes",
    sendImpl: async () => {
      throw new Error("network down");
    }
  });
  assert.equal(await thrown.relance(finding()), false);
});

test("relanceFromInbox consumes resume envelopes and relances the local stopped entry once", async () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    recordStop(root, {
      instance: TARGET,
      workStatus: "paused",
      launchContext: { cwd: "/remote", command: "claude", resumeCommand: "claude --resume abc" }
    });
    store.putInboxMessage(TARGET, resumeEnvelope());
    const calls = [];

    const first = await relanceFromInbox(root, {
      instances: [TARGET],
      relauncher: {
        relance(f) {
          calls.push(f);
          return true;
        }
      },
      now: 1780189000000
    });

    assert.deepEqual(first.relanced, [TARGET]);
    assert.equal(first.skipped.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].launchContext.resumeCommand, "claude --resume abc");
    assert.equal(readDrumbeatEntry(root, TARGET).relanceCount, 1);
    assert.equal(store.readInbox(TARGET).length, 0);

    const second = await relanceFromInbox(root, {
      instances: [TARGET],
      relauncher: { relance: () => true }
    });
    assert.deepEqual(second.relanced, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relanceFromInbox pops malformed or unknown resume requests but leaves unrelated inbox mail", async () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.putInboxMessage(TARGET, resumeEnvelope("env-malformed", { reason: undefined }));
    store.putInboxMessage(TARGET, resumeEnvelope("env-unknown", { target: "claude:missing" }));
    store.putInboxMessage(
      TARGET,
      createEnvelope({
        id: "env-message",
        type: "event",
        actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
        target: { instance: TARGET },
        body: { kind: "message", text: "keep me" },
        createdAt: new Date().toISOString()
      })
    );

    const result = await relanceFromInbox(root, {
      instances: [TARGET],
      relauncher: { relance: () => true }
    });

    assert.deepEqual(result.relanced, []);
    assert.equal(result.skipped.length, 2);
    assert.deepEqual(store.readInbox(TARGET).map((e) => e.id), ["env-message"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote relay chain delivers into the remote inbox, then local consume relances with the remote launchContext", async () => {
  const rootA = freshRoot("h2a-d4-a-");
  const rootB = freshRoot("h2a-d4-b-");
  const keys = keypair();
  try {
    const storeA = createLocalStore({ root: rootA });
    const storeB = createLocalStore({ root: rootB });
    register(storeB, SIGNER, { publicKeys: [keys.publicKeyPem] });
    recordStop(rootB, {
      instance: TARGET,
      workStatus: "paused",
      launchContext: { cwd: "/b", command: "claude", resumeCommand: "claude --resume b" }
    });
    const url = "http://remote-b/h2a/envelopes";
    register(storeA, TARGET, { endpoints: [{ kind: "remote", uri: url }] });
    const relay = remoteRelauncher({
      root: rootA,
      actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
      privateKeyPem: keys.privateKeyPem,
      sendImpl: async (actualUrl, envelope, options) => {
        assert.equal(actualUrl, url);
        storeB.putInboxMessage(
          envelope.target.instance,
          signEnvelope(envelope, { by: options.by, privateKeyPem: options.privateKeyPem })
        );
        return { status: 202, body: { ok: true } };
      }
    });
    assert.equal(await relay.relance(finding()), true);
    assert.equal(storeB.readInbox(TARGET).length, 1);

    const localCalls = [];
    const consumed = await relanceFromInbox(rootB, {
      instances: [TARGET],
      relauncher: {
        relance(f) {
          localCalls.push(f);
          return true;
        }
      }
    });
    assert.deepEqual(consumed.relanced, [TARGET]);
    assert.equal(localCalls[0].launchContext.resumeCommand, "claude --resume b");
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test("runDrumbeatRelanceInbox consumes the inbox using the local relauncher", async () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    recordStop(root, {
      instance: TARGET,
      workStatus: "paused",
      launchContext: { cwd: "/remote", command: "echo relance" }
    });
    store.putInboxMessage(TARGET, resumeEnvelope());
    const cap = captureStreams(() => root);

    const rc = await runDrumbeatRelanceInbox(
      { root, instance: TARGET, relauncher: "logging" },
      cap.streams
    );

    assert.equal(rc, 0);
    assert.match(cap.out(), /"relanced": \[\s*"claude:remote"\s*\]/);
    assert.equal(store.readInbox(TARGET).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDrumbeatWatch rejects remote or auto relaunchers without signer key material", async () => {
  const capRemote = captureStreams();
  assert.equal(await runCliDrumbeatWatch({ relauncher: "remote" }, capRemote.streams), 1);
  assert.match(capRemote.err(), /--instance and --private-key are required/);

  const capAuto = captureStreams();
  assert.equal(await runCliDrumbeatWatch({ relauncher: "auto", instance: SIGNER }, capAuto.streams), 1);
  assert.match(capAuto.err(), /--instance and --private-key are required/);
});

// End-to-end through the trust gate (review finding 2): a resume envelope POSTed
// the way `remoteServerForStore` wires it — `acceptRemoteEnvelope` verifies the
// signature against the registry, then delivers to the inbox, then the relay
// consumes it. Proves a signed resume relances and a forged/unsigned one is
// rejected at ingestion and never relances.
function acceptOptionsFor(store, signerPub) {
  return {
    resolvePublicKeys: (signer) => (signer === SIGNER ? [signerPub] : store.listInstanceKeys(signer)),
    deliver: (recipient, envelope) => store.putInboxMessage(recipient, envelope),
    guard: createReplayGuard(),
    // `resumeEnvelope` stamps `createdAt: new Date()`, so track real time to
    // stay inside the freshness window (the gate rejects stale envelopes).
    now: Date.now()
  };
}

test("e2e: a signed resume accepted through the gate relances the local entry", async () => {
  const root = freshRoot("h2a-d4-e2e-ok-");
  try {
    const store = createLocalStore({ root });
    const { privateKeyPem, publicKeyPem } = keypair();
    register(store, SIGNER, { publicKeys: [publicKeyPem] });
    recordStop(root, {
      instance: TARGET,
      workStatus: "paused",
      launchContext: { cwd: "/remote", command: "claude", resumeCommand: "claude --resume xyz" }
    });

    const signed = signEnvelope(resumeEnvelope("env-e2e-ok"), { by: SIGNER, privateKeyPem });
    const res = acceptRemoteEnvelope(signed, acceptOptionsFor(store, publicKeyPem));
    assert.equal(res.ok, true, "signed resume must pass the trust gate");
    assert.equal(store.readInbox(TARGET).length, 1, "verified resume is delivered to the inbox");

    const calls = [];
    const out = await relanceFromInbox(root, {
      instances: [TARGET],
      relauncher: { relance: (f) => (calls.push(f), true) },
      now: 1780189000000
    });
    assert.deepEqual(out.relanced, [TARGET]);
    assert.equal(calls[0].launchContext.resumeCommand, "claude --resume xyz");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relanceFromInbox drops a resume whose requestedBy != the verified signer (requester-mismatch)", async () => {
  const root = freshRoot("h2a-d4-reqmm-");
  try {
    const store = createLocalStore({ root });
    recordStop(root, { instance: TARGET, workStatus: "paused", launchContext: { cwd: "/remote", command: "claude" } });
    // actor.instance stays SIGNER (the verified signer); the body claims someone else requested it.
    store.putInboxMessage(TARGET, resumeEnvelope("env-reqmm", { requestedBy: "codex:impostor" }));
    const out = await relanceFromInbox(root, {
      instances: [TARGET],
      relauncher: { relance: () => true }
    });
    assert.deepEqual(out.relanced, []);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].reason, "requester-mismatch");
    assert.equal(store.readInbox(TARGET).length, 0, "the mismatched resume is popped, not left to poison future passes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("e2e: an unsigned or wrong-key resume is rejected at ingestion and never relances", async () => {
  const root = freshRoot("h2a-d4-e2e-bad-");
  try {
    const store = createLocalStore({ root });
    const { publicKeyPem } = keypair(); // SIGNER's registered key
    const stranger = keypair(); // not registered for SIGNER
    register(store, SIGNER, { publicKeys: [publicKeyPem] });
    recordStop(root, { instance: TARGET, workStatus: "paused", launchContext: { cwd: "/remote", command: "claude" } });

    // (a) unsigned: no signature on the envelope
    const unsigned = acceptRemoteEnvelope(resumeEnvelope("env-e2e-unsigned"), acceptOptionsFor(store, publicKeyPem));
    assert.equal(unsigned.ok, false, "unsigned resume must be refused");

    // (b) wrong key: signed by a key not registered for SIGNER
    const forged = signEnvelope(resumeEnvelope("env-e2e-forged"), { by: SIGNER, privateKeyPem: stranger.privateKeyPem });
    const wrongKey = acceptRemoteEnvelope(forged, acceptOptionsFor(store, publicKeyPem));
    assert.equal(wrongKey.ok, false, "resume signed by an unregistered key must be refused");

    assert.equal(store.readInbox(TARGET).length, 0, "no rejected resume reaches the inbox");
    const out = await relanceFromInbox(root, {
      instances: [TARGET],
      relauncher: { relance: () => true }
    });
    assert.deepEqual(out.relanced, [], "a rejected resume never relances");
    assert.equal(readDrumbeatEntry(root, TARGET).relanceCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
