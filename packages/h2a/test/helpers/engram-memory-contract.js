// Test-only cluster-mesh McpRegistryBuiltin, following mcp/artifacts.
// No Engram factory, host bindings, database or memory engine lives in h2a.
export const MEMORY_ID = "sentropic.engram.memory";
export const MEMORY_NAMES = ["search", "get", "capture", "request_admission", "withdraw", "forget"].map(x => "engram_memory_" + x);
export const configuration = { mode: "embedded-local", hostBindingRef: "memory-pilot" };
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
  let loads = 0, refused = false;
  const tools = MEMORY_NAMES.map(name => ({ kind: "tool", name, description: name,
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
      invokeTool: async request => {
        if (refused) throw new Error("builtin authorization refused");
        if (!MEMORY_NAMES.includes(request.capabilityRef)) throw new Error("unknown tool");
        calls.push(request);
        const transport = { isError: false, structuredContent: { auditId: "mesh-issued-audit" }, content: [{ type: "text", text: request.capabilityRef }] };
        return { ok: true, output: transport, auditId: "mesh-issued-audit", redactionClass: "high" };
      }
    }
  };
  const builtin = { providerId: MEMORY_ID, version: entry.entryVersion, capabilities: [...MEMORY_NAMES], parameterSchema,
    load: async () => { loads++; return definition; } };
  return { memory: { entry, builtin }, definition, calls, loads: () => loads, refuse: () => { refused = true; } };
}
