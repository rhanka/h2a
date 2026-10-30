// H2A-DISP-354 — H3 SessionAdmissionEvidenceV1 emission (r2.md §6.2, §8.1 H3).
//
// The evidence is an inputs-only admission record: it binds what the central
// actually verified (attachmentId, transportMac, transportEpoch, host,
// channelBinding, sessionId — plus the r2 §8.1 identity correlation and the
// structural wire fields). It grants NO authority: no tenant, workspace,
// membership, scope, purpose or audit field may appear on it.
//
// The record digest follows the transport digest family (sha256 over RFC 8785
// canonical bytes, `handover/wire.js`), so `verifySessionAdmissionEvidence`
// recomputes it without any new canonicalization.
//
// The last test proves emission over the real authenticated central route
// (startCentralMcpServer + the stdio bridge): the per-request verified MAC
// admitted by `createAuthenticatedServer` and the attachment's transport epoch
// and session id reach the host resolver bound inside the evidence.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";
import * as context from "../dist/runtime/mcp-central-context.js";
import * as attachmentExports from "../dist/runtime/mcp-central-attachment.js";
import { digest } from "../dist/runtime/handover/wire.js";
import { bridgeCentralMcpStdio } from "../dist/runtime/mcp-central-client.js";
import { bridgeLockDigest } from "../dist/registry/bridge-lock.js";
import { registryPackageManifest } from "../dist/registry/manifest.js";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { canonicalJson, sha256Hex, validateRegistryEntry } from "../dist/registry/descriptors.js";
import { composeDaemonRegistry } from "../dist/registry/sentropic-daemon.js";
import * as central from "../dist/runtime/mcp-central.js";
import { MEMORY_NAMES, entry, configuration, fixture } from "./helpers/engram-memory-contract.js";

const IDENTITY = { agentUuid: "01234567-89ab-4cde-8f01-234567890123", instanceId: "codex:pilot-h3:0123456789ab", launchName: "pilot-h3" };
const MATERIAL = {
  attachmentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  transportMac: "ab".repeat(32),
  transportEpoch: "1",
  centralHost: "codex",
  channelBinding: "in_process_verified",
  sessionId: "session-h3-emit",
  signedRequestId: "req-h3-emit-1",
  identity: IDENTITY,
  admittedAt: "2026-10-30T00:00:00.000Z"
};
const EVIDENCE_KEYS = ["format", "agentUuid", "instanceId", "launchName", "attachmentRef", "transportMac",
  "transportEpoch", "centralHost", "channelBinding", "sessionId", "verdict", "admittedAt", "signedRequestId", "evidenceDigest"];

function build(overrides = {}) {
  const material = { ...MATERIAL, ...overrides };
  return context.buildSessionAdmissionEvidence({
    attachmentRef: material.attachmentId, transportMac: material.transportMac, transportEpoch: material.transportEpoch,
    centralHost: material.centralHost, channelBinding: material.channelBinding, sessionId: material.sessionId,
    agentUuid: material.identity.agentUuid, instanceId: material.identity.instanceId, launchName: material.identity.launchName,
    admittedAt: material.admittedAt, signedRequestId: material.signedRequestId
  });
}

async function scratch(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-h3-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("H3: buildSessionAdmissionEvidence emits the r2 8.1 record binding the six verified fields", () => {
  assert.equal(typeof context.buildSessionAdmissionEvidence, "function", "H3 builder must be exported from mcp-central-context.ts");
  const evidence = build();
  assert.equal(evidence.format, "h2a.session-admission/v1");
  assert.equal(evidence.verdict, "admitted");
  assert.equal(evidence.attachmentRef, MATERIAL.attachmentId);
  assert.equal(evidence.transportMac, MATERIAL.transportMac);
  assert.equal(evidence.transportEpoch, MATERIAL.transportEpoch);
  assert.equal(evidence.centralHost, MATERIAL.centralHost);
  assert.equal(evidence.channelBinding, MATERIAL.channelBinding);
  assert.equal(evidence.sessionId, MATERIAL.sessionId);
  assert.equal(evidence.agentUuid, IDENTITY.agentUuid);
  assert.equal(evidence.instanceId, IDENTITY.instanceId);
  assert.equal(evidence.launchName, IDENTITY.launchName);
  assert.equal(evidence.admittedAt, MATERIAL.admittedAt);
  assert.equal(evidence.signedRequestId, MATERIAL.signedRequestId);
  assert.match(evidence.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
  const { evidenceDigest, ...record } = evidence;
  assert.equal(digest(record), evidenceDigest, "evidenceDigest must be the transport-family digest of the record without itself");
});

test("H3: verifySessionAdmissionEvidence recomputes the digest and rejects any tampering", () => {
  assert.equal(typeof context.verifySessionAdmissionEvidence, "function", "H3 verifier must be exported from mcp-central-context.ts");
  const evidence = build();
  assert.equal(context.verifySessionAdmissionEvidence(evidence), true);
  for (const field of ["attachmentRef", "transportMac", "transportEpoch", "centralHost", "channelBinding", "sessionId", "agentUuid", "instanceId", "launchName", "admittedAt", "signedRequestId", "verdict", "format"]) {
    assert.equal(context.verifySessionAdmissionEvidence({ ...evidence, [field]: field === "transportEpoch" ? "2" : `${evidence[field]}-tampered` }), false, `${field} tampering must fail verification`);
  }
  assert.equal(context.verifySessionAdmissionEvidence({ ...evidence, evidenceDigest: `sha256:${"0".repeat(64)}` }), false);
  assert.equal(context.verifySessionAdmissionEvidence({ ...evidence, verdict: "suspected" }), false);
  assert.equal(context.verifySessionAdmissionEvidence({ ...evidence, format: "h2a.session-admission/v2" }), false);
  assert.equal(context.verifySessionAdmissionEvidence({}), false);
  assert.equal(context.verifySessionAdmissionEvidence(null), false);
  assert.equal(context.verifySessionAdmissionEvidence("h2a.session-admission/v1"), false);
});

test("H3: the builder refuses unsupported channel bindings and malformed identity", () => {
  assert.throws(() => build({ channelBinding: "carrier_pigeon_verified" }), /channel/i);
  assert.throws(() => build({ transportMac: "nothex" }), /transportMac/i);
  assert.throws(() => build({ transportEpoch: "one" }), /transportEpoch/i);
  assert.throws(() => build({ attachmentId: "" }), /attachment/i);
  assert.throws(() => build({ centralHost: "not-a-central-host" }), /host/i);
  assert.throws(() => build({ identity: { ...IDENTITY, agentUuid: "not-a-uuid" } }), /agentUuid/i);
  assert.throws(() => build({ identity: { ...IDENTITY, instanceId: "codex:other-label:0123456789ab" } }), /instance/i);
  assert.throws(() => build({ identity: { ...IDENTITY, instanceId: "codex:pilot-h3:ffffffffffff" } }), /instance/i);
  assert.throws(() => build({ identity: { ...IDENTITY, launchName: "" } }), /launchName/i);
  assert.throws(() => build({ admittedAt: "yesterday" }), /admittedAt/i);
  assert.throws(() => build({ signedRequestId: "" }), /signedRequestId/i);
});

test("H3: the record carries no tenant, workspace, scope, purpose or audit authority", () => {
  const evidence = build();
  assert.deepEqual(Object.keys(evidence).sort(), [...EVIDENCE_KEYS].sort());
  for (const forbidden of ["tenant", "tenantRef", "tenant_id", "workspace", "workspaceRef", "workspaceId", "membership",
    "scope", "scopes", "purpose", "purposeRef", "audit", "auditId", "principal", "claims", "authority", "authorization"]) {
    assert.equal(forbidden in evidence, false, `H3 must not carry ${forbidden}`);
  }
});

test("H3: sessionAdmissionEvidence binds the attachment material or refuses closed, never throws", () => {
  assert.equal(typeof attachmentExports.sessionAdmissionEvidence, "function", "H3 assembler must be exported from mcp-central-attachment.ts");
  const evidence = attachmentExports.sessionAdmissionEvidence(MATERIAL);
  assert.ok(evidence, "valid material must produce evidence");
  assert.equal(evidence.attachmentRef, MATERIAL.attachmentId);
  assert.equal(evidence.transportMac, MATERIAL.transportMac);
  assert.equal(evidence.transportEpoch, MATERIAL.transportEpoch);
  assert.equal(evidence.centralHost, MATERIAL.centralHost);
  assert.equal(evidence.channelBinding, MATERIAL.channelBinding);
  assert.equal(evidence.sessionId, MATERIAL.sessionId);
  assert.equal(evidence.agentUuid, IDENTITY.agentUuid);
  assert.equal(context.verifySessionAdmissionEvidence(evidence), true);
  // Fail-closed: no identity correlation, unsupported channel, or malformed
  // material yields NO evidence (undefined), never a partial record or a throw.
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, identity: undefined }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, identity: null }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, channelBinding: "bogus_verified" }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, transportMac: "zz" }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence(undefined), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({}), undefined);
});

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

test("H3: the authenticated central route emits evidence bound to the verified request MAC, epoch and session", { timeout: 15000 }, async () => scratch(async root => {
  const f = fixture(), lock = lockFor();
  // Perennial identity binding for the attachment's stability unit: the central
  // resolves agentUuid/instanceId from it and refuses emission without it.
  mkdirSync(join(root, "identity"), { recursive: true });
  writeFileSync(join(root, "identity", "bindings.jsonl"),
    JSON.stringify({ host: "codex", providerSessionId: "conv-h3-route-1", workspaceId: "unused-by-lookup",
      instance: "codex:pilot-h3:0123456789ab", agentUuid: "01234567-89ab-4cde-8f01-234567890123", at: "2026-10-30T00:00:00.000Z" }) + "\n");
  const runtimeBase = join(root, "runtime"), physicalPrefix = join(root, "prefix");
  mkdirSync(runtimeBase, { mode: 0o700 }); mkdirSync(physicalPrefix, { mode: 0o700 });
  const seen = [];
  f.memory.resolver = { resolveContext: async input => { seen.push(input); return { ok: true, context: { route: true }, allowedTools: [...MEMORY_NAMES], policyRevision: "route-1" }; } };
  const server = await central.startCentralMcpServer({ root, runtimeBase, physicalPrefix, env: {}, registry: { lock, memory: f.memory } });
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
  const tools = (await composeDaemonRegistry({ view: "combined", root, lock, memory: f.memory })).tools();
  const attachment = context.captureCentralAttachment(root, root,
    { host: "codex", name: "pilot-h3", "registry-lock-digest": bridgeLockDigest(lock) }, { CLAUDE_CODE_SESSION_ID: "conv-h3-route-1" });
  const serving = bridgeCentralMcpStdio({ runtimeBase, stdin: input, stdout: output, signal: controller.signal, workspaceRoot: root, attachment, registryTools: tools });
  const request = (id, method, params) => new Promise(resolve => {
    const timer = setInterval(() => {
      const frame = frames.find(frame => frame.id === id);
      if (frame) { clearInterval(timer); resolve(frame); }
    }, 5);
    input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  try {
    const init = await request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "h3-route", version: "1" } });
    assert.ok(init.result, `initialize must succeed: ${JSON.stringify(init).slice(0, 200)}`);
    const call = await request(2, "tools/call", { name: MEMORY_NAMES[0], arguments: { idempotency_key: "h3-route-1" } });
    assert.equal(call.result?.isError, false, `memory call must succeed: ${JSON.stringify(call).slice(0, 300)}`);
    assert.equal(f.calls.length, 1, "exactly one producer dispatch");
    assert.equal(seen.length, 1, "the host resolver must be consulted exactly once");
    const evidence = seen[0].evidence;
    assert.ok(evidence, "the resolver input must carry H3 evidence");
    assert.equal(context.verifySessionAdmissionEvidence(evidence), true);
    assert.match(evidence.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(evidence.agentUuid, "01234567-89ab-4cde-8f01-234567890123");
    assert.equal(evidence.instanceId, "codex:pilot-h3:0123456789ab");
    assert.equal(evidence.launchName, "pilot-h3");
    assert.equal(evidence.centralHost, "codex");
    assert.equal(evidence.channelBinding, "stdio_host_managed_verified");
    assert.match(evidence.transportMac, /^[0-9a-f]{64}$/, "the evidence must bind the verified per-request transport MAC");
    assert.match(evidence.transportEpoch, /^[1-9][0-9]*$/, "the evidence must bind the attachment transport epoch");
    assert.ok(evidence.attachmentRef, "the evidence must bind the verified attachment id");
    assert.ok(evidence.sessionId, "the evidence must bind the MCP session id");
    assert.deepEqual(Object.keys(evidence).sort(), [...EVIDENCE_KEYS].sort());
    assert.equal(call.result.structuredContent.auditId, "mesh-issued-audit");
  } finally {
    controller.abort(); input.end(); await serving; output.destroy(); await server.stop();
  }
}));
