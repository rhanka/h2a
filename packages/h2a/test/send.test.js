import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H2A_CLI_MCP_TOOL_DESCRIPTORS,
  createLocalStore,
  createMcpServer,
  identityKeyPaths,
  runCli,
  sendLocalMessage,
  verifyEnvelopeSignature,
  writePresence
} from "../dist/index.js";

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function registration(instance, publicKeyPem, overrides = {}) {
  return {
    id: instance,
    instance,
    roles: ["AGENTS"],
    scopes: ["scope:test"],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: "file:///test" }],
    publicKeys: [publicKeyPem],
    acceptedPolicies: [],
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-send-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, ".h2a");
  const store = createLocalStore({ root });
  const sender = "codex:sender:111111111111";
  const recipient = "claude:receiver:222222222222";
  const senderKeys = keys();
  const recipientKeys = keys();
  store.registerInstance(registration(sender, senderKeys.publicKeyPem, {
    name: "Sender",
    workspace: { id: "ws:sender", path: dir, host: "codex", label: "send" }
  }));
  store.registerInstance(registration(recipient, recipientKeys.publicKeyPem, {
    name: "Receiver",
    workspace: { id: "ws:receiver", path: join(dir, "peer"), host: "claude", label: "receive" }
  }));
  return { dir, root, store, sender, recipient, senderKeys, recipientKeys };
}

function live(root, instance, name = "Receiver") {
  const now = new Date().toISOString();
  writePresence(root, {
    sessionId: `session:${instance}`,
    instance,
    name,
    startedAt: now,
    heartbeatAt: now,
    state: "live",
    interests: { scopes: ["scope:test"], negotiations: [] },
    subscribedTopics: []
  });
}

function capture(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (chunk) => void (stdout += chunk) },
      stderr: { write: (chunk) => void (stderr += chunk) },
      cwd: () => cwd
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

test("sendLocalMessage resolves a live display name and deposits a sender-signed envelope", (t) => {
  const f = fixture(t);
  live(f.root, f.recipient);
  const result = sendLocalMessage({
    store: f.store,
    to: "receiver",
    message: "va check ton inbox",
    signer: { instance: f.sender, privateKeyPem: f.senderKeys.privateKeyPem },
    now: () => Date.parse("2026-09-15T12:00:00.000Z"),
    randomId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  });

  assert.equal(result.recipient, f.recipient);
  assert.equal(result.recipientLive, true);
  assert.equal(result.envelope.target.instance, f.recipient);
  assert.deepEqual(result.envelope.body, {
    kind: "message",
    topic: "MESSAGE",
    text: "va check ton inbox"
  });
  assert.equal(
    verifyEnvelopeSignature(result.envelope, f.senderKeys.publicKeyPem, { by: f.sender }),
    true
  );
  assert.deepEqual(f.store.readInbox(f.recipient), [result.envelope]);
});

test("sendLocalMessage resolves a dormant registered name without claiming live delivery", (t) => {
  const f = fixture(t);
  const result = sendLocalMessage({
    store: f.store,
    to: "Receiver",
    message: "later",
    signer: { instance: f.sender, privateKeyPem: f.senderKeys.privateKeyPem }
  });
  assert.equal(result.recipient, f.recipient);
  assert.equal(result.recipientLive, false);
  assert.equal(result.dormant, true);
  assert.equal(result.resolution, "registered-name");
});

test("sendLocalMessage refuses a mismatched or revoked sender key before writing", (t) => {
  const f = fixture(t);
  const wrong = keys();
  assert.throws(
    () => sendLocalMessage({
      store: f.store,
      to: f.recipient,
      message: "wrong key",
      signer: { instance: f.sender, privateKeyPem: wrong.privateKeyPem }
    }),
    /private key is not active/
  );
  assert.deepEqual(f.store.readInbox(f.recipient), []);

  f.store.revokeInstanceKey(f.sender, f.senderKeys.publicKeyPem);
  assert.throws(
    () => sendLocalMessage({
      store: f.store,
      to: f.recipient,
      message: "revoked key",
      signer: { instance: f.sender, privateKeyPem: f.senderKeys.privateKeyPem }
    }),
    /private key is not active/
  );
  assert.deepEqual(f.store.readInbox(f.recipient), []);
});

test("sendLocalMessage refuses ambiguous registered names and unknown exact instances", (t) => {
  const f = fixture(t);
  const thirdKeys = keys();
  f.store.registerInstance(registration("codex:other:333333333333", thirdKeys.publicKeyPem, {
    name: "Receiver"
  }));
  const signer = { instance: f.sender, privateKeyPem: f.senderKeys.privateKeyPem };
  assert.throws(
    () => sendLocalMessage({ store: f.store, to: "receiver", message: "ambiguous", signer }),
    /ambiguous/
  );
  assert.throws(
    () => sendLocalMessage({
      store: f.store,
      to: "claude:phantom:ffffffffffff",
      message: "phantom",
      signer
    }),
    /no live or registered agent/
  );
  assert.deepEqual(f.store.readInbox(f.recipient), []);
});

test("h2a send positional CLI uses the existing local key and writes a signed envelope", (t) => {
  const f = fixture(t);
  const keyPath = identityKeyPaths(f.root, f.sender).privateKeyPath;
  mkdirSync(join(f.root, "keys"), { recursive: true });
  writeFileSync(keyPath, f.senderKeys.privateKeyPem, { mode: 0o600 });
  const cap = capture(f.dir);
  const rc = runCli(
    ["send", f.recipient, "va check ton inbox", "--from", f.sender, "--root", f.root],
    cap.streams
  );
  assert.equal(rc, 0, cap.stderr());
  const result = JSON.parse(cap.stdout());
  assert.equal(result.recipient, f.recipient);
  const [envelope] = f.store.readInbox(f.recipient);
  assert.equal(
    verifyEnvelopeSignature(envelope, f.senderKeys.publicKeyPem, { by: f.sender }),
    true
  );
});

test("h2a_send MCP is strict and uses only its trusted sidecar signer", (t) => {
  const f = fixture(t);
  const descriptor = H2A_CLI_MCP_TOOL_DESCRIPTORS.find((tool) => tool.name === "h2a_send");
  assert.deepEqual(descriptor.inputSchema.required, ["to", "message"]);
  assert.equal(descriptor.inputSchema.additionalProperties, false);

  const unavailable = createMcpServer({ root: f.root, store: f.store });
  assert.match(unavailable.callTool("h2a_send", { to: f.recipient, message: "hello" }).error, /trusted auto-open/);

  const server = createMcpServer({
    root: f.root,
    store: f.store,
    sendContext: { instance: f.sender, privateKeyPem: f.senderKeys.privateKeyPem }
  });
  assert.match(
    server.callTool("h2a_send", { to: f.recipient, message: "hello", from: f.recipient }).error,
    /unsupported argument/
  );
  const result = server.callTool("h2a_send", { to: f.recipient, message: "hello" });
  assert.equal(result.ok, true);
  assert.equal(f.store.readInbox(f.recipient).length, 1);
});

