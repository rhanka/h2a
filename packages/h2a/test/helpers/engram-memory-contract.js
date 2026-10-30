// Test-only cluster-mesh McpRegistryBuiltin, following mcp/artifacts.
// No Engram factory, host bindings, database or memory engine lives in h2a.
//
// H2A-DISP-354 shape: the double mirrors the producer's post-selection
// dispatch seam (`runtime().server.callTool(name, args, ctx, envelope?,
// signal?)`, consumer-context §1) and the runtime discovery surface
// (annotations + `_meta['sentropic.engram/memory']`, consumer-context §3).
// The adapter deliberately refuses dispatch: after DISP-354 the daemon calls
// the runtime seam, never the adapter. The registration carries a default
// permissive resolver double (a contract host that HAS resolved admission);
// negative-vector tests replace or drop it.
import { sessionAdmissionEvidence } from "../../dist/runtime/mcp-central-attachment.js";
export const MEMORY_ID = "sentropic.engram.memory";
export const MEMORY_NAMES = ["search", "get", "capture", "request_admission", "withdraw", "forget"].map(x => "engram_memory_" + x);
export const configuration = { mode: "embedded-local", hostBindingRef: "memory-pilot" };
// Valid H3 admission evidence for contract tests that dispatch through the
// daemon seam directly (no authenticated central route to compose it).
export function admissionEvidence() {
  return sessionAdmissionEvidence({
    attachmentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    transportMac: "cd".repeat(32),
    transportEpoch: "1",
    centralHost: "codex",
    channelBinding: "in_process_verified",
    sessionId: "session-contract-l2",
    signedRequestId: "req-contract-l2-1",
    identity: { agentUuid: "01234567-89ab-4cde-8f01-234567890123", instanceId: "codex:pilot-h3:0123456789ab", launchName: "pilot-h3" },
    admittedAt: "2026-10-30T00:00:00.000Z"
  });
}
export const entry = {
  format: "sentropic.registry-entry/v1", contractVersion: "1.1.4", kind: "mcp",
  id: MEMORY_ID, name: "Engram Memory", description: "Test-only memory descriptor.",
  entryVersion: "1.0.0", publisher: { packageName: "@sentropic/engram", packageVersion: "0.22.0" },
  compatibility: { entryContract: "1.1.4", packages: [], schemaProfiles: ["sentropic.engram.memory-wire/v1"], requiredHostFeatures: [], optionalHostFeatures: [] },
  parameters: { schemaVersion: "1.0.0", defaults: { mode: "embedded-local" }, schema: {
    type: "object", additionalProperties: false, required: ["mode", "hostBindingRef"],
    properties: { mode: { const: "embedded-local" }, hostBindingRef: { type: "string", minLength: 1, maxLength: 128, pattern: "^[a-z0-9][a-z0-9._-]*$" } }
  } },
  bindings: [],
  assets: [{ role: "manifest", path: "registry/manifest.memory.json", mediaType: "application/json", sha256: "0".repeat(64) }],
  mcp: { manifestAsset: "registry/manifest.memory.json", connectorIds: ["engram-memory"],
    transportProfiles: [{ id: "sentropic.engram.memory-wire/v1", mode: "in-process", protocolVersions: ["2025-06-18"], requiredHostFeatures: [] }],
    protocolVersions: ["2025-06-18"] }
};
export function fixture() {
  const calls = [];
  let loads = 0, refused = false, served, gate;
  const tools = MEMORY_NAMES.map(name => ({ kind: "tool", name, description: `Engram memory ${name}.`,
    annotations: { title: name, readOnlyHint: /_(search|get)$/.test(name) },
    _meta: { "sentropic.engram/memory": { wireProfile: "sentropic.engram.memory-wire/v1", tool: name, redactionClass: "high" } },
    inputSchema: { type: "object" }, outputSchema: { type: "object" },
    requiredScopes: ["memory:invoke"], requiredClaims: [], redactionClass: "high",
    mutability: /_(search|get)$/.test(name) ? "read-only" : "state-transition",
    mutatesExternalSystem: !/_(search|get)$/.test(name), idempotency: { required: false },
    gates: { requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: false }
  }));
  const manifest = { providerId: MEMORY_ID, appId: "engram", version: entry.entryVersion,
    displayName: "Engram Memory", tools, resources: [], prompts: [],
    authz: { requiredClaims: [], scopes: ["memory:invoke"], tenantResolution: "custom-resolver" }, audit: { eventKinds: [] }, durability: {} };
  const parameterSchema = { properties: { mode: { type: "string", enum: ["embedded-local"] }, hostBindingRef: { type: "string", minLength: 1, maxLength: 128 } }, required: ["mode", "hostBindingRef"] };
  const definition = {
    manifest, parameterSchema, requiredPorts: [],
    provenance: { approvalRef: "test-only", revision: "1", manifestDigest: "", reviewedBy: ["test"] },
    handlers: Object.fromEntries(tools.map(t => [t.name, { handlerId: t.name, capabilityRef: t.name, configSchema: { type: "object" } }])),
    toolValues: Object.fromEntries(tools.map(t => [t.name, { handlerId: t.name, values: {} }])),
    adapter: { providerId: MEMORY_ID, manifest, listCapabilities: async () => tools,
      // Post-DISP-354 the daemon dispatches through the runtime seam; an
      // adapter dispatch is a contract violation and must fail loudly.
      invokeTool: async () => { throw new Error("memory dispatch must use the runtime server seam, not the adapter"); }
    }
  };
  const builtin = { providerId: MEMORY_ID, version: entry.entryVersion, capabilities: [...MEMORY_NAMES], parameterSchema,
    load: async () => { loads++; return definition; },
    runtime: () => ({
      close: async () => {},
      server: {
        // Producer dispatch seam: (name, args, ctx, envelope?, signal?) → CallToolResult.
        callTool: async (name, args, ctx, envelope, signal) => {
          if (refused) throw new Error("builtin authorization refused");
          if (!MEMORY_NAMES.includes(name)) throw new Error("unknown tool");
          // Record on entry (before the gate): the call has reached the producer.
          calls.push({ capabilityRef: name, input: args, ctx, ...(envelope && Object.keys(envelope).length ? { envelope } : {}), ...(signal ? { signal } : {}) });
          if (gate) await gate.promise;
          return served ?? {
            isError: false,
            structuredContent: { ok: true, output: { schema_version: 1, value: { status: "committed_pending" } }, auditId: "mesh-issued-audit", redactionClass: "high" },
            content: [{ type: "text", text: `Engram memory ${name} committed.` }]
          };
        }
      }
    }) };
  const memory = {
    entry, builtin,
    // Default permissive host-resolver double (contract host with resolved
    // admission); negative tests replace or drop this.
    resolver: { resolveContext: async () => ({ ok: true, context: { fixture: "engram-memory-contract" }, allowedTools: [...MEMORY_NAMES], policyRevision: "contract-double-1" }) }
  };
  return {
    memory, definition, calls, loads: () => loads, refuse: () => { refused = true; },
    serve: result => { served = result; },
    hold: () => { let resolve; gate = { promise: new Promise(r => { resolve = r; }), resolve }; },
    release: () => { gate?.resolve(); gate = undefined; }
  };
}
