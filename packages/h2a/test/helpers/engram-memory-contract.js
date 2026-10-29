// Test-only double of the producer's asynchronous in-process MCP factory.
// MCP-LAUNCH-CONTRACT.md §§2,3,6; no store or reference host bindings.
export const MEMORY_ID = "sentropic.engram.memory";
export const MEMORY_NAMES = ["search", "get", "capture", "request_admission", "withdraw", "forget"].map(x => "engram_memory_" + x);
export const configuration = { mode: "embedded-local", hostBindingRef: "memory-pilot" };
const bindings = ["invocation", "authorization", "domainPolicy", "engine", "mutationRecovery", "confirmation", "audit", "pagination", "lifecycle"];
export const entry = {
  format: "sentropic.registry-entry/v1", contractVersion: "1.1.4", kind: "mcp",
  id: MEMORY_ID, name: "Engram Memory", description: "Test-only memory descriptor.",
  entryVersion: "1.0.0", publisher: { packageName: "@sentropic/engram", packageVersion: "0.22.0" },
  compatibility: { entryContract: "1.1.4", packages: [], schemaProfiles: ["sentropic.engram.memory-wire/v1"], requiredHostFeatures: bindings, optionalHostFeatures: [] },
  parameters: { schemaVersion: "1.0.0", defaults: { mode: "embedded-local" }, schema: {
    type: "object", additionalProperties: false, required: ["mode", "hostBindingRef"],
    properties: { mode: { const: "embedded-local" }, hostBindingRef: { type: "string", minLength: 1, maxLength: 128, pattern: "^[a-z0-9][a-z0-9._-]*$" } }
  } },
  bindings: bindings.map(key => ({ key, contract: "TestOnly" + key, required: true })),
  assets: [{ role: "manifest", path: "registry/manifest.memory.json", mediaType: "application/json", sha256: "0".repeat(64) }],
  mcp: { manifestAsset: "registry/manifest.memory.json", connectorIds: ["engram-memory"],
    transportProfiles: [{ id: "sentropic.engram.memory-wire/v1", mode: "in-process", protocolVersions: ["2025-06-18"], requiredHostFeatures: bindings }],
    protocolVersions: ["2025-06-18"] }
};
export function fixture() {
  const calls = [], activations = [], attachmentContexts = [];
  const context = Object.freeze({ memory: { binding: { provider_id: MEMORY_ID, connector_id: "engram-memory", selected_source_id: "mcp:engram-memory", elicitation_ref: "host-confirmation" } } });
  const provider = Object.freeze({ fixture: true });
  const descriptors = MEMORY_NAMES.map(name => ({ name, description: name,
    inputSchema: { type: "object" }, outputSchema: { type: "object" },
    annotations: { readOnlyHint: /_(search|get)$/.test(name), destructiveHint: /_forget$/.test(name), idempotentHint: false, openWorldHint: false },
    _meta: { "sentropic.engram/memory": { providerId: MEMORY_ID, connectorId: "engram-memory", sourceId: "mcp:engram-memory",
      requiredScopes: ["memory:invoke"], requiredClaims: [], redactionClass: "high",
      mutability: /_(search|get)$/.test(name) ? "read-only" : "state-transition", mutatesExternalSystem: !/_(search|get)$/.test(name),
      idempotency: { required: !/_(search|get)$/.test(name) }, gates: { requiresElicitation: /_(forget|withdraw)$/.test(name), requiresHumanConfirmation: /_(forget|withdraw)$/.test(name), requiresPrincipalGate: false } } }
  }));
  let loads = 0;
  let refuseContext = false;
  const module = { async createEngramMemoryMcpServerV1(p) {
    if (p !== provider) throw new Error("unexpected provider");
    activations.push(p);
    return {
      async listTools() { return { tools: descriptors }; },
      async callTool(name, args, ctx, envelope, signal) {
        if (!MEMORY_NAMES.includes(name)) throw new Error("unknown tool");
        if (ctx !== context) throw new Error("Trusted invocation context unavailable");
        calls.push({ name, args, ctx, envelope, signal });
        const structuredContent = { ok: true, output: { schema_version: 1, value: name }, auditId: "host-issued-audit", redactionClass: "high" };
        return { isError: false, structuredContent, content: [{ type: "text", text: JSON.stringify(structuredContent) }] };
      }
    };
  } };
  const memory = { entry, load: async () => { loads++; return module; }, host: {
    async createProvider(actual, config) {
      if (actual !== module || config.hostBindingRef !== "memory-pilot") throw new Error("not configured");
      return provider;
    },
    async resolveContext(_tool, _args, attachment) {
      attachmentContexts.push(attachment);
      if (refuseContext) throw new Error("private tenant details");
      return context;
    }
  } };
  return { memory, descriptors, context, calls, activations, attachmentContexts, loads: () => loads, refuseContext: () => { refuseContext = true; } };
}
