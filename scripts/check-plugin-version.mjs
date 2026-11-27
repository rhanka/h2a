#!/usr/bin/env node
/**
 * Release check for the shipped plugin manifests and payload content.
 *
 * Ensures:
 * 1. `packages/h2a/.claude-plugin/plugin.json` and
 *    `packages/h2a/.codex-plugin/plugin.json` match `packages/h2a/package.json`.
 * 2. Whenever any shipped plugin content changes relative to a baseline git
 *    ref (previous release/RC tag or `--base <ref>`), BOTH plugin manifest
 *    `version` fields MUST also change.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PLUGIN_MANIFEST_PATHS = [
  "packages/h2a/.claude-plugin/plugin.json",
  "packages/h2a/.codex-plugin/plugin.json"
];

export const PLUGIN_CONTENT_PATHS = [
  ".claude-plugin/marketplace.json",
  "packages/h2a/.claude-plugin/registry.mcp.json",
  "packages/h2a/.codex-plugin/registry.mcp.json",
  "packages/h2a/hooks",
  "packages/h2a/registry/entries.v1.json",
  "packages/h2a/scripts/h2a-bridge-shim.mjs",
  "packages/h2a/skills"
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function checkPluginManifestSync(root) {
  const pkgPath = join(root, "packages/h2a/package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`plugin_version_sync_failed: missing ${pkgPath}`);
  }
  const h2aVersion = readJson(pkgPath).version;
  for (const rel of PLUGIN_MANIFEST_PATHS) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      throw new Error(`plugin_version_sync_failed: missing plugin manifest ${rel}`);
    }
    const manifest = readJson(abs);
    if (manifest.version !== h2aVersion) {
      throw new Error(
        `plugin_version_sync_failed: ${rel} version (${JSON.stringify(manifest.version)}) must match packages/h2a/package.json (${JSON.stringify(h2aVersion)})`
      );
    }
  }
  return h2aVersion;
}

function runGit(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function resolveBaselineReleaseTag(root, explicitBase) {
  if (explicitBase) return explicitBase;
  try {
    runGit(root, ["rev-parse", "--git-dir"]);
  } catch {
    return null;
  }
  const headTag = (() => {
    try {
      return runGit(root, ["describe", "--tags", "--exact-match", "HEAD"]);
    } catch {
      return "";
    }
  })();
  const searchFrom = /^v[0-9]/.test(headTag) ? "HEAD^" : "HEAD";
  try {
    const tag = runGit(root, ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", searchFrom]);
    return /^v[0-9]/.test(tag) ? tag : null;
  } catch {
    return null;
  }
}

export function checkPluginContentVersionBump(root, options = {}) {
  const currentVersion = checkPluginManifestSync(root);
  const baseRef = resolveBaselineReleaseTag(root, options.baseRef);
  if (!baseRef) {
    return { checked: false, currentVersion, baseRef: null, changedFiles: [] };
  }

  const diffOut = runGit(root, ["diff", "--name-only", baseRef, "--", ...PLUGIN_CONTENT_PATHS]);
  const changedFiles = diffOut ? diffOut.split("\n").filter(Boolean) : [];
  if (changedFiles.length === 0) {
    return { checked: true, currentVersion, baseRef, changedFiles: [] };
  }

  for (const rel of PLUGIN_MANIFEST_PATHS) {
    let baseVersion = null;
    try {
      const baseRaw = runGit(root, ["show", `${baseRef}:${rel}`]);
      baseVersion = JSON.parse(baseRaw).version ?? null;
    } catch {
      baseVersion = null;
    }
    const currentManifestVersion = readJson(join(root, rel)).version;
    if (baseVersion !== null && currentManifestVersion === baseVersion) {
      throw new Error(
        `plugin_version_stale: plugin content changed since ${baseRef} (${changedFiles.slice(0, 5).join(", ")}${changedFiles.length > 5 ? ", ..." : ""}) ` +
        `without bumping ${rel} version (remained ${JSON.stringify(currentManifestVersion)})`
      );
    }
  }
  return { checked: true, currentVersion, baseRef, changedFiles };
}

function parseCliArgs(argv) {
  let root = process.cwd();
  let baseRef;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (argv[i] === "--base" && argv[i + 1]) baseRef = argv[++i];
  }
  return { root, baseRef };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { root, baseRef } = parseCliArgs(process.argv.slice(2));
  const result = checkPluginContentVersionBump(root, { baseRef });
  console.log(
    result.checked
      ? `plugin-version check OK: version=${result.currentVersion}, base=${result.baseRef}, changedPluginFiles=${result.changedFiles.length}`
      : `plugin-version check OK: manifests synced at ${result.currentVersion} (no baseline tag)`
  );
}
