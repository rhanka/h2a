/**
 * SPEC 0.98.5 R8.3 — regression gate for the packaged-artifact smoke
 * (scripts/smoke-artifact.mjs), the release-time proof that runs in `verify`.
 *
 * Round-2 review findings this file pins shut — each was reproduced by the
 * reviewer against the committed smoke:
 *   - the runtime manifest did not export `./package.json`, so the smoke's
 *     own path proof (`require.resolve('@sentropic/h2a-runtime/package.json')`)
 *     could not resolve from the installed prefix;
 *   - the cold-boot fixture persisted the RAW `/proc/self/ns/pid` magic
 *     symlink (`pid:[4026531836]`) while the production reader
 *     (readPidNamespaceId) returns the bare numeric inode — a malformed store
 *     value, foreign-frame under R1, refusing the very cold boot it seeds;
 *   - the smoke compared the loaded version to the CANDIDATE version instead
 *     of the pinned literal 0.98.5 (R8.3(4) pins the literal);
 *   - scenario 7 destroyed the stderr reader AFTER a prune that ran at delay
 *     zero — no write-after-close was exercised — and scenario 8 proved only
 *     a ping after the fault.
 *
 * Runs via `npm test` (packages/h2a/test discovery). No silent skip: a missing
 * manifest, an unreadable /proc, or an absent smoke script are FAILURES.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SMOKE_PATH = resolve(REPO_ROOT, "scripts", "smoke-artifact.mjs");
let SMOKE_SOURCE;
let MANIFEST;
try {
  SMOKE_SOURCE = readFileSync(SMOKE_PATH, "utf8");
  MANIFEST = JSON.parse(readFileSync(resolve(REPO_ROOT, "packages", "h2a-runtime", "package.json"), "utf8"));
} catch (error) {
  assert.fail(`the smoke script and the runtime manifest must exist and be readable: ${error.message}`);
}

test("R8.3: the runtime manifest must let the smoke prove the loaded path (./package.json subpath export)", () => {
  // The proof is resolution from an INSTALLED prefix, not from the workspace:
  // the reviewer reproduced the defect by installing the real manifest into a
  // temp prefix and resolving from there.
  const root = mkdtempSync(join(tmpdir(), "h2a-smoke-manifest-"));
  try {
    const packageDir = join(root, "node_modules", "@sentropic", "h2a-runtime");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify(MANIFEST));
    const fromPrefix = createRequire(join(root, "probe.cjs"));
    assert.doesNotThrow(
      () => fromPrefix.resolve("@sentropic/h2a-runtime/package.json"),
      "the smoke path proof requires the ./package.json subpath export; without it the proof step is red and the smoke fails",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R8.3: the smoke stores the pid namespace as the production reader does — the numeric inode, never the raw symlink", async () => {
  assert.ok(
    SMOKE_SOURCE.includes('const inode = /\\[(\\d+)\\]/.exec(link)'),
    "the smoke must extract the numeric inode from the readlink before creating rows: the store-side pidNamespace is pinned /^\\d+$/ by R1",
  );
  const link = await readlink("/proc/self/ns/pid");
  const inode = /\[(\d+)\]/.exec(link)?.[1];
  assert.ok(inode, `/proc/self/ns/pid must be readable and carry a numeric inode (got: ${link})`);
  assert.match(
    inode,
    /^\d+$/,
    "the store-side representation is the bare inode — the exact value readPidNamespaceId() returns",
  );
  assert.notEqual(
    inode,
    link,
    "the raw magic symlink (pid:[NNN]) is NOT the stored representation: a row persisted with it is malformed store data, classified foreign-frame, and the cold boot is refused",
  );
});

test("R8.3: the smoke proves the pinned literal version 0.98.5, never 'whatever the candidate is'", () => {
  assert.match(
    SMOKE_SOURCE,
    /const PINNED_RUNTIME_VERSION = '0\.98\.5'/,
    "R8.3(4) pins the literal: version === 0.98.5",
  );
  assert.ok(
    SMOKE_SOURCE.includes("loadedVersion !== PINNED_RUNTIME_VERSION"),
    "the loaded version must be compared to the pinned literal",
  );
  assert.ok(
    !SMOKE_SOURCE.includes("loadedVersion !== runtimeVersion"),
    "comparing to the candidate version reopens the hole: a registry fallback to a previously published version of the same range would pass",
  );
});

test("R8.3: scenario 7 closes the stderr reader BEFORE the deferred prune, and every fault is followed by a PTY proof", () => {
  const destroyAt = SMOKE_SOURCE.indexOf("stderrHost.stderr.destroy()");
  const delayedExitAt = SMOKE_SOURCE.indexOf("setTimeout(() => process.exit(0), 4000)");
  const pruneAt = SMOKE_SOURCE.indexOf("await waitForPrune(");
  assert.ok(destroyAt !== -1, "the smoke must destroy the stderr reader explicitly");
  assert.ok(delayedExitAt !== -1, "the scenario-7 session must be alive when the reader dies: a session that already exited proves no write-after-close");
  assert.ok(pruneAt !== -1, "the prune must be OBSERVED (registry row disappearing), not assumed by a fixed delay");
  assert.ok(
    delayedExitAt < destroyAt,
    "the session must exist before the destroy, so its deferred prune lands AFTER the close",
  );
  assert.ok(
    destroyAt < pruneAt,
    "the prune observation must follow the destroy: a prune observed before the close exercised nothing",
  );
  assert.ok(
    SMOKE_SOURCE.includes("provePtyOperation(cold, goodClient, 'smoke-pty-after-fault')"),
    "scenario 8 must prove a PTY operation after the faulty client, not only a ping",
  );
  assert.ok(
    SMOKE_SOURCE.includes("provePtyOperation(stderrLab, survivalClient, 'smoke-pty-after-stderr-fault')"),
    "scenario 7 must prove a PTY operation after the stderr fault, not only a ping",
  );
});

test("R8.3: the smoke stays isolated — temp parents only, no real host state", () => {
  assert.ok(SMOKE_SOURCE.includes("mkdtempSync"), "the smoke must build its labs under mkdtemp'd parents");
  for (const forbidden of ["/run/user/1000", '".config/sentropic"', '".local/state"']) {
    assert.ok(
      !SMOKE_SOURCE.includes(forbidden),
      `the smoke must not reference real host state paths (${forbidden})`,
    );
  }
});
