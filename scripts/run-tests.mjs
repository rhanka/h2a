#!/usr/bin/env node
/**
 * Cross-platform test runner. Used by `npm test`.
 *
 * Shell glob expansion (`packages/h2a/test/*.test.js`) is fine on bash but
 * silently breaks on PowerShell (Windows runners), where the literal asterisk
 * is forwarded to node. This runner discovers test files itself using
 * `node:fs`, so it behaves identically on Linux, macOS and Windows.
 *
 * It runs the test trees explicitly owned by the root `npm test` gate:
 *   - top-level `*.test.js` files in packages/h2a/test and
 *     packages/focus-interactive/test through `node --test`;
 *   - every source `.test.ts` or `.spec.ts` file under packages/track/src through
 *     Vitest. The Track suite is separate because it is TypeScript/Vitest rather
 *     than Node's built-in test runner.
 *
 * Other workspace packages own their own package-level test commands and are not
 * represented by this root gate. Do not quote this runner as a whole-monorepo
 * test count.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// A1: la suite vit dans packages/h2a/test (h2a-cli est un stub deprecie, sans tests).
const NODE_TEST_DIRS = ["packages/h2a/test", "packages/focus-interactive/test"];
const VITEST_SUITES = [
  { name: "Track", dir: "packages/track", config: "vitest.config.ts" },
];

const nodeTestFiles = [];
for (const rel of NODE_TEST_DIRS) {
  const abs = join(REPO_ROOT, rel);
  let entries;
  try {
    entries = readdirSync(abs);
  } catch (err) {
    process.stderr.write(
      `run-tests: required Node test directory is unavailable: ${abs} (${(err && err.message) || err})\n`
    );
    process.exit(1);
  }
  const files = [];
  for (const entry of entries) {
    if (entry.endsWith(".test.js")) {
      files.push(join(rel, entry));
    }
  }
  if (files.length === 0) {
    process.stderr.write(`run-tests: required Node test directory has no .test.js files: ${abs}\n`);
    process.exit(1);
  }
  nodeTestFiles.push(...files);
}

function discoverVitestTests(dir, relative = "") {
  const entries = readdirSync(join(dir, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...discoverVitestTests(dir, entryPath));
    } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts"))) {
      files.push(entryPath);
    }
  }
  return files;
}

const vitestSuites = VITEST_SUITES.map((suite) => {
  const sourceDir = join(REPO_ROOT, suite.dir, suite.testDir ?? "src");
  let files;
  try {
    files = discoverVitestTests(sourceDir);
  } catch (err) {
    process.stderr.write(
      `run-tests: cannot read ${sourceDir} (${(err && err.message) || err})\n`
    );
    process.exit(1);
  }
  if (files.length === 0) {
    process.stderr.write(`run-tests: no .test.ts/.spec.ts files discovered for ${suite.name}\n`);
    process.exit(1);
  }
  return { ...suite, files };
});
const vitestFileCount = vitestSuites.reduce((count, suite) => count + suite.files.length, 0);
process.stderr.write(
  `run-tests: discovered ${nodeTestFiles.length} Node test files and ${vitestFileCount} Vitest files ` +
    `(${vitestSuites.map((suite) => `${suite.name}: ${suite.files.length}`).join("; ")})\n`,
)

// Wall-clock backstop. A single hanging test (e.g. a spawned mcp-serve child
// that never closes on Windows) used to eat the CI job's full 15-minute budget
// and get CANCELLED — a silent, mysterious failure that blocked npm publish
// twice. Cap each suite well under any CI job timeout so a hang fails CLEAN
// and NAMED instead. Portable across node versions (a spawnSync option, not the
// node-20-incompatible `--test-timeout` flag). Override via H2A_TEST_TIMEOUT_MS.
const RUN_TIMEOUT_MS = Number(process.env.H2A_TEST_TIMEOUT_MS) || 600000;

// Defense-in-depth: create a throwaway temp dir for H2A_ROOT so that any test
// that runs a writing verb (connect/register/mcp-serve) without --root AND with
// H2A_ROOT unset writes to an isolated temp instead of the real shared bus.
// Tests that pass --root explicitly override this; tests that set H2A_ROOT
// themselves also override it within their own process.env assignments.
// Runtime launch workspaces are intentionally rejected under OS-global /tmp.
// Keep the process-wide OS temp semantics intact: tests rely on tmpdir() being
// outside the repository for non-git and /tmp rejection coverage. Tests that
// need a durable launch workspace opt into the dedicated repo-local root.
const testScratch = join(REPO_ROOT, "tmp", "test-runtime");
mkdirSync(testScratch, { recursive: true });
const testRoot = mkdtempSync(join(testScratch, "h2a-test-root-"));
const durableRoot = join(testRoot, "durable");
mkdirSync(durableRoot, { recursive: true });

const testEnv = {
  ...process.env,
  H2A_ROOT: join(testRoot, ".h2a"),
  H2A_TEST_DURABLE_ROOT: durableRoot
};

// Track's no-store fixtures intentionally walk to the filesystem root. Keep
// their temp parent away from a shared `/tmp/.track`, without changing the
// Node/h2a suite's tmpdir() semantics: h2a explicitly tests that `/tmp` launch
// workspaces are refused. Prefer /dev/shm when it is usable on Linux; other
// platforms, and hosts without a writable /dev/shm, keep their system temp.
function hasTrackAncestor(dir) {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, ".track"))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function makeCleanTrackTempDir(parent) {
  const dir = mkdtempSync(join(parent, "h2a-track-tests-"));
  if (!hasTrackAncestor(dir)) return dir;
  rmSync(dir, { recursive: true, force: true });
  throw new Error(`run-tests: Track test temporary directory inherits a .track ancestor from ${parent}`);
}

function makeTrackTempDir() {
  const fallback = tmpdir();
  const parents = process.platform === "linux" && existsSync("/dev/shm") && fallback !== "/dev/shm"
    ? ["/dev/shm", fallback]
    : [fallback];
  let lastError;
  for (const parent of parents) {
    try {
      return makeCleanTrackTempDir(parent);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const trackTemp = makeTrackTempDir();
const trackFixtureEnv = {
  ...testEnv,
  H2A_TEST_TRACK_TMPDIR: trackTemp
};
const trackTestEnv = {
  ...trackFixtureEnv,
  TMPDIR: trackTemp,
  TMP: trackTemp,
  TEMP: trackTemp
};

function runSuite(name, command, args, cwd, env = testEnv) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    timeout: RUN_TIMEOUT_MS,
    killSignal: "SIGKILL",
    env
  });

  if (result.error && result.error.code === "ETIMEDOUT") {
    process.stderr.write(
      `\nrun-tests: ${name} HUNG — the test run exceeded ${RUN_TIMEOUT_MS}ms and was killed. ` +
        `A test is not terminating (often a spawned child that never exits).\n`
    );
    return 124;
  }
  if (result.error) {
    process.stderr.write(`run-tests: ${name}: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function vitestEntrypoint(cwd) {
  const local = join(cwd, "node_modules", "vitest", "vitest.mjs");
  return existsSync(local) ? local : join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");
}

let exitCode = 0;
try {
  const nodeStatus = runSuite("Node test suite", process.execPath, ["--test", ...nodeTestFiles], REPO_ROOT, trackFixtureEnv);
  const vitestStatuses = vitestSuites.map((suite) => {
    const cwd = join(REPO_ROOT, suite.dir);
    const configArgs = suite.config === undefined ? [] : ["--config", suite.config];
    return runSuite(
      `${suite.name} Vitest suite`,
      process.execPath,
      [vitestEntrypoint(cwd), "run", ...configArgs, ...suite.files.map((file) => join(suite.testDir ?? "src", file))],
      cwd,
      trackTestEnv,
    );
  });
  exitCode = [nodeStatus, ...vitestStatuses].every((status) => status === 0) ? 0 : Math.max(nodeStatus, ...vitestStatuses);
} finally {
  try {
    rmSync(testRoot, { recursive: true, force: true });
  } finally {
    rmSync(trackTemp, { recursive: true, force: true });
  }
}

process.exit(exitCode);
