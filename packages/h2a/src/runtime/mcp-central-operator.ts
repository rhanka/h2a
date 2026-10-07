import { centralHttpRequest } from "./mcp-central-http.js";
/** Operator control uses the authenticated owner, never a marker PID signal. */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { centralMcpMarkerPath, markerDirectory, readCentralClientMarker, type CentralMcpPathsOptions } from "./mcp-central-discovery.js";

export function centralPausePath(paths: CentralMcpPathsOptions = {}): string { return join(markerDirectory(paths), "operator-stop.json"); }

export async function centralOperator(action: "status" | "stop", paths: CentralMcpPathsOptions = {}): Promise<unknown> {
  const pausePath = centralPausePath(paths);
  const writePause = (generation?: string) => {
    mkdirSync(markerDirectory(paths), { recursive: true, mode: 0o700 });
    if (existsSync(pausePath) && !lstatSync(pausePath).isFile()) throw new Error("central operator stop marker must be a regular file");
    writeFileSync(pausePath, JSON.stringify({ ...(generation ? { generation } : {}), at: new Date().toISOString() }) + "\n", { mode: 0o600 });
  };
  let marker;
  try {
    marker = readCentralClientMarker(centralMcpMarkerPath(paths));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (action === "stop") {
        writePause();
        return { running: false, paused: true };
      }
      return { running: false, paused: existsSync(pausePath) };
    }
    throw error;
  }
  if (action === "stop") {
    // Persist the manual stop before asking the authenticated daemon to exit.
    // An automatic launcher must never undo it.
    writePause(marker.generation);
  }
  try {
    const response = await centralHttpRequest(new URL(`/_h2a-central/${action}`, marker.endpoint), {
      method: action === "stop" ? "POST" : "GET",
      headers: { authorization: `Bearer ${marker.token}` }, signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) { await response.text(); throw new Error(`central ${action}: HTTP ${response.status}`); }
    return { running: action !== "stop", paused: existsSync(pausePath), ...await response.json() as object };
  } catch (error) {
    if (action === "stop") return { running: "unverified", paused: true, error: (error as Error).message };
    return { running: false, paused: existsSync(pausePath), error: (error as Error).message };
  }
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
  const candidatePaths = [
    join(workspace, ".mcp.json"),
    join(workspace, ".gemini", "settings.json"),
    agyConfig,
    ...(options.codexConfig ? [options.codexConfig] : [
      join(homedir(), ".codex", "config.json"),
      join(homedir(), ".config", "codex", "mcp.json")
    ])
  ];
  for (const path of candidatePaths) {
    if (existsSync(path) && lstatSync(path).isFile() && /mcp-central-connect/.test(readFileSync(path, "utf8"))) {
      const isTrk = tracked(path);
      if (options.repair) {
        let host = "claude";
        if (path === agyConfig || path.includes("mcp_config.json")) host = "agy";
        else if (path.includes("settings.json")) host = "gemini";
        else if (path.includes("codex")) host = "codex";
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
