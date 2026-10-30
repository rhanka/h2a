// H2A-DISP-354 — memory dispatch contract through the real attachment protocol.
//
// Positive lane (r2.md §6.2, §8.2 row 5; consumer-context §1–§4):
// - the producer CallToolResult crosses the daemon and the central protocol
//   UNCHANGED (structuredContent, content, isError, auditId, redactionClass),
//   for both success and business-refusal envelopes;
// - caller cancellation (extra.signal) reaches the producer seam within the
//   same invocation; the idempotency key and a host-verified elicitation ref
//   ride the producer envelope;
// - runtime discovery surfaces producer annotations and _meta['sentropic.engram/memory'];
// - the frozen 11-key H3 record reaches the resolver with the lateral
//   transport material (transportMac, channelBinding, sessionId) on the
//   sibling `transport` member, never on the wire record.
//
// Negative lane — the M0-frozen 12-vector Blocker-3 replay corpus
// (spec-r4-h2a-cosign.md §1.2.2). The bijective mapping between the h2a test
// vector ids and the cluster-mesh internal audit sub-reasons:
//   V1  / B3-V01  missing_binding            / authority_binding_missing
//   V2  / B3-V02  admission_required         / central_admission_required
//   V3  / B3-V03  cross_tenant               / tenant_membership_mismatch, membership_receipt_subject_mismatch
//   V4  / B3-V04  cross_agent                / agent_association_mismatch, instance_id_substituted_for_agent_id
//   V5  / B3-V05  association_stale          / stale_association_revision
//   V6  / B3-V06  key_set_stale              / superseded_key_set_revision
//   V7  / B3-V07  workspace_unmapped         / workspace_unmapped
//   V8  / B3-V08  tool_not_allowed           / tool_not_allowed, passthrough_memory_disabled, purpose_not_granted
//   V9  / B3-V09  policy_superseded          / policy_revision_superseded
//   V10 / B3-V10  policy_unavailable         / policy_unavailable
//   V11 / B3-V11  resolver_exception, receipt_window_invalid / receipt_window_or_replay_invalid
//   V12 / B3-V12  admission_invalid          / forged_connection_or_credential_proof
// Every vector refuses with ZERO producer dispatches and a stable typed reason.
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
  transportEpoch: 1,
  centralHost: "codex",
  channelBinding: "in_process_verified",
  sessionId: "session-disp-354",
  signedRequestId: "req-disp-354-1",
  identity: IDENTITY,
  admittedAt: "2026-10-30T00:00:00.000Z"
};
const EVIDENCE_KEYS = ["format", "agentUuid", "instanceId", "launchName", "attachmentRef",
  "transportEpoch", "centralHost", "verdict", "admittedAt", "signedRequestId", "evidenceDigest"];

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
 * permissive resolver double and valid H3 admission; each test overrides what
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
    assert.deepEqual(Object.keys(input.evidence).sort(), [...EVIDENCE_KEYS].sort(), "the resolver must receive the frozen 11-key record");
    assert.equal(input.evidence.attachmentRef, MATERIAL.attachmentId);
    assert.equal(input.evidence.transportEpoch, "epoch:20261030:0001", "a fenced numeric epoch formats into the frozen epoch token");
    // The lateral transport material rides the sibling member, never the record.
    assert.equal(input.transport.transportMac, MATERIAL.transportMac);
    assert.equal(input.transport.channelBinding, "in_process_verified");
    assert.equal(input.transport.sessionId, MATERIAL.sessionId);
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

// ---- Negative lane: the M0-frozen Blocker-3 replay corpus (zero producer calls each) ----

test("V1/B3-V01: the attachment alone (no MemoryHostResolverPort) refuses with zero producer calls", async () => scratch(async () => {
  const session = await memorySession({ resolver: null });
  try {
    await assert.rejects(session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} }), /missing_binding.*resolver|resolver.*missing_binding/i);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));

test("V2/B3-V02: no H3 admission evidence refuses fail-closed", async () => scratch(async () => {
  const session = await memorySession({ admission: () => undefined });
  try {
    const result = await session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} });
    assert.equal(result.isError, true);
    assert.match(JSON.parse(result.content[0].text).error, /^admission_required:/);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));

// Frozen resolver-refusal replay: the exact h2a typed codes with the frozen
// cluster-mesh internal audit sub-reasons riding the refusal messages
// (spec-r4-h2a-cosign.md §1.2.2, B3-V03..B3-V10).
for (const vector of [
  { id: "V3/B3-V03", code: "cross_tenant", reason: "tenant_membership_mismatch", message: "tenant does not match the admission (tenant_membership_mismatch)" },
  { id: "V4/B3-V04", code: "cross_agent", reason: "agent_association_mismatch", message: "agent does not match the admission (agent_association_mismatch)" },
  { id: "V5/B3-V05", code: "association_stale", reason: "stale_association_revision", message: "L1↔L2 association revision is stale (stale_association_revision)" },
  { id: "V6/B3-V06", code: "key_set_stale", reason: "superseded_key_set_revision", message: "key-set revision is stale (superseded_key_set_revision)" },
  { id: "V7/B3-V07", code: "workspace_unmapped", reason: "workspace_unmapped", message: "workspace has no durable id mapping (workspace_unmapped)" },
  { id: "V9/B3-V09", code: "policy_superseded", reason: "policy_revision_superseded", message: "policy revision superseded (policy_revision_superseded)" },
  { id: "V10/B3-V10", code: "policy_unavailable", reason: "policy_unavailable", message: "F15 decision producer unavailable (policy_unavailable)" },
  { id: "V11/B3-V11", code: "receipt_window_invalid", reason: "receipt_window_or_replay_invalid", message: "admission receipt window or replay violation (receipt_window_or_replay_invalid)" }
]) {
  test(`${vector.id}: resolver refusal "${vector.code}" surfaces the typed reason and the frozen sub-reason with zero producer calls`, async () => scratch(async () => {
    const session = await memorySession({ resolver: { resolveContext: async () => ({ ok: false, code: vector.code, message: vector.message }) } });
    try {
      const result = await session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} });
      assert.equal(result.isError, true);
      const error = JSON.parse(result.content[0].text).error;
      assert.match(error, new RegExp(`^${vector.code}:`), "the resolver's typed code must survive to the client");
      assert.ok(error.includes(vector.reason), `the frozen internal audit sub-reason ${vector.reason} must ride the refusal`);
      assert.equal(session.f.calls.length, 0);
    } finally { await session.close(); }
  }));
}

test("V4/B3-V04: instance-id substitution for the agent id is a cross-agent refusal (instance_id_substituted_for_agent_id)", async () => scratch(async () => {
  const session = await memorySession({ resolver: { resolveContext: async () => ({ ok: false, code: "cross_agent", message: "per-conversation instanceId substituted for binding.agent_id (instance_id_substituted_for_agent_id)" }) } });
  try {
    const result = await session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} });
    assert.equal(result.isError, true);
    assert.match(JSON.parse(result.content[0].text).error, /^cross_agent:/);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));

test("V8/B3-V08: an out-of-set tool refuses before producer dispatch (F15 per-call tool set)", async () => scratch(async () => {
  const session = await memorySession({ resolver: { resolveContext: async () => ({ ok: true, context: { marker: "partial" }, allowedTools: [MEMORY_NAMES[0]], policyRevision: "rev-8" }) } });
  try {
    const result = await session.client.callTool({ name: MEMORY_NAMES[1], arguments: {} });
    assert.equal(result.isError, true);
    assert.match(JSON.parse(result.content[0].text).error, /^tool_not_allowed:/);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));

test("V8/B3-V08: a pass-through CLI session and an ungranted purpose are typed resolver refusals", async () => scratch(async () => {
  for (const refusal of [
    { code: "passthrough_memory_disabled", message: "pass-through CLI session has no memory authority (passthrough_memory_disabled)" },
    { code: "purpose_not_granted", message: "no purpose granted for this attachment (purpose_not_granted)" }
  ]) {
    const session = await memorySession({ resolver: { resolveContext: async () => ({ ok: false, code: refusal.code, message: refusal.message }) } });
    try {
      const result = await session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} });
      assert.equal(result.isError, true);
      const error = JSON.parse(result.content[0].text).error;
      assert.match(error, new RegExp(`^${refusal.code}:`));
      assert.equal(session.f.calls.length, 0);
    } finally { await session.close(); }
  }
}));

test("V11/B3-V11: a resolver defect propagates loudly and never fabricates a context", async () => scratch(async () => {
  const session = await memorySession({ resolver: { resolveContext: async () => { throw new Error("resolver exploded"); } } });
  try {
    await assert.rejects(session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} }), /resolver exploded/);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));

test("V12/B3-V12: tampered H3 evidence (digest mismatch) refuses fail-closed", async () => scratch(async () => {
  const tampered = { ...admissionEvidence(), evidence: { ...admissionEvidence().evidence, signedRequestId: `${MATERIAL.signedRequestId}-forged` } };
  const session = await memorySession({ admission: () => tampered });
  try {
    const result = await session.client.callTool({ name: MEMORY_NAMES[0], arguments: {} });
    assert.equal(result.isError, true);
    assert.match(JSON.parse(result.content[0].text).error, /^admission_invalid:/);
    assert.equal(session.f.calls.length, 0);
  } finally { await session.close(); }
}));
