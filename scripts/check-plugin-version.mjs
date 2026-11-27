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

function isShallowRepository(root) {
  try {
    return runGit(root, ["rev-parse", "--is-shallow-repository"]) === "true";
  } catch {
    return false;
  }
}

function compareSemverAsc(a, b) {
  const parse = (raw) => {
    const clean = raw.replace(/^v/i, "");
    const dash = clean.indexOf("-");
    const core = (dash === -1 ? clean : clean.slice(0, dash)).split(".").map(Number);
    const pre = dash === -1 ? null : clean.slice(dash + 1).split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
    return { core, pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa.core[i] ?? 0) !== (pb.core[i] ?? 0)) return (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const maxLen = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < maxLen; i++) {
    const va = pa.pre[i];
    const vb = pb.pre[i];
    if (va === undefined) return -1;
    if (vb === undefined) return 1;
    if (va === vb) continue;
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    if (typeof va === "number") return -1;
    if (typeof vb === "number") return 1;
    return String(va).localeCompare(String(vb));
  }
  return 0;
}

function listReleaseTagsAtRef(root, ref = "HEAD") {
  try {
    const raw = runGit(root, ["tag", "--points-at", ref, "--list", "v[0-9]*"]);
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.test(s))
      .sort(compareSemverAsc);
  } catch {
    return [];
  }
}

export function resolveBaselineReleaseTag(root, explicitBase) {
  if (explicitBase) {
    try {
      runGit(root, ["rev-parse", "--verify", `${explicitBase}^{commit}`]);
      return explicitBase;
    } catch {
      throw new Error(`plugin_version_check_incomplete: baseline ref ${JSON.stringify(explicitBase)} is missing in git history`);
    }
  }
  try {
    runGit(root, ["rev-parse", "--git-dir"]);
  } catch {
    throw new Error("plugin_version_check_incomplete: not a git repository; cannot resolve baseline release tag");
  }
  if (isShallowRepository(root)) {
    throw new Error(
      "plugin_version_check_incomplete: shallow git checkout cannot verify plugin content history; fetch full history and tags (fetch-depth: 0)"
    );
  }

  const headTags = listReleaseTagsAtRef(root, "HEAD");
  const envRefTag = typeof process.env.GITHUB_REF === "string" && process.env.GITHUB_REF.startsWith("refs/tags/")
    ? process.env.GITHUB_REF.slice("refs/tags/".length)
    : null;
  const currentTag = envRefTag && headTags.includes(envRefTag) ? envRefTag : headTags[headTags.length - 1] ?? null;

  // Same-tree promotion: when stable vX.Y.Z is tagged on a commit/tree that
  // already carries vX.Y.Z-rc.N, compare against that RC tag on HEAD rather
  // than stepping back to HEAD^ and an older RC.
  if (currentTag && !currentTag.includes("-")) {
    const matchingRcOnHead = headTags.filter((tag) => tag.startsWith(`${currentTag}-rc.`));
    if (matchingRcOnHead.length > 0) {
      return matchingRcOnHead[matchingRcOnHead.length - 1];
    }
    try {
      const headTree = runGit(root, ["rev-parse", "HEAD^{tree}"]);
      const matchingRcTag = runGit(root, ["tag", "--list", `${currentTag}-rc.*`, "--sort=-v:refname"])
        .split("\n")
        .map((s) => s.trim())
        .find((tag) => {
          if (!tag) return false;
          try {
            return runGit(root, ["rev-parse", `${tag}^{tree}`]) === headTree;
          } catch {
            return false;
          }
        });
      if (matchingRcTag) return matchingRcTag;
    } catch {
      /* fall through to ancestor tag search */
    }
  }

  const searchFrom = headTags.length > 0 ? "HEAD^" : "HEAD";
  try {
    const tag = runGit(root, ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", searchFrom]);
    if (/^v[0-9]/.test(tag)) return tag;
  } catch {
    /* handled below */
  }
  throw new Error(
    `plugin_version_check_incomplete: no baseline release or RC tag (vX.Y.Z / vX.Y.Z-rc.N) reachable from ${searchFrom}`
  );
}

export function checkPluginContentVersionBump(root, options = {}) {
  const currentVersion = checkPluginManifestSync(root);
  const baseRef = resolveBaselineReleaseTag(root, options.baseRef);

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
  let syncOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (argv[i] === "--base" && argv[i + 1]) baseRef = argv[++i];
    else if (argv[i] === "--sync-only") syncOnly = true;
  }
  return { root, baseRef, syncOnly };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { root, baseRef, syncOnly } = parseCliArgs(process.argv.slice(2));
  if (syncOnly) {
    const version = checkPluginManifestSync(root);
    console.log(`plugin-version sync OK: manifests synced at ${version}`);
  } else {
    const result = checkPluginContentVersionBump(root, { baseRef });
    console.log(
      `plugin-version check OK: version=${result.currentVersion}, base=${result.baseRef}, changedPluginFiles=${result.changedFiles.length}`
    );
  }
}
