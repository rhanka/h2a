// H2A-DISP-354 — memory dispatch contract through the real attachment protocol.
//
// Positive lane (r2.md §6.2, §8.2 row 5; consumer-context §1–§4):
// - the producer CallToolResult crosses the daemon and the central protocol
//   UNCHANGED (structuredContent, content, isError, auditId, redactionClass),
//   for both success and business-refusal envelopes;
// - caller cancellation (extra.signal) reaches the producer seam within the
//   same invocation; the idempotency key and a host-verified elicitation ref
//   ride the producer envelope;
// - runtime discovery surfaces producer annotations and _meta['sentropic.engram/memory'].
//
// Negative lane — the Blocker-3 replay corpus. The referenced 12-vector list
// has no literal §3.1 in consumer-context.md; the corpus below is derived
// from r2.md §6.2 (the five substitution classes: cross-tenant, cross-agent,
// stale association, stale key-set revision, unmapped workspace) plus the
// h2a-side dispatch duties named in the lot (attachment alone, no evidence,
// out-of-set tool, superseded policy, policy unavailable, resolver defect,
// invalid evidence). Every vector must refuse with ZERO producer dispatches
// and a stable typed reason:
//   V1  attachment alone (no MemoryHostResolverPort bound)
//   V2  no H3 admission evidence for the call
//   V3  cross-tenant substitution
//   V4  cross-agent substitution
//   V5  stale association revision
//   V6  stale key-set revision
//   V7  unmapped workspace
//   V8  out-of-set tool (F15 per-call tool set)
//   V9  superseded policy revision
//   V10 policy unavailable (H1 fail-closed)
//   V11 resolver defect (propagates loudly, never fabricates a context)
//   V12 invalid H3 evidence (digest tampering)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as context from "../dist/runtime/mcp-central-context.js";
import * as attachmentExports from "../dist/runtime/mcp-central-attachment.js";
import { registryPackageManifest } from "../dist/registry/manifest.js";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { canonicalJson, sha256Hex, validateRegistryEntry } from "../dist/registry/descriptors.js";
import { openCentralAttachment } from "../dist/runtime/mcp-central-attachment.js";
import * as central from "../dist/runtime/mcp-central.js";
import { createLocalStore } from "../dist/runtime/local-files/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MEMORY_NAMES, entry, configuration, fixture } from "./helpers/engram-memory-contract.js";

const IDENTITY = { agentUuid: "01234567-89ab-4cde-8f01-234567890123", instanceId: "codex:pilot-h3:0123456789ab", launchName: "pilot-h3" };
const MATERIAL = {
  attachmentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  transportMac: "cd".repeat(32),
  transportEpoch: "1",
  centralHost: "codex",
  channelBinding: "in_process_verified",
  sessionId: "session-disp-354",
  signedRequestId: "req-disp-354-1",
  identity: IDENTITY,
  admittedAt: "2026-10-30T00:00:00.000Z"
};

function lockFor() {
  const entries = [...registryPackageManifest.entries, ...trackRegistryPackageManifest.entries, entry];
  // Per-entry configs keyed by registry id, not manifest position: the shipped
  // manifest may grow entries (r3 added sentropic.ui-render) and a positional
  // configs[i] would silently mis-map every entry after the insertion. An entry
  // with no explicit config takes its schema defaults, never an undefined one.
  const configs = {
    "sentropic.h2a": { mode: "shared-central", serviceBindingRef: "h2a-local-central" },
    "sentropic.track": { access: "read-only", repositoryBindingRef: "h2a-attachment-workspace" },
    "sentropic.engram.memory": { ...configuration }
  };
  const configFor = (e) => configs[e.id] ?? { ...(e.parameters?.defaults ?? {}) };
  return { format: "h2a.registry-bridge-lock/v1", lockVersion: 1, revision: 1, host: "claude", profile: "default",
    bridge: { command: "h2a", args: [] },
    selection: entries.map(e => ({ kind: "mcp", id: e.id, entryVersion: e.entryVersion })),
    entries: Object.fromEntries(entries.map(e => [e.id, { digest: validateRegistryEntry(e).digest, config: configFor(e), configDigest: sha256Hex(canonicalJson(configFor(e))) }])),
    compatibility: { hostFeatures: ["stdio", "streamable-http", ...entry.compatibility.requiredHostFeatures], protocolVersions: ["2025-06-18"] } };
}

function admissionEvidence(material = MATERIAL) {
  return attachmentExports.sessionAdmissionEvidence(material);
}

const refusalEnvelope = {
  isError: true,
  structuredContent: { ok: false, error: { code: "purpose_not_bound", message: "no purpose bound to this attachment", retriable: false },
    auditId: "audit-disp-354-refusal", redactionClass: "high" },
  content: [{ type: "text", text: "refused: no purpose bound to this attachment" }]
};

async function scratch(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-disp354-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * In-process memory session through the real attachment protocol:
 * openCentralAttachment (registry plan installed on the attachment server)
 * + the central protocol server + an SDK client. The default session has a
 * permissive resolver double and valid H3 evidence; each test overrides what
 * its vector needs.
 */
async function memorySession(setup = {}) {
  const root = mkdtempSync(join(tmpdir(), "h2a-disp354-session-"));
  const f = fixture();
  if (setup.resolver !== undefined) f.memory.resolver = setup.resolver;
  const admission = setup.admission !== undefined ? setup.admission : () => admissionEvidence();
  const store = createLocalStore({ root });
  const registryOptions = { lock: lockFor(), memory: f.memory, admission };
  const handle = openCentralAttachment(root, root, store, undefined, async () => {}, undefined, undefined, registryOptions);
  const protocol = central.createCentralProtocolServer(handle.mcp, { call: async fn => fn() });
  const client = new Client({ name: `disp354-${setup.name ?? "session"}`, version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const close = async () => { await client.close(); await protocol.close(); await handle.close(); rmSync(root, { recursive: true, force: true }); };
  try {
    await handle.ready;
    await Promise.all([protocol.connect(a), client.connect(b)]);
  } catch (error) { await close(); throw error; }
  return { f, client, protocol, handle, root, close };
}

const until = async (predicate, label) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error(`timeout waiting for ${label}`);
};

test("DISP354: producer success envelope crosses unchanged with auditId and redactionClass", async () => scratch(async () => {
  let resolved;
  const session = await memorySession({ resolver: { resolveContext: async input => {
    assert.ok(context.verifySessionAdmissionEvidence(input.evidence), "the resolver must receive verifiable H3 evidence");
    assert.equal(input.evidence.attachmentRef, MATERIAL.attachmentId);
    assert.equal(input.evidence.transportMac, MATERIAL.transportMac);
    assert.equal(input.evidence.channelBinding, "in_process_verified");
    assert.equal(input.tool, MEMORY_NAMES[2]);
    resolved = { marker: "resolved-context", policy: input.evidence.launchName };
    return { ok: true, context: resolved, allowedTools: [...MEMORY_NAMES], policyRevision: "rev-1" };
  } } });
  try {
    const result = await session.client.callTool({ name: MEMORY_NAMES[2], arguments: { idempotency_key: "disp-354-ok-1" } });
    assert.equal(result.isError, false);
    assert.deepEqual(result.structuredContent, { ok: true, output: { schema_version: 1, value: { status: "committed_pending" } }, auditId: "mesh-issued-audit", redactionClass: "high" });
    assert.equal(result.content[0].text, "Engram memory engram_memory_capture committed.");
    assert.equal(session.f.calls.length, 1, "exactly one producer dispatch through the runtime seam");
    assert.equal(session.f.calls[0].capabilityRef, MEMORY_NAMES[2]);
    assert.equal(session.f.calls[0].ctx, resolved, "the producer must receive the resolver's context object unchanged");
    assert.deepEqual(session.f.calls[0].input, { idempotency_key: "disp-354-ok-1" });
    assert.equal(session.f.calls[0].envelope.idempotencyKey, "disp-354-ok-1", "the idempotency key must ride the producer envelope");
    assert.equal("elicitationRef" in session.f.calls[0].envelope, false, "no elicitation ref without a verified source");
  } finally { await session.close(); }
}));

test("DISP354: producer business-refusal envelope crosses unchanged (isError, structured error, auditId)", async () => scratch(async () => {
  const session = await memorySession({});
  session.f.serve(refusalEnvelope);
  try {
    const result = await session.client.callTool({ name: MEMORY_NAMES[2], arguments: {} });
    assert.equal(result.isError, true, "the producer refusal stays an isError result");
    assert.deepEqual(result.structuredContent, refusalEnvelope.structuredContent, "no re-wrapping, no envelope loss");
    assert.equal(result.structuredContent.auditId, "audit-disp-354-refusal");
    assert.equal(result.structuredContent.error.code, "purpose_not_bound");
    assert.equal(result.content[0].text, "refused: no purpose bound to this attachment");
    assert.equal(session.f.calls.length, 1);
  } finally { await session.close(); }
}));

test("DISP354: caller cancellation reaches the producer signal within the same invocation", async () => scratch(async () => {
  const session = await memorySession({});
  session.f.hold();
  const controller = new AbortController();
  try {
    const pending = session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} }, undefined, { signal: controller.signal });
    await until(() => session.f.calls.length === 1, "the producer to receive the in-flight call");
    assert.equal(session.f.calls[0].signal instanceof Object && typeof session.f.calls[0].signal.aborted === "boolean", true, "the producer seam must receive the caller AbortSignal");
    assert.equal(session.f.calls[0].signal.aborted, false);
    controller.abort();
    await assert.rejects(pending, error => /abort|cancel/i.test(String(error?.message ?? error)));
    assert.equal(session.f.calls[0].signal.aborted, true, "aborting the caller signal must abort the producer's signal");
  } finally { session.f.release(); await session.close(); }
}));

test("DISP354: a host-verified elicitation ref rides the producer envelope next to the idempotency key", async () => scratch(async () => {
  const session = await memorySession({});
  try {
    const result = await session.handle.mcp.callTool(MEMORY_NAMES[3], { idempotency_key: "disp-354-elicit-1" }, { elicitationRef: "confirm:disp-354:record-1" });
    assert.equal(session.f.calls.length, 1);
    assert.equal(session.f.calls[0].envelope.idempotencyKey, "disp-354-elicit-1");
    assert.equal(session.f.calls[0].envelope.elicitationRef, "confirm:disp-354:record-1", "the verified elicitation ref must be forwarded to the producer envelope");
    assert.ok(!(result instanceof Object && "error" in result), `the call must succeed: ${JSON.stringify(result).slice(0, 200)}`);
  } finally { await session.close(); }
}));

test("DISP354: runtime descriptors surface producer annotations and _meta[sentropic.engram/memory]", async () => scratch(async () => {
  const session = await memorySession({});
  try {
    const tools = session.handle.mcp.listTools();
    const search = tools.find(tool => tool.name === MEMORY_NAMES[0]);
    assert.ok(search, "the memory tool must be served");
    assert.deepEqual(search.annotations, { title: MEMORY_NAMES[0], readOnlyHint: true });
    assert.equal(search._meta["sentropic.engram/memory"].wireProfile, "sentropic.engram.memory-wire/v1");
    assert.equal(search._meta["sentropic.engram/memory"].tool, MEMORY_NAMES[0]);
    assert.deepEqual(search.inputSchema, { type: "object" });
  } finally { await session.close(); }
}));

// ---- Negative lane: the 12 Blocker-3 replay vectors (zero producer calls each) ----

test("V1: the attachment alone (no MemoryHostResolverPort) refuses with zero producer calls", async () => scratch(async () => {
  const session = await memorySession({ resolver: null });
  try {
    await assert.rejects(session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} }), /missing_binding.*resolver|resolver.*missing_binding/i);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));

test("V2: no H3 admission evidence refuses fail-closed", async () => scratch(async () => {
  const session = await memorySession({ admission: () => undefined });
  try {
    const result = await session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} });
    assert.equal(result.isError, true);
    assert.match(JSON.parse(result.content[0].text).error, /^admission_required:/);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));

for (const vector of [
  { id: "V3", code: "cross_tenant", message: "tenant does not match the admission" },
  { id: "V4", code: "cross_agent", message: "agent does not match the admission" },
  { id: "V5", code: "association_stale", message: "L1↔L2 association revision is stale" },
  { id: "V6", code: "key_set_stale", message: "key-set revision is stale" },
  { id: "V7", code: "workspace_unmapped", message: "workspace has no durable id mapping" },
  { id: "V9", code: "policy_superseded", message: "policy revision superseded" },
  { id: "V10", code: "policy_unavailable", message: "F15 decision producer unavailable (H1 fail-closed)" }
]) {
  test(`${vector.id}: resolver refusal "${vector.code}" surfaces the typed reason with zero producer calls`, async () => scratch(async () => {
    const session = await memorySession({ resolver: { resolveContext: async () => ({ ok: false, code: vector.code, message: vector.message }) } });
    try {
      const result = await session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} });
      assert.equal(result.isError, true);
      assert.match(JSON.parse(result.content[0].text).error, new RegExp(`^${vector.code}:`), "the resolver's typed code must survive to the client");
      assert.equal(session.f.calls.length, 0);
    } finally { await session.close(); }
  }));
}

test("V8: an out-of-set tool refuses before producer dispatch (F15 per-call tool set)", async () => scratch(async () => {
  const session = await memorySession({ resolver: { resolveContext: async () => ({ ok: true, context: { marker: "partial" }, allowedTools: [MEMORY_NAMES[0]], policyRevision: "rev-8" }) } });
  try {
    const result = await session.client.callTool({ name: MEMORY_NAMES[1], arguments: {} });
    assert.equal(result.isError, true);
    assert.match(JSON.parse(result.content[0].text).error, /^tool_not_allowed:/);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));

test("V11: a resolver defect propagates loudly and never fabricates a context", async () => scratch(async () => {
  const session = await memorySession({ resolver: { resolveContext: async () => { throw new Error("resolver exploded"); } } });
  try {
    await assert.rejects(session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} }), /resolver exploded/);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));

test("V12: tampered H3 evidence (digest mismatch) refuses fail-closed", async () => scratch(async () => {
  const tampered = { ...admissionEvidence(), sessionId: `${MATERIAL.sessionId}-forged` };
  const session = await memorySession({ admission: () => tampered });
  try {
    const result = await session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} });
    assert.equal(result.isError, true);
    assert.match(JSON.parse(result.content[0].text).error, /^admission_invalid:/);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));
