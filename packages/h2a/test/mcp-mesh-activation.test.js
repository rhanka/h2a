/** Composed L2/0.98 activation witnesses. Factory barriers position races;
 * real binary, keys, mesh store and HTTP transport exercise both directions.
 * No shutdown-drain fencing is asserted (deferred separately).
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { BoundedLocalMessagingStore } from "@sentropic/cluster-mesh";
import { createLocalStore, createClusterMeshMessaging, sendMessage } from "../dist/index.js";
import { callRpc, callTool, collectFrames, labRoot, parseToolJson, readIdentityStatus,
  spawnMcp, startLiveHolder, stopChildren, waitForIdentity } from "./helpers/mcp-fix-lab.js";

const context = (instance) => ({ principalId: instance, scopes: ["scope:default"],
  policyRevision: "test-v1", authenticationEvidenceRef: `local-key:${instance}` });
const wait = async (predicate, ms = 10000) => {
  const end = Date.now() + ms;
  while (!predicate() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.ok(predicate(), "observable barrier reached");
};
const presence = (root) => existsSync(join(root, "presence"))
  ? readdirSync(join(root, "presence")).filter((p) => p.endsWith(".json"))
    .map((p) => JSON.parse(readFileSync(join(root, "presence", p), "utf8"))) : [];

async function fixture(t, mode = "ok") {
  const root = labRoot();
  const calls = [], bound = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const transport = new BoundedLocalMessagingStore({
    options: { maxMessages: 100, maxBytes: 1024 * 1024, maxMessageBytes: 128 * 1024,
      maxSubscriptions: 10, defaultVisibilityTimeoutMs: 30000, maxVisibilityTimeoutMs: 60000,
      ackTombstoneTtlMs: 60000, maxAckTombstones: 100, maxDrainLeaseMs: 60000 },
    authorization: { async authorize() { return { ok: true, decisionRef: "test", policyRevision: "test-v1" }; } },
    routes: { async resolve() { return []; } }
  });
  const server = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body), method = req.url.slice(1);
      if (method === "bind") { bound.push(input.instance); await gate; res.end("{}"); return; }
      calls.push({ method, ackPresent: existsSync(join(root, "ready.json")) });
      assert.ok(["put", "pop", "ack"].includes(method));
      res.end(JSON.stringify(await transport[method](input)));
    } catch (e) { res.statusCode = 500; res.end(String(e)); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const module = join(root, "deployment.mjs");
  writeFileSync(module, `import { writeFileSync } from "node:fs";
  process.stdin.once("end", () => writeFileSync(${JSON.stringify(join(root, "eof"))}, "observed"));
  export async function createMessaging({instance}) {
    const call = async (method, input) => {
      const res = await fetch(${JSON.stringify(endpoint)} + "/" + method,
        { method: "POST", body: JSON.stringify(input) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    };
    await call("bind", {instance});
    writeFileSync(${JSON.stringify(join(root, "factory-settled"))}, "returned");
    ${mode === "reject" ? "throw new Error(\"factory rejected\");" : ""}
    return { context: (${context.toString()})(${mode === "principal" ? JSON.stringify("wrong:principal") : "instance"}),
      store: { put: (x) => call("put", x), pop: (x) => call("pop", x), ack: (x) => call("ack", x),
        subscribe: async () => ({ok:false, reason:"unavailable"}) } };
  }`);
  const ready = join(root, "ready.json"), nonce = "11111111-1111-4111-8111-111111111111";
  const handles = [];
  const launch = (extra = {}) => {
    const h = spawnMcp({ root, trace: true,
      args: ["--auto-open", "--host", "claude", "--backend", "cluster-mesh", "--wake", "logging", ...(extra.args ?? [])],
      env: { CLAUDE_CODE_SESSION_ID: "mesh-activation", H2A_CLUSTER_MESH_MODULE: module,
        H2A_MCP_READY_FILE: ready, H2A_MCP_READY_NONCE: nonce, ...extra.env } });
    handles.push(h); return h;
  };
  t.after(async () => {
    release(); await stopChildren(...handles);
    await new Promise((r) => { server.close(r); server.closeAllConnections(); });
    chmodSync(root, 0o700); rmSync(root, { recursive: true, force: true });
  });
  return { root, calls, bound, release, ready, nonce, launch, transport };
}

async function handshake(h) {
  assert.equal((await callRpc(h, { jsonrpc: "2.0", id: 1, method: "initialize" })).message.result.serverInfo.name, "@sentropic/h2a");
  assert.equal((await callRpc(h, { jsonrpc: "2.0", id: 2, method: "tools/list" })).message.result.tools.length, 55);
  assert.notEqual(parseToolJson(await callTool(h, "h2a_discover_instances", { limit: 5 }))?.code, "identity_pending");
}
async function pending(f, h) {
  await wait(() => f.bound.length > 0);
  assert.equal((await readIdentityStatus(h)).state, "identity_pending");
  assert.equal(parseToolJson(await callTool(h, "h2a_send", { to: "claude:peer", message: "pending" })).code, "identity_pending");
  assert.equal(existsSync(f.ready), false);
  assert.deepEqual(presence(f.root), []);
  assert.deepEqual(f.calls, []);
}

for (const reclaim of [false, true]) test(`mesh activation: ${reclaim ? "reclaim" : "mint"} final signer, delayed ACK and signed round trip`, { timeout: 45000 }, async (t) => {
  const f = await fixture(t);
  let previous;
  if (reclaim) {
    const first = spawnMcp({ root: f.root, args: ["--auto-open", "--host", "claude"], env: { CLAUDE_CODE_SESSION_ID: "mesh-activation" } });
    previous = await waitForIdentity(first, (s) => s.state !== "identity_pending");
    assert.equal(previous.state, "identity_ready");
    await stopChildren(first);
  }
  const holder = startLiveHolder({ root: f.root, lock: "registry" });
  await holder.ready;
  t.after(() => holder.stop());
  const h = f.launch();
  await handshake(h);
  assert.equal((await readIdentityStatus(h)).state, "identity_pending");
  assert.equal(f.bound.length, 0);
  await holder.stop();
  await wait(() => f.bound.length === 1);
  // Reclaim retains the old CLOSED session; there must be no new presence.
  assert.equal(existsSync(f.ready), false);
  assert.deepEqual(f.calls, []);
  assert.equal((await readIdentityStatus(h)).state, "identity_pending");
  f.release();
  const ready = await waitForIdentity(h, (s) => s.state !== "identity_pending");
  assert.equal(ready.state, "identity_ready", h.stderr);
  assert.equal(f.bound[0], ready.instance);
  if (previous) assert.equal(ready.instance, previous.instance);
  const ack = JSON.parse(readFileSync(f.ready, "utf8"));
  assert.equal(ack.nonce, f.nonce); assert.equal(ack.sessionId, ready.sessionId);
  assert.equal(statSync(f.ready).mode & 0o777, 0o600);
  const phases = collectFrames(h).map((x) => x.phase);
  assert.ok(phases.indexOf("messaging_bound") < phases.indexOf("readiness_ack"));
  const local = createLocalStore({ root: f.root });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const peer = { instance: "codex:peer:111111111111", privateKeyPem: privateKey.export({format:"pem", type:"pkcs8"}).toString() };
  local.registerInstance({ id: peer.instance, instance: peer.instance, roles:["AGENTS"], scopes:["scope:default"], capabilities:[],
    endpoints:[{kind:"local-files", uri:"file:///test"}], publicKeys:[publicKey.export({format:"pem",type:"spki"}).toString()], acceptedPolicies:[], createdAt:new Date().toISOString() });
  const mesh = await createClusterMeshMessaging(local, peer, { store:f.transport, context:context(peer.instance) });
  const sent = parseToolJson(await callTool(h, "h2a_send", { to:peer.instance, message:"outbound" }));
  assert.equal(sent.backend, "cluster-mesh"); assert.ok(sent.messageId);
  assert.deepEqual((await mesh.drain()).accepted, [sent.messageId]);
  await sendMessage({store:local, signer:peer, to:ready.instance, message:"inbound", backend:"cluster-mesh", clusterMesh:mesh});
  await wait(() => local.readInbox(ready.instance).some((e) => e.body.text === "inbound"));
  await wait(() => h.stderr.includes("inbox-wake: 1 new envelope(s)"));
  assert.ok(f.calls.some((c) => c.method === "ack"));
  assert.ok(f.calls.every((c) => c.ackPresent), "no transport activity before readiness ACK");
});

for (const mode of ["reject", "principal", "ack", "timeout", "close"]) test(`mesh activation: ${mode} prevents receive and readiness`, { timeout: 40000 }, async (t) => {
  const f = await fixture(t, mode);
  const h = f.launch(mode === "ack" ? { env: { H2A_MCP_READY_FILE: join(f.root, "missing", "ready.json") } } : {});
  await handshake(h); await pending(f, h);
  if (mode === "timeout") {
    const failed = await waitForIdentity(h, (s) => s.state === "identity_failed", { timeoutMs: 26000 });
    assert.equal(failed.cause, "identity_timeout");
  }
  if (mode === "close") {
    h.child.stdin.end();
    // Let EOF cancellation run before releasing the outstanding factory.
    await wait(() => existsSync(join(f.root, "eof")));
  }
  f.release();
  await wait(() => existsSync(join(f.root, "factory-settled")));
  if (mode === "close") { await wait(() => h._closed); assert.equal(h._exit.code, 0); }
  else {
    const failed = await waitForIdentity(h, (s) => s.state === "identity_failed");
    assert.equal(failed.cause, mode === "ack" ? "readiness_ack_failed" : mode === "timeout" ? "identity_timeout" : "messaging_backend_failed");
    // An RPC after release exercises the live transport after the losing continuation.
    await handshake(h);
  }
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(existsSync(f.ready), false);
  assert.deepEqual(f.calls, [], "no pop/ack/send after failed activation");
  if (mode !== "ack") assert.deepEqual(presence(f.root), []);
  else assert.ok(presence(f.root).every((p) => p.status === "closed"));
});

for (const backend of ["local", "cluster-mesh"]) test(`mesh activation: presence-only override with ${backend}`, async (t) => {
  const f = await fixture(t); f.release();
  const h = f.launch({ args: ["--instance", "claude:override", "--backend", backend] });
  await handshake(h);
  const state = await waitForIdentity(h, (s) => s.state !== "identity_pending");
  if (backend === "cluster-mesh") { assert.equal(state.cause, "messaging_backend_failed"); assert.equal(existsSync(f.ready), false); }
  else { assert.equal(state.state, "identity_ready"); assert.equal(state.signingAvailable, false); assert.equal(collectFrames(h).some((x) => x.phase.startsWith("messaging_")), false); }
  assert.equal(f.bound.length, 0);
});

for (const invalid of ["no-auto-open", "missing-module", "relative-module"]) test(`mesh activation: pure boot error ${invalid}`, async (t) => {
  const f = await fixture(t);
  const h = spawnMcp({ root: f.root,
    args: ["--backend", "cluster-mesh", ...(invalid === "no-auto-open" ? [] : ["--auto-open", "--host", "claude"])],
    env: { H2A_CLUSTER_MESH_MODULE: invalid === "relative-module" ? "relative.mjs" : "" } });
  t.after(() => stopChildren(h));
  await wait(() => h._closed);
  assert.equal(h._exit.code, 1);
  assert.match(h.stderr, invalid === "no-auto-open" ? /requires --auto-open/ : /absolute H2A_CLUSTER_MESH_MODULE/);
  assert.equal(f.bound.length, 0);
  assert.deepEqual(presence(f.root), []);
});

test("mesh activation: read-only root retains handshake without boot writes", async (t) => {
  const f = await fixture(t);
  // This fixture has only root plus registry/identity/keys directories.
  const dirs = [f.root, ...["registry", "identity", "keys"].map((p) => join(f.root, p))];
  const before = readdirSync(f.root).sort();
  dirs.forEach((p) => chmodSync(p, 0o500));
  t.after(() => dirs.forEach((p) => { if (existsSync(p)) chmodSync(p, 0o700); }));
  const h = f.launch();
  await handshake(h);
  const failed = await waitForIdentity(h, (s) => s.state === "identity_failed");
  assert.equal(failed.cause, "storage_permission_denied");
  assert.deepEqual(readdirSync(f.root).sort(), before);
  assert.equal(f.bound.length, 0);
  dirs.forEach((p) => chmodSync(p, 0o700));
});
