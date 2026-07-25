#!/usr/bin/env node
/**
 * Cross-platform test runner. Used by `npm test` (via scripts/run-test-gates.mjs).
 *
 * Shell glob expansion (`packages/h2a/test/*.test.js`) is fine on bash but
 * silently breaks on PowerShell (Windows runners), where the literal asterisk
 * is forwarded to node. This runner discovers the `*.test.js` files itself
 * using `node:fs`, so it behaves identically on Linux, macOS and Windows.
 *
 * Discovers test files under the directories in TEST_DIRS below.
 *
 * Then invokes `node --test <file1> <file2> ...` and forwards the exit code.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");

// A1: la suite vit dans packages/h2a/test (h2a-cli est un stub deprecie, sans tests).
export const TEST_DIRS = [
  "packages/h2a/test",
  "packages/focus-interactive/test"
];

/**
 * Floor on the number of discovered test files.
 *
 * WHY A FLOOR AND NOT JUST "> 0". This runner attests EXIT CODES, not work
 * performed. The existing `files.length === 0` guard catches total discovery
 * failure, but nothing catches a COLLAPSE: a renamed directory, a changed
 * suffix, or a path bug that drops discovery from 189 files to 1 would still
 * exit 0 and still print a confident green. A run that silently stops looking
 * is the same defect class as a gate that silently suppresses the suite.
 *
 * WHY 150. Discovery currently finds 190 files. 150 sits ~20% below that:
 * low enough that ordinary churn (consolidating or deleting a few suites) never
 * trips it, high enough that any collapse worth the name does. It is a tripwire
 * against a broken discovery mechanism, NOT a coverage target — raise it only
 * to track a genuine, sustained rise in the file count.
 */
export const MINIMUM_TEST_FILES = 150;

/** Discover the test files this runner would execute. Pure: no side effects. */
export function discoverTestFiles() {
  const files = [];
  for (const rel of TEST_DIRS) {
    const abs = join(REPO_ROOT, rel);
    let entries;
    try {
      entries = readdirSync(abs);
    } catch (err) {
      // Un dossier de test absent (ex: package sans tests) est ignore, pas fatal.
      if (err && err.code === "ENOENT") {
        continue;
      }
      throw new Error(
        `run-tests: cannot read ${abs} (${(err && err.message) || err})`
      );
    }
    for (const entry of entries) {
      if (entry.endsWith(".test.js")) {
        files.push(join(rel, entry));
      }
    }
  }
  return files;
}

function main() {
  let files;
  try {
    files = discoverTestFiles();
  } catch (err) {
    process.stderr.write(`${(err && err.message) || err}\n`);
    process.exit(1);
  }

  if (files.length === 0) {
    process.stderr.write("run-tests: no .test.js files discovered\n");
    process.exit(1);
  }

  if (files.length < MINIMUM_TEST_FILES) {
    process.stderr.write(
      `run-tests: DISCOVERY COLLAPSE — found ${files.length} test files, ` +
        `expected at least ${MINIMUM_TEST_FILES}.\n` +
        `  Discovery looked in: ${TEST_DIRS.join(", ")}\n` +
        `  This is not a coverage complaint: a count this low means the discovery ` +
        `mechanism itself is broken (renamed directory, changed suffix, wrong path), ` +
        `and the tests that DID run attest nothing about the ones that were never found.\n` +
        `  If the drop is legitimate, lower MINIMUM_TEST_FILES deliberately and say why.\n`
    );
    process.exit(1);
  }

  // Wall-clock backstop. A single hanging test (e.g. a spawned mcp-serve child
  // that never closes on Windows) used to eat the CI job's full 15-minute budget
  // and get CANCELLED — a silent, mysterious failure that blocked npm publish
  // twice. Cap the whole run well under any CI job timeout so a hang fails CLEAN
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

  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    timeout: RUN_TIMEOUT_MS,
    killSignal: "SIGKILL",
    env: {
      ...process.env,
      H2A_ROOT: join(testRoot, ".h2a"),
      H2A_TEST_DURABLE_ROOT: durableRoot
    }
  });

  rmSync(testRoot, { recursive: true, force: true });

  if (result.error && result.error.code === "ETIMEDOUT") {
    process.stderr.write(
      `\nrun-tests: HUNG — the test run exceeded ${RUN_TIMEOUT_MS}ms and was killed. ` +
        `A test is not terminating (often a spawned child that never exits). ` +
        `Re-run locally with the same files to find the last test printed before this line.\n`
    );
    process.exit(124);
  }
  if (result.error) {
    process.stderr.write(`run-tests: ${result.error.message}\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

// Only run when invoked directly, so that scripts/run-test-gates.mjs can import
// TEST_DIRS / discoverTestFiles to report the run's scope without executing it.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}
