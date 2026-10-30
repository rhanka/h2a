// H2A-DISP-354 — H3 SessionAdmissionEvidenceV1 emission (r2.md §6.2, §8.1 H3;
// frozen shape spec-r4-h2a-cosign.md §3.4).
//
// The evidence is an inputs-only admission record with the EXACT frozen
// 11-key shape (format, agentUuid, instanceId, launchName, attachmentRef,
// transportEpoch, centralHost, verdict, admittedAt, signedRequestId,
// evidenceDigest). It grants NO authority: no tenant, workspace, membership,
// scope, purpose, audit — and not even the lateral transport material — may
// appear on it. `transportMac`, `channelBinding` and `sessionId` are verified
// transport material that rides ALONGSIDE the record (the assembler's
// `transport` pair member and `MemoryHostResolveInput.transport`), never
// inside it (spec-r4 §3.4 action 1).
//
// The record digest follows the transport digest family (sha256 over RFC 8785
// canonical bytes, `handover/wire.js`), so `verifySessionAdmissionEvidence`
// recomputes it without any new canonicalization; the frozen positive vector
// H3-POS-1 (spec-r4 §3.4) verifies with its pinned digest.
//
// The last tests prove emission over the real authenticated central route
// (startCentralMcpServer + the stdio bridge): the per-request verified MAC
// admitted by `createAuthenticatedServer`, the attachment's transport epoch
// and session id reach the host resolver bound inside the evidence, threaded
// per request (never through shared mutable attachment state).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PassThrough } from "node:stream";
import * as context from "../dist/runtime/mcp-central-context.js";
import * as attachmentExports from "../dist/runtime/mcp-central-attachment.js";
import { digest } from "../dist/runtime/handover/wire.js";
import { deriveInstanceId } from "../dist/identity.js";
import { resolveLiveIdentity } from "../dist/runtime/identity/live.js";
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
  transportEpoch: 1,
  centralHost: "codex",
  channelBinding: "in_process_verified",
  sessionId: "session-h3-emit",
  signedRequestId: "req-h3-emit-1",
  identity: IDENTITY,
  admittedAt: "2026-10-30T00:00:00.000Z"
};
// Frozen 11-key wire shape (r2.md §8.1 H3 = spec-r4-h2a-cosign.md §3.4).
const EVIDENCE_KEYS = ["format", "agentUuid", "instanceId", "launchName", "attachmentRef",
  "transportEpoch", "centralHost", "verdict", "admittedAt", "signedRequestId", "evidenceDigest"];
// Frozen positive vector H3-POS-1 (spec-r4 §3.4), digest pinned by SHA-256.
const H3_POS_1 = {
  format: "h2a.session-admission/v1",
  agentUuid: "8f14e45f-ceea-467a-a839-f4c8553e319e",
  instanceId: "claude:arch:8f14e45fceea",
  launchName: "arch",
  attachmentRef: "att:7c9e6679-7425-40de-944b-e07fc1f90ae7",
  transportEpoch: "epoch:20261030:0001",
  centralHost: "claude",
  verdict: "admitted",
  admittedAt: "2026-10-30T10:00:00.000Z",
  signedRequestId: "req:claude:8f14e45fceea:0001",
  evidenceDigest: "sha256:23fc9ad9504f1255c5ec63a673b781b6609dd6e135d51dd299595852d92b143b"
};

// The wire builder takes the frozen string forms; a fenced numeric counter
// (the runtime material shape) formats into the frozen token.
function epochOf(value) {
  return typeof value === "number" ? `epoch:20261030:${String(value).padStart(4, "0")}` : value;
}

function build(overrides = {}) {
  const material = { ...MATERIAL, ...overrides };
  return context.buildSessionAdmissionEvidence({
    attachmentRef: material.attachmentId, transportEpoch: epochOf(material.transportEpoch),
    centralHost: material.centralHost,
    agentUuid: material.identity.agentUuid, instanceId: material.identity.instanceId, launchName: material.identity.launchName,
    admittedAt: material.admittedAt, signedRequestId: material.signedRequestId
  });
}

async function scratch(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-h3-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("H3: buildSessionAdmissionEvidence emits the frozen r2 8.1 eleven-key record", () => {
  assert.equal(typeof context.buildSessionAdmissionEvidence, "function", "H3 builder must be exported from mcp-central-context.ts");
  const evidence = build({ transportEpoch: "epoch:20261030:0001" });
  assert.equal(evidence.format, "h2a.session-admission/v1");
  assert.equal(evidence.verdict, "admitted");
  assert.equal(evidence.attachmentRef, MATERIAL.attachmentId);
  assert.equal(evidence.transportEpoch, "epoch:20261030:0001");
  assert.equal(evidence.centralHost, MATERIAL.centralHost);
  assert.equal(evidence.agentUuid, IDENTITY.agentUuid);
  assert.equal(evidence.instanceId, IDENTITY.instanceId);
  assert.equal(evidence.launchName, IDENTITY.launchName);
  assert.equal(evidence.admittedAt, MATERIAL.admittedAt);
  assert.equal(evidence.signedRequestId, MATERIAL.signedRequestId);
  assert.match(evidence.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(evidence).sort(), [...EVIDENCE_KEYS].sort());
  const { evidenceDigest, ...record } = evidence;
  assert.equal(digest(record), evidenceDigest, "evidenceDigest must be the transport-family digest of the record without itself");
});

test("H3: the frozen positive vector H3-POS-1 builds and verifies with its pinned digest", () => {
  const { evidenceDigest, ...parts } = H3_POS_1;
  const built = context.buildSessionAdmissionEvidence(parts);
  assert.equal(built.evidenceDigest, H3_POS_1.evidenceDigest, "the builder must reproduce the pinned H3-POS-1 digest");
  assert.equal(context.verifySessionAdmissionEvidence(H3_POS_1), true, "H3-POS-1 must verify unchanged");
  assert.deepEqual(Object.keys(H3_POS_1).sort(), [...EVIDENCE_KEYS].sort());
});

test("H3: transportEpoch accepts the frozen epoch token and the decimal counter form", () => {
  for (const transportEpoch of ["epoch:20261030:0001", "1", "0"]) {
    const evidence = build({ transportEpoch });
    assert.equal(evidence.transportEpoch, transportEpoch);
    assert.equal(context.verifySessionAdmissionEvidence(evidence), true, `both frozen epoch forms must verify: ${transportEpoch}`);
  }
  assert.throws(() => build({ transportEpoch: "one" }), /transportEpoch/i);
  assert.throws(() => build({ transportEpoch: "epoch:" }), /transportEpoch/i, "an empty epoch suffix must refuse");
  assert.throws(() => build({ transportEpoch: " epoch:20261030:0001" }), /transportEpoch/i);
});

test("H3: verifySessionAdmissionEvidence recomputes the digest and rejects any tampering", () => {
  assert.equal(typeof context.verifySessionAdmissionEvidence, "function", "H3 verifier must be exported from mcp-central-context.ts");
  const evidence = build();
  assert.equal(context.verifySessionAdmissionEvidence(evidence), true);
  for (const field of ["attachmentRef", "transportEpoch", "centralHost", "agentUuid", "instanceId", "launchName", "admittedAt", "signedRequestId", "verdict", "format"]) {
    assert.equal(context.verifySessionAdmissionEvidence({ ...evidence, [field]: field === "transportEpoch" ? "epoch:20261030:0002" : `${evidence[field]}-tampered` }), false, `${field} tampering must fail verification`);
  }
  assert.equal(context.verifySessionAdmissionEvidence({ ...evidence, evidenceDigest: `sha256:${"0".repeat(64)}` }), false);
  assert.equal(context.verifySessionAdmissionEvidence({ ...evidence, verdict: "suspected" }), false);
  assert.equal(context.verifySessionAdmissionEvidence({ ...evidence, format: "h2a.session-admission/v0" }), false, "VEC-NEG-UNKNOWN-VERSION: an unknown format version must refuse");
  assert.equal(context.verifySessionAdmissionEvidence({ ...H3_POS_1, centralHost: "codex" }), false, "VEC-NEG-TAMPERED-H3-DIGEST: a tampered field with the pinned digest kept must refuse");
  assert.equal(context.verifySessionAdmissionEvidence({}), false);
  assert.equal(context.verifySessionAdmissionEvidence(null), false);
  assert.equal(context.verifySessionAdmissionEvidence("h2a.session-admission/v1"), false);
});

test("H3: the closed key set refuses unknown fields on build and verify (VEC-NEG-UNKNOWN-FIELD)", () => {
  const evidence = build();
  // Build: an extra parts key is a programmer error and must throw.
  assert.throws(() => context.buildSessionAdmissionEvidence({
    attachmentRef: MATERIAL.attachmentId, transportEpoch: "epoch:20261030:0001", centralHost: MATERIAL.centralHost,
    agentUuid: IDENTITY.agentUuid, instanceId: IDENTITY.instanceId, launchName: IDENTITY.launchName,
    admittedAt: MATERIAL.admittedAt, signedRequestId: MATERIAL.signedRequestId, extraField: true
  }), /unknown|field/i);
  // Verify: an injected field refuses EVEN when the digest was recomputed
  // over the extended record (the digest alone is not the contract).
  const extended = { ...evidence, extraField: true };
  const { evidenceDigest, ...extendedRecord } = extended;
  assert.notEqual(digest(extendedRecord), evidenceDigest, "sanity: the injected field changes the transport-family digest");
  assert.equal(context.verifySessionAdmissionEvidence({ ...extended, evidenceDigest: digest(extendedRecord) }), false, "an unknown field must refuse even with a matching recomputed digest");
  for (const lateral of ["transportMac", "channelBinding", "sessionId"]) {
    assert.equal(context.verifySessionAdmissionEvidence({ ...H3_POS_1, [lateral]: "x" }), false, `the lateral ${lateral} must refuse on the wire record`);
  }
  // The frozen 11-key record with its pinned digest still verifies.
  assert.equal(context.verifySessionAdmissionEvidence(H3_POS_1), true);
});

test("H3: instanceId binds host, launchName and agentUuid via deriveInstanceId with an optional sub-agent suffix", () => {
  // launchName slugification: deriveInstanceId lowercases and hyphenates.
  const slug = context.buildSessionAdmissionEvidence({
    attachmentRef: MATERIAL.attachmentId, transportEpoch: "epoch:20261030:0001", centralHost: "codex",
    agentUuid: IDENTITY.agentUuid, instanceId: "codex:pilot-h3:0123456789ab", launchName: "Pilot H3",
    admittedAt: MATERIAL.admittedAt, signedRequestId: MATERIAL.signedRequestId
  });
  assert.equal(slug.instanceId, "codex:pilot-h3:0123456789ab");
  assert.equal(context.verifySessionAdmissionEvidence(slug), true);
  assert.equal(deriveInstanceId({ host: "codex", label: "Pilot H3", uuid: IDENTITY.agentUuid }), "codex:pilot-h3:0123456789ab");
  // Sub-agent instance handles (`<parent>~<sub>`, r2.md §2.4) build and verify.
  const sub = context.buildSessionAdmissionEvidence({
    attachmentRef: MATERIAL.attachmentId, transportEpoch: "epoch:20261030:0001", centralHost: "codex",
    agentUuid: IDENTITY.agentUuid, instanceId: "codex:pilot-h3:0123456789ab~worker", launchName: "Pilot H3",
    admittedAt: MATERIAL.admittedAt, signedRequestId: MATERIAL.signedRequestId
  });
  assert.equal(context.verifySessionAdmissionEvidence(sub), true, "a sub-agent instanceId with the deriveInstanceId base must verify");
  // A mismatched base still refuses.
  assert.throws(() => build({ identity: { ...IDENTITY, instanceId: "codex:other-label:0123456789ab" } }), /instance/i);
  assert.throws(() => build({ identity: { ...IDENTITY, instanceId: "codex:pilot-h3:ffffffffffff" } }), /instance/i);
  assert.throws(() => build({ identity: { ...IDENTITY, instanceId: "codex:pilot-h3:0123456789ab~" } }), /instance/i);
  assert.throws(() => build({ identity: { ...IDENTITY, instanceId: "codex:pilot-h3:0123456789ab~a~" } }), /instance/i);
});

test("H3: the builder refuses malformed wire fields", () => {
  assert.throws(() => build({ attachmentId: "" }), /attachment/i);
  assert.throws(() => build({ centralHost: "not-a-central-host" }), /host/i);
  assert.throws(() => build({ identity: { ...IDENTITY, agentUuid: "not-a-uuid" } }), /agentUuid/i);
  assert.throws(() => build({ identity: { ...IDENTITY, launchName: "" } }), /launchName/i);
  assert.throws(() => build({ admittedAt: "yesterday" }), /admittedAt/i);
  assert.throws(() => build({ signedRequestId: "" }), /signedRequestId/i);
});

test("H3: muse is a supported lowercase central host on the wire and at capture", () => {
  const muse = context.buildSessionAdmissionEvidence({
    attachmentRef: MATERIAL.attachmentId, transportEpoch: "epoch:20261030:0001", centralHost: "muse",
    agentUuid: IDENTITY.agentUuid, instanceId: "muse:pilot-h3:0123456789ab", launchName: "pilot-h3",
    admittedAt: MATERIAL.admittedAt, signedRequestId: MATERIAL.signedRequestId
  });
  assert.equal(muse.centralHost, "muse");
  assert.equal(context.verifySessionAdmissionEvidence(muse), true, "a real muse session must not be refused as an unsupported host");
  const captured = context.captureCentralAttachment(MATERIAL.attachmentId, MATERIAL.attachmentId, { host: "muse" }, {});
  assert.equal(captured.host, "muse");
});

test("H3: the record carries no tenant, workspace, scope, purpose, audit or lateral transport authority", () => {
  const evidence = build();
  assert.deepEqual(Object.keys(evidence).sort(), [...EVIDENCE_KEYS].sort());
  for (const forbidden of ["tenant", "tenantRef", "tenant_id", "workspace", "workspaceRef", "workspaceId", "membership",
    "scope", "scopes", "purpose", "purposeRef", "audit", "auditId", "principal", "claims", "authority", "authorization",
    "transportMac", "channelBinding", "sessionId"]) {
    assert.equal(forbidden in evidence, false, `H3 must not carry ${forbidden}`);
  }
});

test("H3: sessionAdmissionEvidence binds the attachment material or refuses closed, never throws", () => {
  assert.equal(typeof attachmentExports.sessionAdmissionEvidence, "function", "H3 assembler must be exported from mcp-central-attachment.ts");
  const admitted = attachmentExports.sessionAdmissionEvidence(MATERIAL);
  assert.ok(admitted, "valid material must produce an admission");
  assert.equal(admitted.evidence.attachmentRef, MATERIAL.attachmentId);
  assert.equal(admitted.evidence.transportEpoch, "epoch:20261030:0001", "a fenced numeric epoch formats into the frozen epoch token from admittedAt");
  assert.equal(admitted.evidence.centralHost, MATERIAL.centralHost);
  assert.equal(admitted.evidence.agentUuid, IDENTITY.agentUuid);
  assert.equal(context.verifySessionAdmissionEvidence(admitted.evidence), true);
  // The lateral transport material rides ALONGSIDE the record, never on it.
  assert.deepEqual(admitted.transport, { transportMac: MATERIAL.transportMac, channelBinding: MATERIAL.channelBinding, sessionId: MATERIAL.sessionId });
  assert.equal("transportMac" in admitted.evidence, false);
  assert.equal("channelBinding" in admitted.evidence, false);
  assert.equal("sessionId" in admitted.evidence, false);
  // A preformed epoch token passes through unchanged.
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, transportEpoch: "epoch:20261030:0002" }).evidence.transportEpoch, "epoch:20261030:0002");
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, transportEpoch: "1" }).evidence.transportEpoch, "1");
  // Fail-closed: no identity correlation, unsupported channel, or malformed
  // material yields NO admission (undefined), never a partial record or a throw.
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, identity: undefined }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, identity: null }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, channelBinding: "bogus_verified" }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, transportMac: "zz" }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, sessionId: "" }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({ ...MATERIAL, transportEpoch: "one" }), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence(undefined), undefined);
  assert.equal(attachmentExports.sessionAdmissionEvidence({}), undefined);
});

test("H3: the frozen contract is re-exported from the public barrel", async () => {
  const barrel = await import("../dist/index.js");
  for (const name of ["buildSessionAdmissionEvidence", "verifySessionAdmissionEvidence", "sessionAdmissionEvidence"]) {
    assert.equal(typeof barrel[name], "function", `${name} must be re-exported from packages/h2a/src/index.ts`);
  }
  // Type-only re-exports have no runtime value; witness them in the built
  // declaration surface of the barrel.
  const declarations = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");
  for (const typeName of ["SessionAdmissionEvidenceV1", "MemoryHostResolverPort", "MemoryProviderRegistration",
    "CentralAdmission", "MemoryHostResolveInput"]) {
    assert.match(declarations, new RegExp(`\\b${typeName}\\b`), `${typeName} must be re-exported from packages/h2a/src/index.ts`);
  }
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

async function routeFixture(root, { captureFlags, captureEnv, plantBinding }) {
  const f = fixture(), lock = lockFor();
  if (plantBinding) {
    mkdirSync(join(root, "identity"), { recursive: true });
    writeFileSync(join(root, "identity", "bindings.jsonl"), JSON.stringify(plantBinding) + "\n");
  }
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
    { host: "codex", ...captureFlags, "registry-lock-digest": bridgeLockDigest(lock) }, captureEnv);
  const serving = bridgeCentralMcpStdio({ runtimeBase, stdin: input, stdout: output, signal: controller.signal, workspaceRoot: root, attachment, registryTools: tools });
  const request = (id, method, params) => new Promise(resolve => {
    const timer = setInterval(() => {
      const frame = frames.find(frame => frame.id === id);
      if (frame) { clearInterval(timer); resolve(frame); }
    }, 5);
    input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const done = async () => { controller.abort(); input.end(); await serving; output.destroy(); await server.stop(); };
  return { f, seen, request, done };
}

test("H3: the authenticated central route emits evidence bound to the verified request MAC, epoch and session", { timeout: 15000 }, async () => scratch(async root => {
  const session = await routeFixture(root, {
    captureFlags: { name: "pilot-h3" },
    captureEnv: { CLAUDE_CODE_SESSION_ID: "conv-h3-route-1" },
    plantBinding: { host: "codex", providerSessionId: "conv-h3-route-1", workspaceId: "unused-by-lookup",
      instance: "codex:pilot-h3:0123456789ab", agentUuid: "01234567-89ab-4cde-8f01-234567890123", at: "2026-10-30T00:00:00.000Z" }
  });
  try {
    const init = await session.request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "h3-route", version: "1" } });
    assert.ok(init.result, `initialize must succeed: ${JSON.stringify(init).slice(0, 200)}`);
    const call = await session.request(2, "tools/call", { name: MEMORY_NAMES[0], arguments: { idempotency_key: "h3-route-1" } });
    assert.equal(call.result?.isError, false, `memory call must succeed: ${JSON.stringify(call).slice(0, 300)}`);
    assert.equal(session.f.calls.length, 1, "exactly one producer dispatch");
    assert.equal(session.seen.length, 1, "the host resolver must be consulted exactly once");
    const input = session.seen[0];
    const evidence = input.evidence;
    assert.ok(evidence, "the resolver input must carry H3 evidence");
    assert.equal(context.verifySessionAdmissionEvidence(evidence), true);
    assert.match(evidence.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(evidence.agentUuid, "01234567-89ab-4cde-8f01-234567890123");
    assert.equal(evidence.instanceId, "codex:pilot-h3:0123456789ab");
    assert.equal(evidence.launchName, "pilot-h3");
    assert.equal(evidence.centralHost, "codex");
    assert.match(evidence.transportEpoch, /^epoch:\d{8}:\d{4}$/, "the evidence must bind the fenced transport epoch in the frozen token form");
    assert.ok(evidence.attachmentRef, "the evidence must bind the verified attachment id");
    assert.deepEqual(Object.keys(evidence).sort(), [...EVIDENCE_KEYS].sort());
    // The lateral transport material reaches the resolver alongside the record.
    assert.match(input.transport.transportMac, /^[0-9a-f]{64}$/, "the verified per-request transport MAC must ride the lateral material");
    assert.equal(input.transport.channelBinding, "stdio_host_managed_verified");
    assert.ok(input.transport.sessionId, "the MCP session id must ride the lateral material");
    assert.equal(call.result.structuredContent.auditId, "mesh-issued-audit");
  } finally { await session.done(); }
}));

test("H3: a real h2a session with no --name flag still admits through its live identity binding", { timeout: 15000 }, async () => scratch(async root => {
  // Plant a REAL identity exactly the way a live session does (keyring,
  // registration with launch name, binding keyed on the derived stability
  // unit) — no flags.name, no CLAUDE_CODE_SESSION_ID on the capture.
  const live = resolveLiveIdentity({ root, cwd: root, host: "codex", name: "r3-live" });
  assert.ok(live.instance, "the live identity must resolve");
  const session = await routeFixture(root, {
    captureFlags: {},
    captureEnv: {},
    plantBinding: undefined
  });
  try {
    const init = await session.request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "h3-live", version: "1" } });
    assert.ok(init.result, `initialize must succeed: ${JSON.stringify(init).slice(0, 200)}`);
    const call = await session.request(2, "tools/call", { name: MEMORY_NAMES[0], arguments: { idempotency_key: "h3-live-1" } });
    assert.equal(call.result?.isError, false, `a real session without --name must admit, not refuse: ${JSON.stringify(call).slice(0, 300)}`);
    assert.equal(session.seen.length, 1);
    assert.equal(session.seen[0].evidence.instanceId, live.instance, "the admitted identity must be the live session instance");
    assert.ok(session.seen[0].evidence.agentUuid.replace(/-/g, "").startsWith(live.instance.split(":")[2]), "the agentUuid must be the instance uuid12 owner");
    assert.equal(session.seen[0].evidence.launchName, "r3-live", "the launch name falls back to the registration's name");
    assert.equal(context.verifySessionAdmissionEvidence(session.seen[0].evidence), true);
  } finally { await session.done(); }
}));

test("H3: concurrent admitted calls each bind their own verified request, never a shared stash", { timeout: 15000 }, async () => scratch(async root => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const session = await routeFixture(root, {
    captureFlags: { name: "pilot-h3" },
    captureEnv: { CLAUDE_CODE_SESSION_ID: "conv-h3-route-1" },
    plantBinding: { host: "codex", providerSessionId: "conv-h3-route-1", workspaceId: "unused-by-lookup",
      instance: "codex:pilot-h3:0123456789ab", agentUuid: "01234567-89ab-4cde-8f01-234567890123", at: "2026-10-30T00:00:00.000Z" }
  });
  // Hold each resolver call until BOTH requests are mid-dispatch (or a short
  // fallback elapses, in case the transport serializes the two requests), so
  // the two admitted requests overlap on the same attachment.
  let arrived = 0;
  setTimeout(release, 2000);
  session.f.memory.resolver = { resolveContext: async input => {
    session.seen.push(input);
    arrived++;
    if (arrived === 2) release();
    await gate;
    return { ok: true, context: { route: true }, allowedTools: [...MEMORY_NAMES], policyRevision: "route-2" };
  } };
  try {
    const init = await session.request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "h3-iso", version: "1" } });
    assert.ok(init.result, `initialize must succeed: ${JSON.stringify(init).slice(0, 200)}`);
    const pending = [session.request(2, "tools/call", { name: MEMORY_NAMES[0], arguments: { idempotency_key: "h3-iso-a" } }),
      session.request(3, "tools/call", { name: MEMORY_NAMES[1], arguments: { idempotency_key: "h3-iso-b" } })];
    const [first, second] = await Promise.all(pending);
    assert.equal(first.result?.isError, false, `call A must succeed: ${JSON.stringify(first).slice(0, 200)}`);
    assert.equal(second.result?.isError, false, `call B must succeed: ${JSON.stringify(second).slice(0, 200)}`);
    assert.equal(session.seen.length, 2, "both concurrent calls must reach the resolver");
    const uids = session.seen.map(input => input.evidence.signedRequestId);
    const macs = session.seen.map(input => input.transport.transportMac);
    assert.notEqual(uids[0], uids[1], "each call must bind its own signed request id");
    assert.notEqual(macs[0], macs[1], "each call must bind its own verified transport MAC");
    for (const input of session.seen) assert.equal(context.verifySessionAdmissionEvidence(input.evidence), true);
  } finally { await session.done(); }
}));
