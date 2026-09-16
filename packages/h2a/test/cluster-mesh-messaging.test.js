import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";
import { BoundedLocalMessagingStore } from "@sentropic/cluster-mesh";
import {
  createLocalStore, createClusterMeshMessaging, createMcpServer,
  createInboxWakeHandler, createEnvelope, signEnvelope, identityKeyPaths, sendMessage, runMcpStdio
} from "../dist/index.js";

const context = (instance) => ({
  principalId: instance, scopes: ["scope:test"], policyRevision: "test-v1",
  authenticationEvidenceRef: `local-key:${instance}`
});

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-mesh-message-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, ".h2a");
  const local = createLocalStore({ root });
  const identities = ["codex:sender:111111111111", "claude:receiver:222222222222"].map((instance) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    local.registerInstance({
      id: instance, instance, roles: ["AGENTS"], scopes: ["scope:test"], capabilities: [],
      endpoints: [{ kind: "local-files", uri: "file:///test" }], publicKeys: [publicKeyPem],
      acceptedPolicies: [], createdAt: new Date().toISOString()
    });
    mkdirSync(join(root, "keys"), { recursive: true });
    writeFileSync(identityKeyPaths(root, instance).privateKeyPath, privateKeyPem, { mode: 0o600 });
    return { instance, publicKeyPem, privateKeyPem };
  });
  const [sender, receiver] = identities;
  const transport = new BoundedLocalMessagingStore({
    options: {
      maxMessages: 100, maxBytes: 1024 * 1024, maxMessageBytes: 128 * 1024,
      maxSubscriptions: 10, defaultVisibilityTimeoutMs: 30000,
      maxVisibilityTimeoutMs: 60000, ackTombstoneTtlMs: 60000, maxAckTombstones: 100,
      maxDrainLeaseMs: 60000
    },
    authorization: { async authorize({ context: ctx, action, resource }) {
      const known = identities.some((id) => id.instance === ctx.principalId);
      const ownInbox = action === "message:put" || action === "message:route" || resource.mailboxId === ctx.principalId;
      return known && ownInbox
        ? { ok: true, decisionRef: "test-key", policyRevision: "test-v1" }
        : { ok: false, reason: "forbidden" };
    } },
    routes: { async resolve() { return []; } }
  });
  let mutate;
  const acks = [];
  const wire = {
    put: (input) => {
      const copy = structuredClone(input);
      mutate?.(copy);
      return transport.put(copy);
    },
    pop: (input) => transport.pop(input),
    subscribe: (input) => transport.subscribe(input),
    ack: (input) => { acks.push(input); return transport.ack(input); }
  };
  const connect = (identity) => createClusterMeshMessaging(local, identity, { store: wire, context: context(identity.instance) });
  const sendMesh = await connect(sender);
  const receiveMesh = await connect(receiver);
  const send = (message, extra = {}) => sendMessage({
    store: local, signer: sender, to: receiver.instance, message,
    backend: "cluster-mesh", clusterMesh: sendMesh, ...extra
  });
  const drives = [];
  const wake = createInboxWakeHandler({
    instance: receiver.instance, privateKeyPem: receiver.privateKeyPem,
    readInbox: () => local.readInbox(receiver.instance),
    driver: { async drive(request) { drives.push(request); return true; } }
  });
  return { dir, root, local, sender, receiver, transport, wire, sendMesh, receiveMesh,
    connect, send, acks, wake, drives, tamper: (fn) => { mutate = fn; } };
}

test("should round-trip through the real cluster-mesh store before inbox delivery and wake", async (t) => {
  const f = await fixture(t);
  const sent = await f.send("mesh round-trip");
  assert.equal(sent.backend, "cluster-mesh");
  assert.ok(sent.messageId);
  assert.deepEqual(f.local.readInbox(f.receiver.instance), [], "sender must not write local recipient inbox");
  assert.equal(await f.wake(), false);
  assert.deepEqual(await f.receiveMesh.drain(), { accepted: [sent.messageId], rejected: [] });
  assert.deepEqual(f.local.readInbox(f.receiver.instance), [sent.envelope]);
  assert.equal(await f.wake(), true);
  assert.equal(f.drives.length, 1);
  assert.equal(f.acks.length, 1);
  assert.deepEqual(await f.receiveMesh.drain(), { accepted: [], rejected: [] });
});

for (const [name, change] of [
  ["body text", (outer) => { outer.message.body.text = "TAMPERED"; }],
  // Inner H2A signature remains VALID. Only N2 can reject this alteration.
  ["outer kind", (outer) => { outer.kind = "wake"; }],
  ["signature", (outer) => { outer.evidence.signatureBase64Url = "AAAA"; }],
  ["issuer", (outer) => { outer.issuer.issuerId = "codex:attacker:333333333333"; }],
  ["key identity", (outer) => { outer.issuer.keyId = "wrong-key"; }],
  ["malformed evidence", (outer) => { outer.evidence = null; }]
]) {
  test(`should reject altered ${name} before processing or wake and continue the drain`, async (t) => {
    const f = await fixture(t);
    f.tamper((input) => change(input.payload.value));
    const poisoned = await f.send("must never arrive");
    f.tamper(undefined);
    const valid = await f.send("safe after poison");
    const drained = await f.receiveMesh.drain();
    assert.deepEqual(drained.accepted, [valid.messageId]);
    if (name !== "malformed evidence") assert.deepEqual(drained.rejected, [poisoned.messageId]);
    assert.deepEqual(f.local.readInbox(f.receiver.instance).map((e) => e.body.text), ["safe after poison"]);
    assert.equal(f.acks.length, 1, "unverified envelope must not be acknowledged as processed");
    assert.equal(await f.wake(), true);
    assert.equal(f.drives.length, 1);
  });
}

test("should never wake on an altered envelope even with a valid inner signature", async (t) => {
  const f = await fixture(t);
  f.tamper((input) => { input.payload.value.kind = "wake"; });
  const sent = await f.send("signed but outer-tampered");
  assert.deepEqual(await f.receiveMesh.drain(), { accepted: [], rejected: [sent.messageId] });
  assert.deepEqual(f.local.readInbox(f.receiver.instance), []);
  assert.equal(await f.wake(), false);
  assert.deepEqual(f.drives, []);
  assert.deepEqual(f.acks, []);
});

test("should reject revoked sender keys at receive time and fail further sends", async (t) => {
  const f = await fixture(t);
  const sent = await f.send("in flight before revocation");
  f.local.revokeInstanceKey(f.sender.instance, f.sender.publicKeyPem);
  assert.deepEqual(await f.receiveMesh.drain(), { accepted: [], rejected: [sent.messageId] });
  assert.equal(await f.wake(), false);
  assert.throws(() => f.send("revoked"), /private key is not active/);
});

test("should refuse a mismatched authenticated principal and propagate transport rejection", async (t) => {
  const f = await fixture(t);
  await assert.rejects(createClusterMeshMessaging(f.local, f.sender, {
    store: f.wire, context: context(f.receiver.instance)
  }), /authenticated principal/);
  const unavailable = await createClusterMeshMessaging(f.local, f.sender, {
    store: { ...f.wire, put: async () => ({ ok: false, reason: "unavailable" }) }, context: context(f.sender.instance)
  });
  await assert.rejects(f.send("failure", { clusterMesh: unavailable }), /rejected message: unavailable/);
  assert.deepEqual(f.local.readInbox(f.receiver.instance), []);
});

test("should use the existing MCP send tool with an explicit mesh backend and retain the local default", async (t) => {
  const f = await fixture(t);
  const server = createMcpServer({ root: f.root, store: f.local, sendContext: f.sender, clusterMesh: f.sendMesh });
  const sent = await server.callTool("h2a_send", { to: f.receiver.instance, message: "MCP mesh", backend: "cluster-mesh" });
  assert.equal(sent.backend, "cluster-mesh");
  assert.deepEqual(f.local.readInbox(f.receiver.instance), []);
  assert.deepEqual((await f.receiveMesh.drain()).accepted, [sent.messageId]);
  const local = server.callTool("h2a_send", { to: f.receiver.instance, message: "MCP local" });
  assert.equal(local.ok, true, "default stays synchronous/local");
  assert.equal(f.local.readInbox(f.receiver.instance).length, 2);
  assert.match(server.callTool("h2a_send", { to: f.receiver.instance, message: "x", backend: "bogus" }).error, /backend must be/);
});

async function child(args, env) {
  const process = spawn(globalThis.process.execPath, [resolve("packages/h2a/dist/bin.js"), ...args], { env });
  let out = "", err = "";
  process.stdout.on("data", (chunk) => { out += chunk; });
  process.stderr.on("data", (chunk) => { err += chunk; });
  return new Promise((resolve, reject) => {
    process.on("error", reject);
    process.on("close", (code) => resolve({ code, out, err }));
  });
}

test("should send from the compiled CLI through a configured transport across a process boundary", async (t) => {
  const f = await fixture(t);
  const server = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const method = req.url.slice(1);
      assert.ok(["put", "pop", "ack"].includes(method));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(await f.wire[method](JSON.parse(body))));
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const modulePath = join(f.dir, "deployment.mjs");
  writeFileSync(modulePath, `export function createMessaging({instance}) {
    const call = async (method, input) => {
      const res = await fetch(${JSON.stringify(endpoint)} + '/' + method, {
        method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(input)
      });
      if (!res.ok) throw new Error('transport HTTP ' + res.status);
      return res.json();
    };
    return { context: (${context.toString()})(instance), store: {
      put: (input) => call('put', input), pop: (input) => call('pop', input),
      ack: (input) => call('ack', input), subscribe: async () => ({ok:false, reason:'unavailable'})
    }};
  }`);
  const args = ["send", f.receiver.instance, "real CLI mesh", "--from", f.sender.instance,
    "--root", f.root, "--backend", "cluster-mesh"];
  const result = await child(args, { ...process.env, H2A_CLUSTER_MESH_MODULE: modulePath });
  assert.equal(result.code, 0, result.err);
  const sent = JSON.parse(result.out);
  assert.equal(sent.backend, "cluster-mesh");
  assert.deepEqual(f.local.readInbox(f.receiver.instance), []);
  assert.deepEqual((await f.receiveMesh.drain()).accepted, [sent.messageId]);
  assert.equal(f.local.readInbox(f.receiver.instance)[0].body.text, "real CLI mesh");
  const missing = await child(args, { ...process.env, H2A_CLUSTER_MESH_MODULE: "" });
  assert.notEqual(missing.code, 0);
  assert.match(missing.err, /H2A_CLUSTER_MESH_MODULE/);
});

test("should await asynchronous MCP sends before replying and closing stdio", async (t) => {
  const f = await fixture(t);
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk; });
  const serving = runMcpStdio({ root: f.root, stdin, stdout, stderr, sendContext: f.sender,
    clusterMesh: f.sendMesh, messageBackend: "cluster-mesh" });
  stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
    name: "h2a_send", arguments: { to: f.receiver.instance, message: "stdio mesh" }
  } }) + "\n");
  await serving;
  const response = JSON.parse(output.trim());
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.backend, "cluster-mesh");
  assert.ok(result.messageId);
  assert.deepEqual((await f.receiveMesh.drain()).accepted, [result.messageId]);
});

test("should drain the real mesh in the running MCP sidecar before notifying and waking", async (t) => {
  const f = await fixture(t);
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
  let errors = "";
  stderr.on("data", (chunk) => { errors += chunk; });
  const notifications = [];
  stdout.on("data", (chunk) => {
    for (const line of chunk.toString().trim().split("\n")) if (line) notifications.push(JSON.parse(line));
  });
  const drives = [];
  const controller = new AbortController();
  const serving = runMcpStdio({ root: f.root, stdin, stdout, stderr,
    autoOpen: { instance: f.receiver.instance, host: "claude" },
    sendContext: f.receiver, clusterMesh: f.receiveMesh, messageBackend: "cluster-mesh",
    notifyIntervalMs: 10, heartbeatIntervalMs: 10000, signal: controller.signal,
    wake: { privateKeyPem: f.receiver.privateKeyPem, driver: {
      async drive(request) { drives.push(request); return true; }
    } }
  });
  t.after(async () => { controller.abort(); stdin.end(); await serving; });
  // Wait on an observable reject diagnostic, not a delay that can pass before N2 runs.
  f.tamper((input) => { input.payload.value.kind = "wake"; });
  await f.send("poison in sidecar");
  await waitFor(() => errors.includes("rejected 1 unverified"));
  assert.deepEqual(f.local.readInbox(f.receiver.instance), []);
  assert.deepEqual(drives, []);
  assert.equal(notifications.some((n) => JSON.stringify(n).includes("inbox.envelope_arrived")), false);
  f.tamper(undefined);
  await f.send("valid in sidecar");
  await waitFor(() => drives.length > 0);
  assert.equal(drives.length, 1);
  assert.deepEqual(f.local.readInbox(f.receiver.instance).map((e) => e.body.text), ["valid in sidecar"]);
  assert.equal(notifications.some((n) => JSON.stringify(n).includes("inbox.envelope_arrived")), true);
});

async function waitFor(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "expected observable sidecar activity within 1.5 seconds");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}


test("should reject a signed but malformed inner envelope without stopping later deliveries", async (t) => {
  const f = await fixture(t);
  const envelope = createEnvelope({
    id: "invalid-inner", type: "event", actor: { instance: f.sender.instance, role: "AGENTS", scope: "scope:test" },
    target: { instance: f.receiver.instance }, body: { kind: "message", topic: "MESSAGE", text: "invalid" }
  });
  const signed = signEnvelope({ ...envelope, protocol: "invalid" }, {
    by: f.sender.instance, privateKeyPem: f.sender.privateKeyPem
  });
  const poison = await f.sendMesh.send(signed);
  assert.equal(poison.ok, true);
  const valid = await f.send("after invalid inner");
  assert.deepEqual(await f.receiveMesh.drain(), { accepted: [valid.messageId], rejected: [poison.messageId] });
  assert.deepEqual(f.local.readInbox(f.receiver.instance).map((e) => e.body.text), ["after invalid inner"]);
});
