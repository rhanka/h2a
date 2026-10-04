/** Minimal read-only routing policy; shared by initial launch and live recovery. */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readCentralMcpMarker } from "./mcp-central-discovery.js";

export function centralConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.REMOTE_CLI_CONFIG_HOME ?? env.HOME ?? homedir();
  const parent = join(home, ".config", "sentropic");
  return join(parent, existsSync(join(parent, "h2a")) ? "h2a" : "remote-cli", "config.json");
}
export function centralSettings(env: NodeJS.ProcessEnv = process.env): { enabled?: boolean; endpoint?: string } {
  const path = centralConfigPath(env);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { h2a?: { central?: { enabled?: boolean; endpoint?: string } } };
    return parsed.h2a?.central ?? {};
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error(`cannot read central configuration ${path}: ${(error as Error).message}`); }
}
export function canonicalCentralRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.H2A_ROOT || join(env.HOME ?? homedir(), "h2a-workspace", ".h2a"));
}
export function centralRoutingEnabled(env: NodeJS.ProcessEnv = process.env, defaultEnabled = false): boolean {
  const setting = centralSettings(env).enabled;
  if (env.H2A_MCP_CENTRAL === "0" || env.H2A_MCP_CENTRAL === "false" || setting === false) return false;
  return setting === true || env.H2A_MCP_CENTRAL === "1" || env.H2A_MCP_CENTRAL === "true" || defaultEnabled;
}
export function shouldUseCentralMcp(flags: Record<string, string>, env: NodeJS.ProcessEnv = process.env, defaultEnabled = false): boolean {
  if (process.platform !== "linux" || flags.host !== "claude" || flags.instance || flags.backend === "cluster-mesh" || env.H2A_MESSAGE_BACKEND === "cluster-mesh") return false;
  if (!env.CLAUDE_CODE_SESSION_ID?.trim() || !centralRoutingEnabled(env, defaultEnabled)) return false;
  const root = canonicalCentralRoot(env);
  if (flags.root && resolve(flags.root) !== root) return false;
  const marker = readCentralMcpMarker();
  // Unsupported legacy protocol/root routes deterministically to stdio before initialize.
  if (marker && (marker.protocol !== 2 || marker.root !== root)) return false;
  return true;
}
