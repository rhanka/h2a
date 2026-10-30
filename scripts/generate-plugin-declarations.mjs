#!/usr/bin/env node
/**
 * Interim h2a-owned plugin declaration renderer (LOT-4B, RQ-16): emits the
 * generated host assets referenced by the shipped plugin manifests,
 * `packages/h2a/.claude-plugin/registry.mcp.json` and
 * `packages/h2a/.codex-plugin/registry.mcp.json`.
 *
 * Single source of truth: the bridge command shape comes from the built
 * `renderBridgeEntry` (same function the file-mechanism installer uses) —
 * one rendering path, not two. The declared executable is the interim
 * `h2a registry-bridge` (RQ-16); the final `sentropic-registry` executable
 * stays R7a. Generated files are never hand-edited: with `--check`, verifies
 * the committed files are byte-identical instead of writing (same discipline
 * as `generate-registry-entries.mjs --check`). `--host <claude|codex>`
 * renders a single host; any other host is refused before any write.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const hostFlag = argv.indexOf("--host");
const ONLY_HOST = hostFlag === -1 ? null : argv[hostFlag + 1];

const HOSTS = ["claude", "codex"];
if (ONLY_HOST !== null && !HOSTS.includes(ONLY_HOST)) {
  console.error(`generate-plugin-declarations: unsupported_host: unknown plugin host ${JSON.stringify(ONLY_HOST)}: expected one of ${HOSTS.join(", ")}`);
  process.exit(2);
}

const { renderBridgeEntry } = await import(join(ROOT, "packages/h2a/dist/registry/host-bootstrap.js"));

const subdir = (host) => (host === "claude" ? ".claude-plugin" : ".codex-plugin");

for (const host of ONLY_HOST === null ? HOSTS : [ONLY_HOST]) {
  const { entry } = renderBridgeEntry(host, { profile: "default" });
  // No --lock: plugin declarations carry host/profile only; the lock resolves
  // at serve time to the per-host/profile default (RQ-17).
  const asset = { mcpServers: { h2a: { command: entry.h2a.command, args: entry.h2a.args } } };
  const text = `${JSON.stringify(asset, null, 2)}\n`;
  const path = join(ROOT, "packages/h2a", subdir(host), "registry.mcp.json");
  if (CHECK) {
    const current = readFileSync(path, "utf8");
    if (current !== text) {
      console.error(`generate-plugin-declarations: ${path} differs from the renderer output; run without --check to regenerate`);
      process.exit(1);
    }
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
