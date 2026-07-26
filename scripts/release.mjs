#!/usr/bin/env node
/**
 * Local release-prep helper for `h2a`.
 *
 * Drives the manual portion of the tag-driven release flow documented in
 * `docs/release.md`:
 *
 *   1. Verify `npm run typecheck` and `npm test` succeed.
 *   2. Bump the version in
 *        - `package.json` (root, private)
 *        - `package-lock.json`
 *        - `packages/h2a/package.json` (also aligns the
 *          `@sentropic/track` dependency caret to `^X.Y.Z`)
 *        - `packages/h2a/.claude-plugin/plugin.json` and
 *          `packages/h2a/.codex-plugin/plugin.json`
 *        - `packages/h2a-cli/package.json` (also aligns the
 *          `@sentropic/h2a` dependency caret to `^X.Y.Z`)
 *        - `packages/h2a-runtime/package.json` (heavy runtime, lockstep)
 *        - `packages/track/package.json` (record-only system of record, lockstep)
 *   3. Stage and commit those package files with `release: vX.Y.Z`.
 *   4. Create an annotated tag `vX.Y.Z` (signed only if
 *      `git config commit.gpgsign` is true, mirroring the user's setup).
 *   5. Print the manual next steps (`git push origin HEAD`, then tag).
 *
 * The publish itself happens in CI (`.github/workflows/release.yml`), gated
 * on the tag push. Nothing in this script touches the npm registry.
 *
 * Usage:
 *
 *   npm run release -- --version 0.2.0
 *   node scripts/release.mjs --version 0.2.0 --dry-run
 *
 * Pure helpers (`parseVersion`, `bumpPackageJsonContent`,
 * `bumpPackageLockContent`, `gitStatusIsClean`) are exported so the unit-test
 * suite can exercise them without spawning a subprocess.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const PACKAGE_FILES = [
  "package.json",
  "package-lock.json",
  "packages/h2a/package.json",
  "packages/h2a/.claude-plugin/plugin.json",
  "packages/h2a/.codex-plugin/plugin.json",
  "packages/h2a-cli/package.json",
  "packages/h2a-runtime/package.json",
  "packages/track/package.json"
];

const CORE_PACKAGE_NAME = "@sentropic/h2a";

/**
 * Workspace package names whose inter-package dependency carets are kept in
 * lockstep with the release version. When any workspace manifest depends on one
 * of these, its `"^X.Y.Z"` range is rewritten to the new version so a published
 * `@sentropic/h2a@X.Y.Z` pulls `@sentropic/track@^X.Y.Z` (and `@sentropic/h2a-cli`
 * pulls `@sentropic/h2a@^X.Y.Z`), never a stale minor.
 */
const LOCKSTEP_DEP_NAMES = [CORE_PACKAGE_NAME, "@sentropic/track"];

/**
 * Workspace lockfile keys (under `.packages`) whose `version` mirrors a
 * published manifest and must be bumped in lockstep. `""` is the private root.
 */
const LOCKSTEP_LOCK_KEYS = [
  "",
  "packages/h2a",
  "packages/h2a-cli",
  "packages/h2a-runtime",
  "packages/track"
];

/**
 * Parse a strict SemVer "X.Y.Z" into its numeric components. Throws on any
 * deviation (extra prefix, pre-release suffix, missing component). Keeps the
 * release flow boring: we only ship X.Y.Z tags in V1.
 *
 * @param {string} value - The version literal, e.g. `"0.2.0"`.
 * @returns {{ major: number, minor: number, patch: number }}
 */
export function parseVersion(value) {
  if (typeof value !== "string") {
    throw new TypeError(
      `parseVersion: expected a string version, got ${typeof value}`
    );
  }
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) {
    throw new Error(
      `parseVersion: "${value}" is not a strict X.Y.Z SemVer triple (no leading zeros, pre-release, or build metadata allowed in release tags).`
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

/**
 * Bump a parsed `package.json` JSON string to `newVersion`. Pure: takes a
 * JSON string in, returns a JSON string out (with the trailing newline
 * preserved if the input had one).
 *
 * Side-effects on the parsed object:
 * - Sets `.version` to `newVersion`.
 * - For every lockstep sibling in `.dependencies` (see `LOCKSTEP_DEP_NAMES`,
 *   currently `@sentropic/h2a` and `@sentropic/track`), rewrites the range to
 *   `"^X.Y.Z"` of the same version so the workspace ships in lockstep.
 *
 * @param {string} jsonContent - Raw JSON content of a `package.json` file.
 * @param {string} newVersion - Target version, validated by `parseVersion`.
 * @returns {string} The updated JSON string (pretty-printed, 2-space indent).
 */
export function bumpPackageJsonContent(jsonContent, newVersion) {
  parseVersion(newVersion); // validate
  const trailingNewline = jsonContent.endsWith("\n");
  const parsed = JSON.parse(jsonContent);
  parsed.version = newVersion;
  if (parsed.dependencies && typeof parsed.dependencies === "object") {
    for (const dep of LOCKSTEP_DEP_NAMES) {
      if (Object.prototype.hasOwnProperty.call(parsed.dependencies, dep)) {
        parsed.dependencies[dep] = `^${newVersion}`;
      }
    }
  }
  const out = JSON.stringify(parsed, null, 2);
  return trailingNewline ? `${out}\n` : out;
}

/**
 * Bump the root lockfile entries that mirror the workspace package versions.
 * `npm ci` in the tag workflow consumes this file, so the release commit must
 * keep it in sync with the package manifests instead of relying on a later
 * install command to repair it.
 *
 * @param {string} jsonContent - Raw root `package-lock.json` content.
 * @param {string} newVersion - Target version, validated by `parseVersion`.
 * @returns {string} The updated JSON string (pretty-printed, 2-space indent).
 */
export function bumpPackageLockContent(jsonContent, newVersion) {
  parseVersion(newVersion); // validate
  const trailingNewline = jsonContent.endsWith("\n");
  const parsed = JSON.parse(jsonContent);
  parsed.version = newVersion;

  const packages =
    parsed.packages && typeof parsed.packages === "object"
      ? parsed.packages
      : undefined;
  if (packages) {
    for (const key of LOCKSTEP_LOCK_KEYS) {
      if (packages[key] && typeof packages[key] === "object") {
        packages[key].version = newVersion;
      }
    }
    // Rewrite lockstep dependency carets wherever a workspace manifest declares
    // one (e.g. packages/h2a → @sentropic/track, packages/h2a-cli →
    // @sentropic/h2a). The private root ("") has no such deps; skip it.
    for (const key of LOCKSTEP_LOCK_KEYS) {
      if (key === "") continue;
      const pkg = packages[key];
      if (!pkg || typeof pkg !== "object") continue;
      if (!pkg.dependencies || typeof pkg.dependencies !== "object") continue;
      for (const dep of LOCKSTEP_DEP_NAMES) {
        if (Object.prototype.hasOwnProperty.call(pkg.dependencies, dep)) {
          pkg.dependencies[dep] = `^${newVersion}`;
        }
      }
    }
  }

  const out = JSON.stringify(parsed, null, 2);
  return trailingNewline ? `${out}\n` : out;
}

/** @param {string} porcelainOutput */
export function gitStatusIsClean(porcelainOutput) {
  return porcelainOutput.trim().length === 0;
}

function parseArgs(argv) {
  const args = { version: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--version") {
      args.version = argv[i + 1];
      i++;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: npm run release -- --version <X.Y.Z> [--dry-run]",
      "",
      "Bumps both packages to the same X.Y.Z, runs typecheck + tests,",
      "commits, and creates an annotated tag `vX.Y.Z`. Publish itself",
      "happens in CI on tag push (see .github/workflows/release.yml).",
      ""
    ].join("\n")
  );
}

function runStep(label, command, args, options = {}) {
  process.stdout.write(`\n→ ${label}\n  $ ${command} ${args.join(" ")}\n`);
  if (options.dryRun) {
    process.stdout.write("  (dry-run: skipped)\n");
    return;
  }
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (exit code ${result.status ?? "signal:" + result.signal}).`
    );
  }
}

function bumpAllPackages(newVersion, options = {}) {
  for (const rel of PACKAGE_FILES) {
    const absolute = join(REPO_ROOT, rel);
    const raw = readFileSync(absolute, "utf8");
    const next =
      rel === "package-lock.json"
        ? bumpPackageLockContent(raw, newVersion)
        : bumpPackageJsonContent(raw, newVersion);
    if (raw === next) {
      process.stdout.write(`  ${rel}: already at ${newVersion}\n`);
      continue;
    }
    if (options.dryRun) {
      process.stdout.write(`  ${rel}: would bump to ${newVersion}\n`);
      continue;
    }
    writeFileSync(absolute, next, "utf8");
    process.stdout.write(`  ${rel}: bumped to ${newVersion}\n`);
  }
}

function assertCleanWorktree() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      `git status --porcelain failed (exit code ${result.status ?? "signal:" + result.signal}).`
    );
  }
  if (!gitStatusIsClean(result.stdout ?? "")) {
    throw new Error(
      "release requires a clean worktree before verification. Commit, stash, or discard local changes first."
    );
  }
}

function gitConfigBool(key) {
  const result = spawnSync("git", ["config", "--get", key], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  if (result.status !== 0) return false;
  return (result.stdout ?? "").trim().toLowerCase() === "true";
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`release: ${(err && err.message) || err}\n`);
    printHelp();
    process.exit(1);
  }

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.version) {
    process.stderr.write("release: --version <X.Y.Z> is required\n");
    printHelp();
    process.exit(1);
  }

  try {
    parseVersion(args.version);
  } catch (err) {
    process.stderr.write(`release: ${(err && err.message) || err}\n`);
    process.exit(1);
  }

  const newVersion = args.version;
  const tag = `v${newVersion}`;
  const dryRun = args.dryRun;

  process.stdout.write(
    `\n=== h2a release prep — target ${tag}${dryRun ? " (dry-run)" : ""} ===\n`
  );

  runStep("Check clean worktree", "git", ["status", "--porcelain"], { dryRun });
  if (!dryRun) assertCleanWorktree();

  runStep("Typecheck", "npm", ["run", "typecheck"], { dryRun });
  runStep(
    "Test npm test gate runner directly",
    "node",
    ["--test", "packages/h2a/test/run-test-gates.test.js"],
    { dryRun }
  );
  runStep("Tests", "npm", ["test"], { dryRun });
  runStep("Check verification left worktree clean", "git", ["status", "--porcelain"], {
    dryRun
  });
  if (!dryRun) assertCleanWorktree();

  process.stdout.write("\n→ Bump package.json files\n");
  bumpAllPackages(newVersion, { dryRun });

  runStep(
    "Stage version bumps",
    "git",
    ["add", ...PACKAGE_FILES],
    { dryRun }
  );

  runStep(
    "Commit version bumps",
    "git",
    ["commit", "-m", `release: ${tag}`],
    { dryRun }
  );

  const signTag = dryRun ? false : gitConfigBool("commit.gpgsign");
  const tagArgs = ["tag"];
  if (signTag) tagArgs.push("-s");
  tagArgs.push("-a", tag, "-m", `release: ${tag}`);
  runStep(
    signTag
      ? "Create signed annotated tag"
      : "Create annotated tag (unsigned — commit.gpgsign=false)",
    "git",
    tagArgs,
    { dryRun }
  );

  process.stdout.write(
    [
      "",
      "Next steps (manual — nothing in this script touches the network):",
      "",
      `  git push origin HEAD`,
      `  git push origin ${tag}`,
      "",
      "On tag push, .github/workflows/release.yml runs:",
      "  - typecheck + tests",
      "  - version sanity gate (tag vs package.json)",
      "  - npm publish --access public via npm Trusted Publishing (track + h2a + h2a-cli + h2a-runtime)",
      "  - gh release create --generate-notes",
      ""
    ].join("\n")
  );
}

// Run as CLI only when invoked directly (skip when imported by tests).
const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`release: ${(err && err.message) || err}\n`);
    process.exit(1);
  });
}
