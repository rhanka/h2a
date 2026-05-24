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
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const TEST_DIRS = ["packages/h2a/test", "packages/h2a-cli/test"];

const files = [];
for (const rel of TEST_DIRS) {
  const abs = join(REPO_ROOT, rel);
  let entries;
  try {
    entries = readdirSync(abs);
  } catch (err) {
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

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: REPO_ROOT,
  stdio: "inherit"
});

if (result.error) {
  process.stderr.write(`run-tests: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
