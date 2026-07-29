#!/usr/bin/env node
/**
 * Cross-platform test runner. Used by `npm test`.
 *
 * Shell glob expansion (`packages/h2a/test/*.test.js`) is fine on bash but
 * silently breaks on PowerShell (Windows runners), where the literal asterisk
 * is forwarded to node. This runner discovers test files itself using
 * `node:fs`, so it behaves identically on Linux, macOS and Windows.
 *
 * It runs the test trees declared in `scripts/test-manifest.mjs`:
 *   - top-level `*.test.js` files under NODE_TEST_DIRS through `node --test`;
 *   - every source `.test.ts` or `.spec.ts` file of each VITEST_SUITES package
 *     through Vitest (TypeScript suites, not Node's built-in runner).
 *
 * The manifest — not this file — is the declaration, because a structural test
 * (packages/h2a/test/test-gate-coverage.test.js) reads it to prove that no
 * workspace package carrying test files is left outside the gate.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NODE_TEST_DIRS, VITEST_SUITES } from "./test-manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

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

function runSuite(name, command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    timeout: RUN_TIMEOUT_MS,
    killSignal: "SIGKILL",
    env: testEnv
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
  const nodeStatus = runSuite("Node test suite", process.execPath, ["--test", ...nodeTestFiles], REPO_ROOT);
  const vitestStatuses = vitestSuites.map((suite) => {
    const cwd = join(REPO_ROOT, suite.dir);
    const configArgs = suite.config === undefined ? [] : ["--config", suite.config];
    return runSuite(
      `${suite.name} Vitest suite`,
      process.execPath,
      [vitestEntrypoint(cwd), "run", ...configArgs, ...suite.files.map((file) => join(suite.testDir ?? "src", file))],
      cwd,
    );
  });
  exitCode = [nodeStatus, ...vitestStatuses].every((status) => status === 0) ? 0 : Math.max(nodeStatus, ...vitestStatuses);
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

process.exit(exitCode);
