// L2 round 3: producer-blocker witnesses and wire-contract receipts.
//
// - The sentropic#844 todo test below is RED today: the installed
//   @sentropic/cluster-mesh 0.22.4 exposes no `./mcp/memory` acquisition
//   point, so the dynamic import throws. It will pass once sentropic#844
//   publishes the configured memory builtin (wire-manifest fix included).
//   Declared as a versioned non-test in scripts/test-non-tests-0986.json.
// - Every other test in this file passes today against the contract-faithful
//   McpRegistryBuiltin double in ./helpers/engram-memory-contract.js. None
//   fabricates storage, host bindings or invocation context (the rejected
//   pilot shortcuts); refusals stay atomic and fencing stays central.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";
import { bridgeCentralMcpStdio } from "../dist/runtime/mcp-central-client.js";
import { captureCentralAttachment } from "../dist/runtime/mcp-central-context.js";
import { bridgeLockDigest } from "../dist/registry/bridge-lock.js";
import { registryPackageManifest } from "../dist/registry/manifest.js";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { canonicalJson, sha256Hex, validateRegistryEntry } from "../dist/registry/descriptors.js";
import { composeDaemonRegistry } from "../dist/registry/sentropic-daemon.js";
import { resolveHostMemoryRegistration } from "../dist/registry/memory-provider.js";
import { openCentralAttachment } from "../dist/runtime/mcp-central-attachment.js";
import * as central from "../dist/runtime/mcp-central.js";
import { createLocalStore } from "../dist/runtime/local-files/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MEMORY_NAMES, entry, configuration, fixture } from "./helpers/engram-memory-contract.js";

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
  const dir = mkdtempSync(join(tmpdir(), "h2a-memory-r3-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// RED witness for sentropic#844 (Feature: Cluster mesh memory MCP builtin,
// OPEN). Verified RED on 2026-10-30 against the installed toolchain:
// - `import("@sentropic/cluster-mesh/mcp/memory")` throws
//   ERR_PACKAGE_PATH_NOT_EXPORTED (installed mesh is 0.22.4, no subpath).
// - Serving the pre-fix producer wire shape through the real central
//   protocol rejects `tools/list`: every memory tool declares
//   `outputSchema: { oneOf: […] }` with no top-level `type: "object"`
//   (observed on the pinned pilot tarball sentropic-engram-0.22.0.tgz
//   sha256 0e740e5c…, sentropic f7166a1be), and the installed MCP SDK
//   1.32.1 requires `outputSchema.type == "object"`.
// The producer fix (`createEngramMemoryWireManifest`, sentropic#844 head
// 44dd0102d) wraps the roots; h2a adds no rewrite and serves whatever the
// configured builtin advertises. Activating this test post-#844 trips the
// versioned non-test declaration for review (scripts/test-non-tests-0986.json).
// Bare `test.todo`, the only status the execution proof accepts for a
// not-yet test: a throwing body would fail the whole file in the proof.
test.todo(
  "L2: producer wire descriptors stay SDK-accepted through the h2a mapping — waiting on sentropic#844",
);

test("L2R3: producer MCP envelope survives the real attachment protocol with structured content", async () => scratch(async root => {
  const f = fixture();
  // Producer envelope shape, observed on the qualified pilot roundtrip
  // (real PostgreSQL, pinned tarballs): MCP-shaped result carrying both
  // `content` text and `structuredContent`. h2a forwards `transport`
  // untouched — no rewrite, no loss.
  const envelope = {
    content: [{ type: "text", text: "Memory pilot remembers the violet lantern." }],
    structuredContent: { ok: true, output: { schema_version: 1, value: { status: "committed_pending" } }, auditId: "audit-r3-envelope", redactionClass: "high" },
    isError: false
  };
  f.definition.adapter.invokeTool = async request => {
    f.calls.push(request);
    return { ok: true, output: envelope, auditId: "audit-r3-envelope", redactionClass: "high" };
  };
  const store = createLocalStore({ root });
  const handle = openCentralAttachment(root, root, store, undefined, async () => {}, undefined, undefined, { lock: lockFor(), memory: f.memory });
  let fenceCalls = 0;
  const protocol = central.createCentralProtocolServer(handle.mcp, { call: async fn => { fenceCalls++; return fn(); } });
  const client = new Client({ name: "l2r3-envelope-fixture", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await handle.ready;
    await Promise.all([protocol.connect(a), client.connect(b)]);
    const result = await client.callTool({ name: MEMORY_NAMES[2], arguments: {} });
    assert.equal(result.isError, false);
    assert.deepEqual(result.structuredContent, envelope.structuredContent);
    assert.equal(result.content[0].text, "Memory pilot remembers the violet lantern.");
    assert.equal(f.calls.length, 1);
    assert.equal(fenceCalls, 1);
  } finally { await client.close(); await protocol.close(); await handle.close(); }
}));

async function shimRefusal(root, { lock, f, configured }) {
  const memory = f.memory;
  const runtimeBase = join(root, "runtime"), physicalPrefix = join(root, "prefix");
  mkdirSync(runtimeBase, { mode: 0o700 }); mkdirSync(physicalPrefix, { mode: 0o700 });
  const server = await central.startCentralMcpServer({ root, runtimeBase, physicalPrefix, env: {}, ...(configured ? { registry: { lock, memory } } : {}) });
  const input = new PassThrough(), output = new PassThrough(), controller = new AbortController();
  const frames = [];
  let buffer = "";
  output.on("data", data => {
    buffer += data.toString();
    for (;;) {
      const newline = buffer.indexOf("\n"); if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (!line) continue;
      frames.push(JSON.parse(line));
    }
  });
  const tools = (await composeDaemonRegistry({ view: "combined", root, lock, memory })).tools();
  const attachment = captureCentralAttachment(root, root, { host: "codex", "registry-lock-digest": configured ? bridgeLockDigest(lock) : "f".repeat(64) }, {});
  const serving = bridgeCentralMcpStdio({ runtimeBase, stdin: input, stdout: output, signal: controller.signal, workspaceRoot: root, attachment, registryTools: tools });
  const request = (id, method, params) => new Promise(resolve => {
    const timer = setInterval(() => {
      const frame = frames.find(frame => frame.id === id);
      if (frame) { clearInterval(timer); resolve(frame); }
    }, 5);
    input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  return { f, serving, controller, input, output, server, request, frames,
    async done() { controller.abort(); input.end(); await serving; output.destroy(); await server.stop(); } };
}

test("L2R3: refusal receipts carry request, response and driver for unselected memory", { timeout: 15000 }, async () => scratch(async root => {
  const f = fixture(), lock = lockFor();
  const session = await shimRefusal(root, { lock, f, configured: false });
  try {
    const init = await session.request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "l2r3-unselected", version: "1" } });
    assert.ok(init.error, "unconfigured central refuses memory initialize");
    assert.equal(init.id, 1);
    const list = await session.request(2, "tools/list", {});
    assert.ok(list.error, "no memory descriptors before central admission");
    assert.equal(list.id, 2);
    assert.equal(f.calls.length, 0, "no engine call without central admission");
    // The shim composes descriptors before admission, so the double may load
    // once; refusal is proven by zero dispatches, not zero loads.
  } finally { await session.done(); }
}));

test("L2R3: refusal receipts carry request, response and driver for a refused destructive call", { timeout: 15000 }, async () => scratch(async root => {
  const f = fixture(); f.refuse();
  const lock = lockFor();
  const session = await shimRefusal(root, { lock, f, configured: true });
  try {
    const init = await session.request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "l2r3-destructive", version: "1" } });
    assert.ok(init.result, "selected central admits initialize");
    const list = await session.request(2, "tools/list", {});
    assert.equal(list.result.tools.filter(t => t.name.startsWith("engram_memory_")).length, 6);
    const call = await session.request(3, "tools/call", { name: "engram_memory_forget", arguments: { record_id: "mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotency_key: "r3-forget-1", reason_ref: "pilot" } });
    assert.ok(call.error ?? call.result?.isError, `destructive refusal surfaced: ${JSON.stringify(call).slice(0, 300)}`);
    assert.equal(f.calls.length, 0, "refused before any engine call");
  } finally { await session.done(); }
}));

test("L2R3: refusal receipts carry request, response and driver for a foreign purpose", { timeout: 15000 }, async () => scratch(async root => {
  const f = fixture(); f.refuse();
  const lock = lockFor();
  const session = await shimRefusal(root, { lock, f, configured: true });
  try {
    const init = await session.request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "l2r3-foreign", version: "1" } });
    assert.ok(init.result, "selected central admits initialize");
    const call = await session.request(2, "tools/call", { name: "engram_memory_capture", arguments: { tenant_id: "forged", idempotency_key: "r3-foreign-1" } });
    assert.ok(call.error ?? call.result?.isError, `foreign-purpose refusal surfaced: ${JSON.stringify(call).slice(0, 300)}`);
    assert.equal(f.calls.length, 0, "refused before any engine call");
  } finally { await session.done(); }
}));

test("L2R3: close then reopen serves memory again with an isolated driver", async () => scratch(async root => {
  const lock = lockFor();
  async function serveOnce(dir, name) {
    const f = fixture();
    mkdirSync(dir, { recursive: true });
    const store = createLocalStore({ root: dir });
    const handle = openCentralAttachment(dir, dir, store, undefined, async () => {}, undefined, undefined, { lock, memory: f.memory });
    const protocol = central.createCentralProtocolServer(handle.mcp, { call: async fn => fn() });
    const client = new Client({ name, version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await handle.ready;
      await Promise.all([protocol.connect(a), client.connect(b)]);
      const result = await client.callTool({ name: MEMORY_NAMES[0], arguments: {} });
      assert.equal(result.isError, false);
      assert.equal(f.calls.length, 1);
    } finally { await client.close(); await protocol.close(); await handle.close(); }
    return f.calls.length;
  }
  assert.equal(await serveOnce(join(root, "first"), "l2r3-reopen-first"), 1);
  assert.equal(await serveOnce(join(root, "second"), "l2r3-reopen-second"), 1);
}));

test("L2R3: host registration seam resolves supplied memory and refuses without it", async () => {
  const f = fixture();
  assert.equal(await resolveHostMemoryRegistration(f.memory), f.memory);
  await assert.rejects(resolveHostMemoryRegistration(undefined), /missing_binding.*cluster-mesh.*sentropic\.engram\.memory.*builtin/);
  await assert.rejects(resolveHostMemoryRegistration({ entry, builtin: { ...f.memory.builtin, providerId: "other.memory" } }), /missing_binding/);
});
