/**
 * Registry-bridge shared-central attachment admission (LOT-3): the single
 * decision point for whether a bridge serve may attach to central. Requires
 * qualified Claude (linux host, explicit claude, no sidecar instance, live
 * session) AND an enabled central with a local protocol-2 marker pinned to
 * the served root. Instance (sidecar) requests are never admitted here: they
 * stay on stdio and the lane policy admits them per connection, if at all.
 * Anything else is refused by the caller — never substituted.
 */
export interface BridgeCentralAdmissionDiagnosis {
  admitted: boolean;
  condition?: 1 | 2 | 3 | 4;
  markerMissing?: boolean;
  paused?: boolean;
  reason?: string;
  remediation?: string;
}

function quoteShellPath(p: string): string {
  return /[^A-Za-z0-9_./:@=-]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p;
}

export function diagnoseBridgeCentralAttachment(
  flags: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): BridgeCentralAdmissionDiagnosis {
  const expectedRoot = canonicalCentralRoot(env);
  const runtimeBaseFlag = flags["runtime-base"] ? ` --runtime-base ${quoteShellPath(flags["runtime-base"])}` : "";
  const startCmd = `h2a mcp-central-serve --root ${quoteShellPath(expectedRoot)}${runtimeBaseFlag}`;
  const statusCmd = `h2a central status${runtimeBaseFlag}`;
  const startRemedy = `start or inspect central with: ${startCmd} (or ${statusCmd})`;
  if (process.platform !== "linux") {
    return {
      admitted: false,
      condition: 1,
      reason: `condition 1 failed (platform=${process.platform}; shared-central bridge attachment requires linux)`,
      remediation: "use a stdio-capable profile on non-linux platforms"
    };
  }
  if (flags.host !== "claude") {
    return {
      admitted: false,
      condition: 1,
      reason: `condition 1 failed (host=${flags.host ?? "unset"}; shared-central bridge attachment requires --host claude)`,
      remediation: "pass --host claude for shared-central bridge attachment"
    };
  }
  if (flags.instance) {
    return {
      admitted: false,
      condition: 1,
      reason: `condition 1 failed (instance=${flags.instance}; sidecar instance requests are not admitted to shared-central)`,
      remediation: "omit --instance to attach to shared-central"
    };
  }
  if (!env.CLAUDE_CODE_SESSION_ID?.trim()) {
    return {
      admitted: false,
      condition: 2,
      reason: "condition 2 failed (CLAUDE_CODE_SESSION_ID is unset or empty in the serving environment)",
      remediation: "export CLAUDE_CODE_SESSION_ID=<session-id> in the Claude host session"
    };
  }
  if (!centralRoutingEnabled(env, true)) {
    const envDisabled = env.H2A_MCP_CENTRAL === "0" || env.H2A_MCP_CENTRAL === "false";
    const cfgPath = centralConfigPath(env);
    const whyDisabled = envDisabled
      ? `H2A_MCP_CENTRAL=${env.H2A_MCP_CENTRAL}`
      : `h2a.central.enabled=false in ${cfgPath}`;
    const cond3Remedy = envDisabled
      ? "enable central routing: unset H2A_MCP_CENTRAL (or set H2A_MCP_CENTRAL=1)"
      : `enable central routing: set h2a.central.enabled=true in ${quoteShellPath(cfgPath)}`;
    return {
      admitted: false,
      condition: 3,
      reason: `condition 3 failed (central routing disabled via ${whyDisabled})`,
      remediation: cond3Remedy
    };
  }
  const paths = flags["runtime-base"] ? { runtimeBase: flags["runtime-base"] } : {};
  let markerPath = "marker.json";
  try {
    markerPath = centralMcpMarkerPath(paths);
  } catch {
    /* ignore */
  }
  let pausePath: string | null = null;
  try {
    const candidatePause = join(centralStateDirectory(paths), "operator-stop.json");
    if (existsSync(candidatePause)) {
      let isPaused = false;
      try {
        isPaused = readState(candidatePause, "pause")?.value.paused === true;
      } catch {
        try {
          const parsedPause = JSON.parse(readFileSync(candidatePause, "utf8")) as { paused?: unknown };
          isPaused = parsedPause?.paused === true;
        } catch {
          isPaused = false;
        }
      }
      if (isPaused) pausePath = candidatePause;
    }
  } catch {
    /* ignore */
  }
  try {
    const marker = readCentralMcpMarker(paths);
    if (!marker) {
      if (pausePath) {
        return {
          admitted: false,
          condition: 4,
          markerMissing: true,
          paused: true,
          reason: `condition 4 failed (central is paused by operator at ${pausePath}; missing central marker at ${markerPath})`,
          remediation: `resume central with: ${startCmd} (or ${statusCmd})`
        };
      }
      return {
        admitted: false,
        condition: 4,
        markerMissing: true,
        paused: false,
        reason: `condition 4 failed (missing or unreadable central marker at ${markerPath})`,
        remediation: startRemedy
      };
    }
    if (marker.protocol !== 2) {
      return {
        admitted: false,
        condition: 4,
        reason: `condition 4 failed (central marker at ${markerPath} has protocol=${String(marker.protocol)}, expected protocol=2)`,
        remediation: startRemedy
      };
    }
    if (marker.root !== expectedRoot) {
      return {
        admitted: false,
        condition: 4,
        reason: `condition 4 failed (central marker at ${markerPath} serves root=${String(marker.root)}, expected root=${expectedRoot})`,
        remediation: startRemedy
      };
    }
  } catch (err) {
    return {
      admitted: false,
      condition: 4,
      reason: `condition 4 failed (cannot read central marker at ${markerPath}: ${(err as Error).message})`,
      remediation: startRemedy
    };
  }
  return { admitted: true };
}

export function bridgeCentralAttachmentAdmitted(
  flags: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return diagnoseBridgeCentralAttachment(flags, env).admitted;
}

/** Minimal read-only routing policy; shared by initial launch and live recovery. */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { readState } from "./handover/state.js";
import { centralMcpMarkerPath, centralStateDirectory, readCentralMcpMarker } from "./mcp-central-discovery.js";
import { qualifiedHostInitialize, isSupportedCentralHost, claudeQualificationManifest, type ClaudeQualificationManifest } from "./mcp-central-qualification.js";

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
  const root = env.H2A_ROOT;
  if (root && isAbsolute(root)) return resolve(root);
  return join(env.HOME ?? homedir(), "h2a-workspace", ".h2a");
}
export function centralRoutingEnabled(env: NodeJS.ProcessEnv = process.env, defaultEnabled = false): boolean {
  if (env.H2A_MCP_CENTRAL === "0" || env.H2A_MCP_CENTRAL === "false") return false;
  const setting = centralSettings(env).enabled;
  if (setting === false) return false;
  return setting === true || env.H2A_MCP_CENTRAL === "1" || env.H2A_MCP_CENTRAL === "true" || defaultEnabled;
}
export function shouldUseCentralMcp(flags: Record<string, string>, env: NodeJS.ProcessEnv = process.env, defaultEnabled = false,
  initialize?: unknown, manifest: ClaudeQualificationManifest = claudeQualificationManifest): boolean {
  if (!isSupportedCentralHost(flags.host) || !qualifiedHostInitialize(flags.host, initialize, manifest)) return false;
  if (process.platform !== "linux" || flags.instance || flags.backend === "cluster-mesh" || env.H2A_MESSAGE_BACKEND === "cluster-mesh") return false;
  // Structured sidecar launches with readiness challenges stay on stdio
  if (env.H2A_MCP_READY_FILE || env.H2A_MCP_READY_NONCE) return false;
  // Claude binds its native conversation id; other hosts bind their routed
  // host tag until H6 measures real native session signals for them.
  if (flags.host === "claude" && !env.CLAUDE_CODE_SESSION_ID?.trim()) return false;
  if (!centralRoutingEnabled(env, defaultEnabled)) return false;
  // Central root must never be derived from cwd; relative roots deterministically select stdio
  if (env.H2A_ROOT && !isAbsolute(env.H2A_ROOT)) return false;
  if (flags.root && !isAbsolute(flags.root)) return false;
  const root = canonicalCentralRoot(env);
  if (flags.root && resolve(flags.root) !== root) return false;
  const paths = flags["runtime-base"] ? { runtimeBase: flags["runtime-base"] } : {};
  let marker: ReturnType<typeof readCentralMcpMarker>;
  try { marker = readCentralMcpMarker(paths); }
  catch (error) {
    if ((error as Error).message === "foreign_installation_authority") return false;
    throw error;
  }
  // Unsupported legacy protocol/root routes deterministically to stdio before initialize.
  if (marker && (marker.protocol !== 2 || marker.root !== root)) return false;
  return true;
}
