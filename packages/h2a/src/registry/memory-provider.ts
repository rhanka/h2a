/**
 * Optional in-process Engram contract. No dependency, listener, backend or
 * synthetic authority is provisioned here. HOST-BINDINGS.md is under review:
 * the host owns all nine bindings behind this explicit refusing port.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RegistryError, validateRegistryPackageManifest, verifyAssetClosure, type RegistryEntry } from "./descriptors.js";

export const MEMORY_PROVIDER_ID = "sentropic.engram.memory";
export const MEMORY_TOOL_NAMES = ["search", "get", "capture", "request_admission", "withdraw", "forget"].map(name => `engram_memory_${name}`);

export interface MemoryToolDescriptor {
  name: string;
  description?: string;
  inputSchema: unknown;
  outputSchema: unknown;
  annotations: Record<string, unknown>;
  _meta: Record<string, unknown>;
}
export interface EngramMemoryMcpServer {
  listTools(): Promise<{ tools: MemoryToolDescriptor[] }>;
  callTool(name: string, args: unknown, context: unknown,
    envelope?: { idempotencyKey?: string; elicitationRef?: string }, signal?: AbortSignal): Promise<unknown>;
}
export interface EngramMemoryModule {
  createEngramMemoryMcpServerV1(provider: unknown): Promise<EngramMemoryMcpServer>;
}
/** Trusted host composition only; never constructed from CLI/tool arguments. */
export interface MemoryHostPort {
  createProvider(module: EngramMemoryModule, configuration: Record<string, unknown>, attachment?: unknown): Promise<unknown>;
  resolveContext(tool: string, args: Record<string, unknown>, attachment?: unknown): Promise<unknown>;
}
export interface MemoryProviderRegistration {
  entry: RegistryEntry;
  host?: MemoryHostPort;
  /** Dependency loader seam; contract doubles belong exclusively in tests. */
  load?: () => Promise<EngramMemoryModule>;
}

export function readInstalledMemoryEntry(): RegistryEntry {
  let root: string;
  try {
    // The producer exposes this subpath under the ESM import condition only.
    const manifestPath = fileURLToPath(import.meta.resolve("@sentropic/engram/registry/manifest"));
    root = dirname(dirname(dirname(manifestPath)));
  } catch {
    throw new RegistryError("missing_binding", "@sentropic/engram registry package is absent; memory is not configured");
  }
  const manifest = validateRegistryPackageManifest(JSON.parse(readFileSync(join(root, "registry/entries.v1.json"), "utf8")));
  const entry = manifest.entries.find(entry => entry.id === MEMORY_PROVIDER_ID);
  if (!entry) throw new RegistryError("invalid_entry", "@sentropic/engram has no memory registry entry");
  verifyAssetClosure(entry, root, path => readFileSync(join(root, path)));
  return entry;
}

export async function activateMemoryProvider(registration: MemoryProviderRegistration | undefined, configuration: Record<string, unknown>, attachment?: unknown) {
  const host = registration?.host;
  if (!host || typeof host.createProvider !== "function" || typeof host.resolveContext !== "function") {
    throw new RegistryError("missing_binding", "Engram memory host bindings are not configured (invocation, authorization, domainPolicy, engine, mutationRecovery, confirmation, audit, pagination, lifecycle)");
  }
  let module: EngramMemoryModule;
  try {
    const specifier: string = "@sentropic/engram/mcp-memory";
    module = await (registration.load ? registration.load() : import(specifier)) as EngramMemoryModule;
  } catch {
    throw new RegistryError("missing_binding", "@sentropic/engram/mcp-memory is absent or unavailable; memory is not configured");
  }
  if (typeof module.createEngramMemoryMcpServerV1 !== "function") {
    throw new RegistryError("invalid_entry", "@sentropic/engram/mcp-memory has no createEngramMemoryMcpServerV1 factory");
  }
  const provider = await host.createProvider(module, configuration, attachment);
  const server = await module.createEngramMemoryMcpServerV1(provider);
  const { tools } = await server.listTools();
  if (tools.length !== MEMORY_TOOL_NAMES.length ||
      new Set(tools.map(tool => tool.name)).size !== tools.length ||
      tools.some(tool => !MEMORY_TOOL_NAMES.includes(tool.name))) {
    throw new RegistryError("invalid_entry", "Engram memory discovery does not match its six-tool contract");
  }
  return {
    tools,
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      if (!MEMORY_TOOL_NAMES.includes(name)) throw new Error("unknown_tool");
      let context: unknown;
      try { context = await host.resolveContext(name, args, attachment); }
      catch { throw new RegistryError("missing_binding", "Trusted invocation context unavailable"); }
      if (!context || typeof context !== "object") throw new RegistryError("missing_binding", "Trusted invocation context unavailable");
      const binding = (context as { memory?: { binding?: { elicitation_ref?: unknown } } }).memory?.binding;
      // Direct dispatch requires the envelope explicitly. Confirmation comes
      // exclusively from trusted host context, never from tool arguments.
      return server.callTool(name, args, context, {
        ...(typeof args.idempotency_key === "string" ? { idempotencyKey: args.idempotency_key } : {}),
        ...(typeof binding?.elicitation_ref === "string" ? { elicitationRef: binding.elicitation_ref } : {})
      });
    }
  };
}
