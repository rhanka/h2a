#!/usr/bin/env node
/**
 * Cross-platform test runner. Used by `npm test`.
 *
 * Shell glob expansion (`packages/h2a/test/*.test.js`) is fine on bash but
 * silently breaks on PowerShell (Windows runners), where the literal asterisk
 * is forwarded to node. This runner discovers the `*.test.js` files itself
 * using `node:fs`, so it behaves identically on Linux, macOS and Windows.
 *
 * Discovers test files under:
 *   - packages/h2a/test/
 *   - packages/h2a-cli/test/
 *
 * Then invokes `node --test <file1> <file2> ...` and forwards the exit code.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// A1: la suite vit dans packages/h2a/test (h2a-cli est un stub deprecie, sans tests).
const TEST_DIRS = ["packages/h2a/test"];

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
    process.stderr.write(
      `run-tests: cannot read ${abs} (${(err && err.message) || err})\n`
    );
    process.exit(1);
  }
  for (const entry of entries) {
    if (entry.endsWith(".test.js")) {
      files.push(join(rel, entry));
    }
  }
}

if (files.length === 0) {
  process.stderr.write("run-tests: no .test.js files discovered\n");
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
const testRoot = mkdtempSync(join(tmpdir(), "h2a-test-root-"));

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  timeout: RUN_TIMEOUT_MS,
  killSignal: "SIGKILL",
  env: { ...process.env, H2A_ROOT: join(testRoot, ".h2a") }
});

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
