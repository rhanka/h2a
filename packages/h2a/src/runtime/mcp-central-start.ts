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
  for (const key of ["PATH", "HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "REMOTE_CLI_CONFIG_HOME", "TMPDIR", "LANG", "LC_ALL"]) if (env[key] !== undefined) filtered[key] = env[key];
  return filtered;
}
export async function ensureCentralForShim(defaultEnabled = false, paths: CentralMcpPathsOptions = {}): Promise<CentralMcpMarker> {
  if (!centralRoutingEnabled(process.env, defaultEnabled)) throw new Error("central MCP is disabled; the live shim remains open until its host disconnects");
  if (existsSync(centralPausePath(paths))) throw new Error("central MCP was stopped by the operator; resume explicitly with mcp-central-serve");
  const root = canonicalCentralRoot();
  const healthy = async (): Promise<CentralMcpMarker | undefined> => {
    const marker = readCentralMcpMarker(paths);
    if (!marker) return undefined;
    if (marker.root !== root || marker.protocol !== 2) throw new Error("central MCP root/protocol is incompatible with this attachment");
    try {
      const response = await centralHttpRequest(new URL("/_h2a-central/ping", marker.endpoint), { signal: AbortSignal.timeout(1500) });
      if (!response.ok) { await response.text(); return undefined; }
      if ((await response.json() as { generation?: string }).generation !== marker.generation) return undefined;
      return readCentralClientMarker(centralMcpMarkerPath(paths));
    } catch { return undefined; } // Foreground election remains authoritative about ambiguity.
  };
  const existing = await healthy();
  if (existing) return existing;
  const neutral = process.env.HOME ?? homedir();
  const logDir = join(process.env.XDG_CACHE_HOME ?? join(neutral, ".cache"), "h2a");
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const fd = openSync(join(logDir, "mcp-central.log"), "a", 0o600);
  let failure: Error | undefined;
  try {
    const endpoint = process.env.H2A_MCP_CENTRAL_ENDPOINT ?? centralSettings().endpoint;
    const args = [
      "--max-old-space-size=384",
      fileURLToPath(new URL("../bin.js", import.meta.url)),
      "mcp-central-serve",
      "--root", root,
      "--auto-start",
      ...(paths.runtimeBase ? ["--runtime-base", paths.runtimeBase] : [])
    ];
    const child = spawn(process.execPath, args, {
      detached: true, cwd: neutral, stdio: ["ignore", fd, fd], env: { ...centralDaemonEnvironment(), H2A_MCP_CENTRAL: "1", ...(endpoint ? { H2A_MCP_CENTRAL_ENDPOINT: endpoint } : {}) }
    });
    child.once("error", error => { failure = error; });
    child.unref();
  } finally { closeSync(fd); }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (existsSync(centralPausePath(paths))) throw new Error("central MCP was stopped by the operator");
    const current = await healthy();
    if (current) return current;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("central MCP startup deadline exceeded; no automatic stdio fallback");
}
