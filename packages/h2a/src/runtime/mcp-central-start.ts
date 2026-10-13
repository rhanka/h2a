import { centralHttpRequest } from "./mcp-central-http.js";
/** Lightweight auto-start. Spawn this installation with no conversation environment. */
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { centralMcpMarkerPath, readCentralClientMarker, readCentralMcpMarker, type CentralMcpMarker, type CentralMcpPathsOptions } from "./mcp-central-discovery.js";
import { centralPausePath } from "./mcp-central-operator.js";
import { canonicalCentralRoot, centralRoutingEnabled, centralSettings } from "./mcp-central-policy.js";

export function centralDaemonEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const filtered: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "REMOTE_CLI_CONFIG_HOME", "TMPDIR", "LANG", "LC_ALL", "H2A_MCP_AUTHORITY"]) if (env[key] !== undefined) filtered[key] = env[key];
  return filtered;
}
export async function ensureCentralForRoot(root: string, paths: CentralMcpPathsOptions = {}): Promise<CentralMcpMarker> {
  const { launchCentral } = await import("./handover/launch.js");
  const { installationForEntry, physicalPrefixForEntry } = await import("./handover/selection.js");
  const { markerDirectory } = await import("./mcp-central-discovery.js");
  const entry = fileURLToPath(new URL("../bin.js", import.meta.url));
  const installation = installationForEntry(entry);
  const endpoint = process.env.H2A_MCP_CENTRAL_ENDPOINT ?? centralSettings().endpoint;
  const result = await launchCentral({ directory: markerDirectory(paths), root, installation,
    physicalPrefix: physicalPrefixForEntry(entry) ?? fileURLToPath(new URL("../../", import.meta.url)), fallbackEntry: entry,
    environment: { ...centralDaemonEnvironment(), H2A_MCP_CENTRAL: "1", ...(endpoint ? { H2A_MCP_CENTRAL_ENDPOINT: endpoint } : {}) } });
  return result.marker;
}
export async function ensureCentralForShim(defaultEnabled = false, paths: CentralMcpPathsOptions = {}): Promise<CentralMcpMarker> {
  if (!centralRoutingEnabled(process.env, defaultEnabled)) throw new Error("central MCP is disabled; the live shim remains open until its host disconnects");
  return ensureCentralForRoot(canonicalCentralRoot(), paths);
}
