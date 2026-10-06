import { centralHttpRequest } from "./mcp-central-http.js";
/** Operator control uses the authenticated owner, never a marker PID signal. */
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { centralMcpMarkerPath, markerDirectory, readCentralClientMarker, type CentralMcpPathsOptions } from "./mcp-central-discovery.js";

export function centralPausePath(paths: CentralMcpPathsOptions = {}): string { return join(markerDirectory(paths), "operator-stop.json"); }

export async function centralOperator(action: "status" | "stop", paths: CentralMcpPathsOptions = {}): Promise<unknown> {
  let marker;
  try { marker = readCentralClientMarker(centralMcpMarkerPath(paths)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { running: false, paused: existsSync(centralPausePath(paths)) }; throw error; }
  if (action === "stop") {
    // Persist the manual stop before asking the authenticated daemon to exit.
    // An automatic launcher must never undo it.
    const path = centralPausePath(paths);
    if (existsSync(path) && !lstatSync(path).isFile()) throw new Error("central operator stop marker must be a regular file");
    writeFileSync(path, JSON.stringify({ generation: marker.generation, at: new Date().toISOString() }) + "\n", { mode: 0o600 });
  }
  try {
    const response = await centralHttpRequest(new URL(`/_h2a-central/${action}`, marker.endpoint), {
      method: action === "stop" ? "POST" : "GET",
      headers: { authorization: `Bearer ${marker.token}` }, signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) { await response.text(); throw new Error(`central ${action}: HTTP ${response.status}`); }
    return { running: action !== "stop", paused: existsSync(centralPausePath(paths)), ...await response.json() as object };
  } catch (error) {
    if (action === "stop") return { running: "unverified", paused: true, error: (error as Error).message };
    return { running: false, paused: existsSync(centralPausePath(paths)), error: (error as Error).message };
  }
}

import { writeHostMcpEntry } from "../hosts/config-writer.js";

/** Shallow inventory with explicit opt-in repair to stdio mcp-serve. */
export function centralResidueReport(
  workspace: string,
  agyConfig = join(homedir(), ".gemini", "config", "mcp_config.json"),
  options: { repair?: boolean; allowTracked?: boolean } = {}
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
  for (const path of [join(workspace, ".mcp.json"), join(workspace, ".gemini", "settings.json"), agyConfig]) {
    if (existsSync(path) && lstatSync(path).isFile() && /mcp-central-connect/.test(readFileSync(path, "utf8"))) {
      const isTrk = tracked(path);
      if (options.repair) {
        let host = "claude";
        if (path === agyConfig) host = "agy";
        else if (path.includes("settings.json")) host = "gemini";
        else if (path.includes("codex")) host = "codex";
        try {
          const incoming = { command: "h2a", args: ["mcp-serve", "--host", host] };
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
