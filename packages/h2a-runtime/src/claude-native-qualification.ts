import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

/**
 * Automatically enables correlated local dispatch evidence for the Linux x64,
 * h2a + direct Playwright 0.0.83 profile (no sidecar, bare mode or gateway).
 * The isolated qualification and its limits are documented in
 * docs/reviews/launch-latency-l0-l1.md, "Qualification locale du dispatch livré".
 * This private diagnostic format proves dispatch, not remote acceptance or G1.
 */
export const QUALIFIED_CLAUDE_NATIVE_VERSIONS: readonly string[] = ["2.1.296"];

/** Match the installed, pinned Node entry point used by the qualified profile. */
export function isQualifiedPlaywrightCommand(server?: { command?: string; args?: string[]; type?: string }): boolean {
  if (server?.command !== process.execPath || (server.type && server.type !== "stdio") ||
      !Array.isArray(server.args) || !server.args.every(arg => typeof arg === "string") ||
      !server.args[0] || !isAbsolute(server.args[0])) return false;
  try {
    const cli = realpathSync(server.args[0]);
    if (basename(cli) !== "cli.js" || !statSync(cli).isFile()) return false;
    const manifest = JSON.parse(readFileSync(join(dirname(cli), "package.json"), "utf8"));
    return manifest.name === "@playwright/mcp" && manifest.version === "0.0.83" &&
      manifest.bin?.["playwright-mcp"] === "cli.js";
  } catch {
    return false; // Unknown or unreadable installations keep the conservative path.
  }
}
