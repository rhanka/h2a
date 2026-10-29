import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { PassThrough } from "node:stream";
import { bridgeCentralMcpStdio } from "../dist/runtime/mcp-central-client.js";
import { captureCentralAttachment } from "../dist/runtime/mcp-central-context.js";
import { bridgeLockDigest } from "../dist/registry/bridge-lock.js";
import { registryPackageManifest } from "../dist/registry/manifest.js";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { canonicalJson, sha256Hex, validateRegistryEntry, normalizeConfiguration } from "../dist/registry/descriptors.js";
import { readBridgeLock, provisionBridgeLock } from "../dist/registry/bridge-lock.js";
import { composeDaemonRegistry } from "../dist/registry/sentropic-daemon.js";
import { cmdRegistryBridge } from "../dist/registry/cli-registry.js";
import { openCentralAttachment } from "../dist/runtime/mcp-central-attachment.js";
import * as central from "../dist/runtime/mcp-central.js";
import { createLocalStore } from "../dist/runtime/local-files/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MEMORY_ID, MEMORY_NAMES, entry, configuration, fixture } from "./helpers/engram-memory-contract.js";

function lockFor(memory = true) {
  const entries = [...registryPackageManifest.entries, ...trackRegistryPackageManifest.entries, ...(memory ? [entry] : [])];
  const configs = [{ mode: "shared-central", serviceBindingRef: "h2a-local-central" }, { access: "read-only", repositoryBindingRef: "h2a-attachment-workspace" }, { ...configuration }];
  return { format: "h2a.registry-bridge-lock/v1", lockVersion: 1, revision: 1, host: "claude", profile: "default",
    bridge: { command: "h2a", args: [] },
    selection: entries.map(e => ({ kind: "mcp", id: e.id, entryVersion: e.entryVersion })),
    entries: Object.fromEntries(entries.map((e, i) => [e.id, { digest: validateRegistryEntry(e).digest, config: configs[i], configDigest: sha256Hex(canonicalJson(configs[i])) }])),
    compatibility: { hostFeatures: ["stdio", "streamable-http", ...entry.compatibility.requiredHostFeatures], protocolVersions: ["2025-06-18"] } };
}
async function scratch(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-memory-l2-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("L2: memory parameters are closed and require an explicit binding reference", () => {
  for (const config of [{}, { ...configuration, mode: "stdio" }, { ...configuration, hostBindingRef: "" }, { ...configuration, hostBindingRef: "a\n" }, { ...configuration, hostBindingRef: "../escape" }, { ...configuration, hostBindingRef: "a".repeat(129) }, { ...configuration, tenant_id: "forged" }]) {
    assert.throws(() => normalizeConfiguration(entry, config), /invalid_parameters/);
  }
  assert.deepEqual(normalizeConfiguration(entry, configuration), configuration);
});
test("L2: lock pins memory entry, version and normalized configuration before activation", async () => scratch(async dir => {
  const path = join(dir, "lock.json");
  writeFileSync(path, JSON.stringify(lockFor()));
  assert.equal(readBridgeLock(path, entry).selection.at(-1).id, MEMORY_ID);
  for (const breakEntry of [e => { e.kind = "skill"; }, e => { e.mcp.connectorIds = ["other"]; }, e => { e.mcp.transportProfiles[0].mode = "stdio"; }]) {
    const wrong = structuredClone(entry); breakEntry(wrong);
    assert.throws(() => readBridgeLock(path, wrong), /invalid_entry/);
  }
  for (const change of [
    l => { l.entries[MEMORY_ID].digest = "f".repeat(64); },
    l => { l.entries[MEMORY_ID].configDigest = "f".repeat(64); },
    l => { l.entries[MEMORY_ID].config.hostBindingRef = "different"; },
    l => { l.selection.at(-1).entryVersion = "99.0.0"; }
  ]) {
    const lock = lockFor(); change(lock); writeFileSync(path, JSON.stringify(lock));
    assert.throws(() => readBridgeLock(path, entry), /integrity_mismatch|incompatible_version/);
    const f = fixture();
    await assert.rejects(composeDaemonRegistry({ view: "combined", root: dir, lock, memory: f.memory }), /integrity_mismatch|incompatible_version/);
    assert.equal(f.loads(), 0);
  }
}));
test("L2: selected memory discovers and calls all six tools through the Sentropic plan", async () => scratch(async root => {
  const f = fixture();
  const plan = await composeDaemonRegistry({ view: "combined", root, lock: lockFor(), memory: f.memory });
  assert.equal(plan.catalog().length, 3);
  assert.deepEqual(plan.toolNames().filter(n => n.startsWith("engram_memory_")).sort(), [...MEMORY_NAMES].sort());
  for (const name of MEMORY_NAMES) {
    const result = await plan.dispatch(name, { idempotency_key: "operation-" + name });
    assert.equal(result.providerId, MEMORY_ID);
    assert.equal(result.output.transport.structuredContent.auditId, "host-issued-audit");
  }
  assert.equal(f.calls.length, 6);
  for (const call of f.calls) {
    assert.equal(call.ctx, f.context);
    assert.deepEqual(call.envelope, { idempotencyKey: "operation-" + call.name, elicitationRef: "host-confirmation" });
  }
  await assert.rejects(plan.dispatch("engram_memory_unknown", {}), /unknown_tool/);
  assert.equal(f.calls.length, 6);
}));
test("L2: unselected memory never loads or handles calls; h2a and Track remain available", async () => scratch(async root => {
  const f = fixture();
  const plan = await composeDaemonRegistry({ view: "combined", root, lock: lockFor(false), memory: f.memory });
  assert.equal(plan.toolNames().length, 60);
  assert.equal(f.loads(), 0);
  for (const name of MEMORY_NAMES) await assert.rejects(plan.dispatch(name, {}), /unknown_tool/);
  assert.equal(f.calls.length, 0);
  assert.equal((await plan.dispatch("h2a_identity_status", {})).ok, true);
  assert.equal((await plan.dispatch("track_query", { baselineCommit: "abc1234" })).ok, true);
}));
test("L2: absent bindings or package refuse before memory is advertised", async () => scratch(async root => {
  const f = fixture(), lock = lockFor();
  await assert.rejects(composeDaemonRegistry({ view: "combined", root, lock, memory: { ...f.memory, host: undefined } }), /missing_binding.*not configured/);
  assert.equal(f.loads(), 0);
  await assert.rejects(composeDaemonRegistry({ view: "combined", root, lock, memory: { ...f.memory, load: undefined } }), /missing_binding.*@sentropic[/]engram/);
  assert.equal(f.calls.length, 0);
}));
test("L2: trusted context resolution refuses without leaking details or invoking the provider", async () => scratch(async root => {
  const f = fixture(); f.refuseContext();
  const plan = await composeDaemonRegistry({ view: "combined", root, lock: lockFor(), memory: f.memory });
  await assert.rejects(plan.dispatch(MEMORY_NAMES[0], { tenant_id: "forged" }), error => {
    assert.match(error.message, /Trusted invocation context unavailable/);
    assert.doesNotMatch(error.message, /private tenant/); return true;
  });
  assert.equal(f.calls.length, 0);
}));
test("L2: bridge selects the third provider, forwards the verified selection, and never requests a gateway", async () => scratch(async root => {
  const lock = lockFor(), f = fixture(), path = join(root, "lock.json");
  writeFileSync(path, JSON.stringify(lock));
  let output = "", delegated = 0;
  const result = await cmdRegistryBridge(["serve", "--host", "claude", "--instance", "claude:test", "--lock", path],
    { stdout: { write: x => { output += x; } }, stderr: { write: x => { output += x; } }, cwd: () => root },
    { memory: f.memory, delegateServe: async (flags, registry) => {
      delegated++;
      assert.equal(flags.gw, undefined); assert.equal(flags.gateway, undefined);
      assert.deepEqual(registry.lock.selection, lock.selection);
      assert.equal(registry.tools.filter(t => t.name.startsWith("engram_memory_")).length, 6);
      return 0;
    } });
  assert.equal(result, 0, output); assert.equal(delegated, 1);
}));
test("L2: actual attachment MCP protocol discovers metadata and dispatches selected memory under its fence", async () => scratch(async root => {
  const f = fixture(), lock = lockFor(), store = createLocalStore({ root });
  const handle = openCentralAttachment(root, root, store, undefined, async () => {}, undefined, undefined, { lock, memory: f.memory });
  let fenceCalls = 0;
  const protocol = central.createCentralProtocolServer(handle.mcp, { call: async fn => { fenceCalls++; return fn(); } });
  const client = new Client({ name: "l2-contract-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await handle.ready;
    await Promise.all([protocol.connect(a), client.connect(b)]);
    const listed = (await client.listTools()).tools.filter(t => t.name.startsWith("engram_memory_"));
    assert.deepEqual(listed, f.descriptors);
    for (const name of MEMORY_NAMES) assert.equal((await client.callTool({ name, arguments: {} })).isError, false);
    const denied = await client.callTool({ name: "engram_memory_unknown", arguments: {} });
    assert.equal(denied.isError, true);
    assert.equal(f.calls.length, 6); assert.equal(fenceCalls, 7);
    assert.ok(handle.mcp.callTool("h2a_identity_status", {}).content, "identity remains synchronous");
    assert.ok((await client.callTool({ name: "track_query", arguments: { baselineCommit: "abc1234" } })).content.length);
  } finally { await client.close(); await protocol.close(); await handle.close(); }
}));

test("L2: selected stdio shim reaches the real central memory dispatch with the same pinned lock", { timeout: 10000 }, async () => scratch(async root => {
  const f = fixture(), lock = lockFor(), registry = { lock, memory: f.memory };
  const runtimeBase = join(root, "runtime"), physicalPrefix = join(root, "prefix");
  mkdirSync(runtimeBase, { mode: 0o700 }); mkdirSync(physicalPrefix, { mode: 0o700 });
  const server = await central.startCentralMcpServer({ root, runtimeBase, physicalPrefix, env: {}, registry });
  assert.equal(server.kind, "started");
  const input = new PassThrough(), output = new PassThrough(), controller = new AbortController();
  const received = new Map(), pending = new Map();
  let buffer = "";
  output.on("data", data => {
    buffer += data.toString();
    for (;;) {
      const newline = buffer.indexOf("\n"); if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const frame = JSON.parse(line); received.set(frame.id, frame); pending.get(frame.id)?.(frame);
    }
  });
  const request = (id, method, params) => new Promise(resolve => {
    if (received.has(id)) return resolve(received.get(id));
    pending.set(id, resolve); input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const attachment = captureCentralAttachment(root, root, { host: "codex", "registry-lock-digest": bridgeLockDigest(lock) }, {});
  const tools = (await composeDaemonRegistry({ view: "combined", root, ...registry })).tools();
  const serving = bridgeCentralMcpStdio({ runtimeBase, stdin: input, stdout: output, signal: controller.signal, workspaceRoot: root, attachment, registryTools: tools });
  try {
    assert.ok((await request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "l2-shim-fixture", version: "1" } })).result);
    const discovery = await request(2, "tools/list", {});
    assert.equal(discovery.result.tools.filter(t => t.name.startsWith("engram_memory_")).length, 6);
    const result = await request(3, "tools/call", { name: MEMORY_NAMES[0], arguments: {} });
    assert.equal(result.result?.isError, false, JSON.stringify(result));
    assert.equal(f.calls.length, 1);
    assert.equal(f.attachmentContexts.at(-1).context.id, attachment.id);
    assert.ok(f.attachmentContexts.at(-1).participant, "real attachment participant reaches the trusted host port");
  } finally {
    controller.abort(); input.end(); await serving; output.destroy(); await server.stop();
  }
}));

test("L2: a packed ESM-only Engram descriptor resolves and verifies its own asset closure", async () => scratch(async root => {
  const consumer = join(root, "consumer"), directory = join(consumer, "node_modules/@sentropic/engram");
  mkdirSync(join(consumer, "dist/registry"), { recursive: true });
  mkdirSync(join(directory, "dist/registry"), { recursive: true });
  mkdirSync(join(directory, "registry"));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module" }));
  for (const name of ["memory-provider", "descriptors"]) copyFileSync(new URL("../dist/registry/" + name + ".js", import.meta.url), join(consumer, "dist/registry", name + ".js"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@sentropic/engram", type: "module", exports: { "./registry/manifest": { import: "./dist/registry/manifest.js" } } }));
  writeFileSync(join(directory, "dist/registry/manifest.js"), "throw new Error('descriptor import must not activate a provider');");
  const descriptor = structuredClone(entry), bytes = JSON.stringify({ tools: [], resources: [], prompts: [] });
  descriptor.assets[0].sha256 = sha256Hex(bytes);
  writeFileSync(join(directory, descriptor.assets[0].path), bytes);
  writeFileSync(join(directory, "registry/entries.v1.json"), JSON.stringify({ format: "sentropic.registry-package/v1", entries: [descriptor] }));
  const module = await import(pathToFileURL(join(consumer, "dist/registry/memory-provider.js")).href);
  assert.deepEqual(module.readInstalledMemoryEntry(), descriptor);
  writeFileSync(join(directory, descriptor.assets[0].path), "{}");
  assert.throws(() => module.readInstalledMemoryEntry(), /integrity_mismatch/);
}));
test("L2: lock provisioning pins an explicitly selected memory tuple without changing the default tuple", async () => scratch(async root => {
  const path = join(root, "lock.json");
  provisionBridgeLock({ lockPath: path, host: "claude", profile: "default", bridge: { command: "h2a", args: [] },
    h2aEntry: registryPackageManifest.entries[0], trackEntry: trackRegistryPackageManifest.entries[0],
    memory: { entry, config: configuration } });
  const lock = readBridgeLock(path, entry);
  assert.equal(lock.selection.length, 3);
  assert.equal(lock.entries[MEMORY_ID].configDigest, sha256Hex(canonicalJson(configuration)));
}));

async function refusedMemoryBridge(root, configured) {
  const f = fixture(), lock = lockFor();
  const runtimeBase = join(root, "runtime"), physicalPrefix = join(root, "prefix");
  mkdirSync(runtimeBase, { mode: 0o700 }); mkdirSync(physicalPrefix, { mode: 0o700 });
  const server = await central.startCentralMcpServer({ root, runtimeBase, physicalPrefix, env: {}, ...(configured ? { registry: { lock, memory: f.memory } } : {}) });
  const input = new PassThrough(), output = new PassThrough(), controller = new AbortController();
  const frames = new Map();
  let buffer = "", resolveFrames;
  const completed = new Promise(resolve => { resolveFrames = resolve; });
  output.on("data", data => {
    buffer += data.toString();
    for (;;) {
      const newline = buffer.indexOf("\n"); if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (!line) continue;
      const frame = JSON.parse(line); frames.set(frame.id, frame);
      if (frames.has(1) && frames.has(2)) resolveFrames();
    }
  });
  const tools = (await composeDaemonRegistry({ view: "combined", root, lock, memory: f.memory })).tools();
  const attachment = captureCentralAttachment(root, root, { host: "codex", "registry-lock-digest": configured ? "f".repeat(64) : bridgeLockDigest(lock) }, {});
  const serving = bridgeCentralMcpStdio({ runtimeBase, stdin: input, stdout: output, signal: controller.signal, workspaceRoot: root, attachment, registryTools: tools });
  try {
    for (const frame of [
      { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "l2-unconfigured", version: "1" } } },
      { id: 2, method: "tools/list", params: {} }
    ]) input.write(JSON.stringify({ jsonrpc: "2.0", ...frame }) + "\n");
    await completed;
    assert.ok(frames.get(1).error, "unconfigured central must refuse memory initialize");
    assert.ok(frames.get(2).error, "no memory descriptors before central admission");
    assert.equal(f.calls.length, 0);
  } finally { controller.abort(); input.end(); await serving; output.destroy(); await server.stop(); }
}

test("L2: a memory shim refuses initialize and discovery when the central binding is unconfigured", { timeout: 10000 },
  async () => scratch(root => refusedMemoryBridge(root, false)));
test("L2: a memory shim refuses a central lock mismatch before discovery or dispatch", { timeout: 10000 },
  async () => scratch(root => refusedMemoryBridge(root, true)));
test("L2: bridge refuses absent bindings and bad lock digests before delegation", async () => scratch(async root => {
  const path = join(root, "lock.json"), f = fixture();
  for (const broken of ["host", "entry", "config"]) {
    const lock = lockFor();
    if (broken === "entry") lock.entries[MEMORY_ID].digest = "f".repeat(64);
    if (broken === "config") lock.entries[MEMORY_ID].configDigest = "f".repeat(64);
    writeFileSync(path, JSON.stringify(lock));
    let output = "", delegated = 0;
    const code = await cmdRegistryBridge(["serve", "--host", "claude", "--instance", "claude:test", "--lock", path],
      { stdout: { write: x => { output += x; } }, stderr: { write: x => { output += x; } }, cwd: () => root },
      { memory: { ...f.memory, host: undefined }, delegateServe: async () => { delegated++; return 0; } });
    assert.equal(code, 2, output); assert.equal(delegated, 0);
    assert.match(output, broken === "host" ? /missing_binding.*not configured/ : /integrity_mismatch/);
    assert.equal(f.loads(), 0); assert.equal(f.calls.length, 0);
  }
}));
