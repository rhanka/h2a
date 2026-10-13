import { authenticatedHttpRequest } from "./handover/authenticated-http.js";
import { readState, publishState, replaceState } from "./handover/state.js";
/** Operator control uses the authenticated owner, never a marker PID signal. */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { centralMcpMarkerPath, markerDirectory, centralStateDirectory, readCentralClientMarker, type CentralMcpPathsOptions } from "./mcp-central-discovery.js";

export function centralPausePath(paths: CentralMcpPathsOptions = {}): string { return join(centralStateDirectory(paths), "operator-stop.json"); }

export async function centralOperator(action: "status" | "stop", paths: CentralMcpPathsOptions = {}): Promise<unknown> {
  const pausePath = centralPausePath(paths);
  const paused = () => {
    try { return readState(pausePath, "pause")?.value.paused ?? false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  const writePause = (generation: string | null = null) => {
    mkdirSync(centralStateDirectory(paths), { recursive: true, mode: 0o700 });
    const previous = readState(pausePath, "pause");
    const value = { schemaVersion: 1, revision: (previous?.value.revision ?? 0) + 1,
      paused: true, requestedAt: Date.now(), generation };
    if (previous) replaceState(pausePath, value, "pause", previous); else publishState(pausePath, value, "pause");
  };
  let marker;
  try {
    marker = readCentralClientMarker(centralMcpMarkerPath(paths));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (action === "stop") {
        writePause();
        return { running: "unverified", paused: true, stopped: false, state: "pause_active_stop_deferred" };
      }
      return { running: false, paused: paused() };
    }
    throw error;
  }
  if (action === "stop") {
    // Persist the manual stop before asking the authenticated daemon to exit.
    // An automatic launcher must never undo it.
    writePause(marker.generation);
  }
  try {
    const response = await authenticatedHttpRequest(centralMcpMarkerPath(paths), marker, new URL(`/_h2a-central/${action}`, marker.endpoint), {
      method: action === "stop" ? "POST" : "GET",
      headers: {}, signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) { await response.text(); throw new Error(`central ${action}: HTTP ${response.status}`); }
    const result = await response.json() as { state?: string; stopped?: boolean };
    if (action === "stop") {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const control = readState(join(centralStateDirectory(paths), "component-control.json"), "componentControl");
        if (control?.value.sourceGeneration === marker.generation && control.value.operatorStopped)
          return { running: false, paused: paused(), stopped: true, state: "stopped", generation: marker.generation };
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return { running: "unverified", paused: paused(), stopped: false, state: "pause_active_stop_deferred", generation: marker.generation };
    }
    return { running: action === "status" || result.state === "pause_active_stop_deferred", paused: paused(), ...result };
  } catch (error) {
    if (action === "stop") return { running: "unverified", paused: true, error: (error as Error).message };
    return { running: false, paused: paused(), error: (error as Error).message };
  }
}

export function centralOperatorExitCode(result: unknown): number {
  return result && typeof result === "object" && "error" in result ? 2 : 0;
}
export function centralFailureExitCode(error: unknown): number {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code && ["EACCES", "EPERM", "EROFS", "ENOSPC", "EIO"].includes(code) ? 3 : 2;
}

import { writeHostMcpEntry } from "../hosts/config-writer.js";

/** Shallow inventory with explicit opt-in repair to stdio mcp-serve. */
export function centralResidueReport(
  workspace: string,
  agyConfig = join(homedir(), ".gemini", "config", "mcp_config.json"),
  options: { repair?: boolean; allowTracked?: boolean; codexConfig?: string } = {}
): {
  reportOnly: boolean;
  workspace: string;
  repairedCount: number;
  findings: Array<{ path: string; kind: string; tracked: boolean | "unknown"; action: string; backupPath?: string; error?: string }>;
  cleanup: string;
} {
  const findings: Array<{ path: string; kind: string; tracked: boolean | "unknown"; action: string; backupPath?: string; error?: string }> = [];
  const tracked = (path: string): boolean | "unknown" => {
    const result = spawnSync("git", ["--literal-pathspecs", "-C", workspace, "ls-files", "--error-unmatch", "--", path], { stdio: "ignore" });
    return result.status === 0 ? true : result.status === 1 || result.status === 128 ? false : "unknown";
  };
  let repairedCount = 0;
  const candidateEntries: Array<{ path: string; host: string }> = [
    { path: join(workspace, ".mcp.json"), host: "claude" },
    { path: join(workspace, ".gemini", "settings.json"), host: "gemini" },
    { path: agyConfig, host: "agy" },
    ...(options.codexConfig ? [{ path: options.codexConfig, host: "codex" }] : [
      { path: join(homedir(), ".codex", "config.json"), host: "codex" },
      { path: join(homedir(), ".config", "codex", "mcp.json"), host: "codex" }
    ])
  ];
  for (const { path, host } of candidateEntries) {
    if (existsSync(path) && lstatSync(path).isFile() && /mcp-central-connect/.test(readFileSync(path, "utf8"))) {
      const isTrk = tracked(path);
      if (options.repair) {
        try {
          const incoming = { command: "h2a", args: ["mcp-serve", "--auto-open", "--host", host, "--auto-upgrade", "--wake", "auto"] };
          const { backupPath } = writeHostMcpEntry(path, incoming, Boolean(options.allowTracked));
          findings.push({ path, kind: "v1-central-config", tracked: isTrk, action: "repaired", ...(backupPath ? { backupPath } : {}) });
          repairedCount++;
        } catch (error) {
          findings.push({ path, kind: "v1-central-config", tracked: isTrk, action: isTrk === true ? "refused-tracked" : "error", error: (error as Error).message });
        }
      } else {
        findings.push({ path, kind: "v1-central-config", tracked: isTrk, action: "review-only" });
      }
    }
  }
  for (const path of [join(workspace, ".h2a-schema.json"), join(workspace, ".h2a", ".h2a-schema.json")]) {
    if (existsSync(path)) findings.push({ path, kind: "repo-store-sentinel", tracked: tracked(path), action: "review-only" });
  }
  return {
    reportOnly: !options.repair,
    workspace,
    repairedCount,
    findings,
    cleanup: options.repair
      ? "Repaired legacy central connectors to stdio mcp-serve endpoints with backups."
      : "Review each path and its backup before any explicit manual cleanup. This command never deletes or rewrites files without --repair."
  };
}
