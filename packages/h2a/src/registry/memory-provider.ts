/** Cluster-mesh owns memory composition, storage and all host bindings. */
import type { McpRegistryBuiltin } from "@sentropic/cluster-mesh/mcp/registry";
import type { RegistryEntry } from "./descriptors.js";
import { RegistryError } from "./descriptors.js";

export const MEMORY_PROVIDER_ID = "sentropic.engram.memory";
export const MEMORY_TOOL_NAMES = ["search", "get", "capture", "request_admission", "withdraw", "forget"].map(name => `engram_memory_${name}`);

/** A qualified mesh builtin supplied by its host, just like mcp/artifacts. */
export interface MemoryProviderRegistration {
  entry: RegistryEntry;
  /**
   * The producer builtin additionally exposes a post-selection runtime
   * handle (`runtime()` in sentropic#844 `packages/cluster-mesh/src/
   * integrations/mcp/memory.ts:13-16`). The mesh host closes it before
   * closing its pool; h2a attachments never own it, so this composition
   * layer only types the handle — it never opens or closes one.
   */
  builtin: McpRegistryBuiltin & { runtime?: () => { close(): Promise<void> } | undefined };
}

export function missingMemoryBuiltin(): never {
  // The published mesh facade takes explicit builtins; it does not discover
  // or construct them from an Engram package or from CLI configuration.
  throw new RegistryError("missing_binding", "installed @sentropic/cluster-mesh does not supply a configured sentropic.engram.memory builtin; install and bind the cluster-mesh memory provider before selecting memory");
}

/**
 * Resolve the memory registration for this host (round 3 seam).
 *
 * A host-supplied registration (qualified operator wiring, tests) wins
 * after a light identity check; the deeper identity/version/surface checks
 * stay in the compile path (`sentropic-daemon.ts`), so a forged registration
 * still refuses atomically before advertisement. Without a supplied
 * registration there is no other acquisition point in the installed mesh
 * generation: the configured builtin is assembled by the mesh host from
 * `EngramMemoryDefinitionOptions` (storage neutral handle, scope binding,
 * host bindings, provenance — sentropic#844 `memory-definition.ts:8-19`),
 * which h2a neither holds nor fabricates (fabricating it was the rejected
 * pilot shortcut). Until sentropic#844 publishes the configured builtin,
 * this refuses with `missing_binding`.
 */
export async function resolveHostMemoryRegistration(
  provided?: MemoryProviderRegistration
): Promise<MemoryProviderRegistration> {
  if (provided?.builtin && provided.builtin.providerId === MEMORY_PROVIDER_ID) return provided;
  return missingMemoryBuiltin();
}
