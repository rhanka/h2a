import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  IGNORED_DIRS,
  NODE_TEST_DIRS,
  TEST_FILE_SUFFIXES,
  UNCOVERED_PACKAGES,
  VITEST_SUITES,
} from "../../../scripts/test-manifest.mjs";

/**
 * The gate must not be able to go blind again.
 *
 * On 2026-07-29 the required `npm test` check on `main` ran two of the eight
 * workspace trees that carry tests. `packages/h2a-runtime` — 1141 tests over the
 * session launcher, the gateway proxy and the model catalogue — had never
 * guarded a pull request, so every "CI is green" statement in this repository
 * was narrower than it sounded. Adding the suites fixed that state. This test
 * fixes the CAUSE: a package that starts carrying tests and is not declared in
 * scripts/test-manifest.mjs fails the gate instead of joining the blind spot.
 *
 * Where this guarantee stops: it proves that every test-carrying package is
 * REACHED by the runner. It does not prove any suite is meaningful, nor that a
 * suite covers its own package well.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Expand the root `workspaces` globs into concrete package directories. */
function workspacePackages() {
  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const patterns = root.workspaces ?? [];
  const excluded = new Set(
    patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1)),
  );
  const dirs = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue;
    assert.ok(
      pattern.endsWith("/*"),
      `unsupported workspace pattern "${pattern}": teach this test to expand it`,
    );
    const parent = pattern.slice(0, -2);
    let entries;
    try {
      entries = readdirSync(join(REPO_ROOT, parent), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const rel = `${parent}/${entry.name}`;
      if (excluded.has(rel)) continue;
      dirs.push(rel);
    }
  }
  return dirs.sort();
}

/** Every test file under `rel`, ignoring build output and scratch dirs. */
function testFilesUnder(rel) {
  const found = [];
  const walk = (currentRel) => {
    let entries;
    try {
      entries = readdirSync(join(REPO_ROOT, currentRel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = `${currentRel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(childRel);
      } else if (TEST_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        found.push(childRel);
      }
    }
  };
  walk(rel);
  return found;
}

/** The packages the manifest claims to reach. */
function coveredPackages() {
  const covered = new Set();
  for (const dir of NODE_TEST_DIRS) {
    // "packages/h2a/test" -> "packages/h2a"
    covered.add(dir.split("/").slice(0, 2).join("/"));
  }
  for (const suite of VITEST_SUITES) covered.add(suite.dir);
  return covered;
}

test("every workspace package that carries tests is reached by the root gate", () => {
  const covered = coveredPackages();
  const exempted = new Map(UNCOVERED_PACKAGES.map((e) => [e.dir, e]));
  const blind = [];

  for (const pkg of workspacePackages()) {
    const files = testFilesUnder(pkg);
    if (files.length === 0) continue;
    if (covered.has(pkg) || exempted.has(pkg)) continue;
    blind.push(`${pkg} (${files.length} test files, e.g. ${files[0]})`);
  }

  assert.deepEqual(
    blind,
    [],
    `these packages carry tests that the root gate never runs:\n  ${blind.join("\n  ")}\n\n` +
      "Declare each one in scripts/test-manifest.mjs (VITEST_SUITES or NODE_TEST_DIRS).\n" +
      "If it genuinely cannot run in the gate, add it to UNCOVERED_PACKAGES with a\n" +
      "reason and a track item — never leave it undeclared.",
  );
});

test("the runner's declared trees all exist and carry tests", () => {
  for (const dir of NODE_TEST_DIRS) {
    const files = testFilesUnder(dir);
    assert.ok(
      files.some((f) => f.endsWith(".test.js")),
      `NODE_TEST_DIRS entry "${dir}" has no .test.js files — stale manifest entry`,
    );
  }
  for (const suite of VITEST_SUITES) {
    const testDir = `${suite.dir}/${suite.testDir ?? "src"}`;
    assert.ok(
      statSync(join(REPO_ROOT, testDir), { throwIfNoEntry: false })?.isDirectory(),
      `VITEST_SUITES entry "${suite.name}" points at a missing dir: ${testDir}`,
    );
    const files = testFilesUnder(testDir);
    assert.ok(
      files.some((f) => f.endsWith(".test.ts") || f.endsWith(".spec.ts")),
      `VITEST_SUITES entry "${suite.name}" has no .test.ts/.spec.ts files under ${testDir}`,
    );
  }
});

test("no exemption outlives its reason", () => {
  const covered = coveredPackages();
  for (const entry of UNCOVERED_PACKAGES) {
    assert.ok(entry.reason, `UNCOVERED_PACKAGES entry "${entry.dir}" has no reason`);
    assert.ok(
      entry.trackItem,
      `UNCOVERED_PACKAGES entry "${entry.dir}" has no track item to close it`,
    );
    assert.ok(
      !covered.has(entry.dir),
      `"${entry.dir}" is exempted AND covered — remove the stale exemption`,
    );
    assert.ok(
      testFilesUnder(entry.dir).length > 0,
      `"${entry.dir}" is exempted but carries no tests — remove the stale exemption`,
    );
  }
});
