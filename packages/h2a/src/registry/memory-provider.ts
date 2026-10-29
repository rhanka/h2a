/** Cluster-mesh owns memory composition, storage and all host bindings. */
import type { McpRegistryBuiltin } from "@sentropic/cluster-mesh/mcp/registry";
import type { RegistryEntry } from "./descriptors.js";
import { RegistryError } from "./descriptors.js";

export const MEMORY_PROVIDER_ID = "sentropic.engram.memory";
export const MEMORY_TOOL_NAMES = ["search", "get", "capture", "request_admission", "withdraw", "forget"].map(name => `engram_memory_${name}`);

/** A qualified mesh builtin supplied by its host, just like mcp/artifacts. */
export interface MemoryProviderRegistration {
  entry: RegistryEntry;
  builtin: McpRegistryBuiltin;
}

export function missingMemoryBuiltin(): never {
  // The published mesh facade takes explicit builtins; it does not discover
  // or construct them from an Engram package or from CLI configuration.
  throw new RegistryError("missing_binding", "installed @sentropic/cluster-mesh does not supply a configured sentropic.engram.memory builtin; install and bind the cluster-mesh memory provider before selecting memory");
}
