// WP7 (backlog item "x1"): SAFE sweep of leftover repo-local .h2a buses.
//
// `h2a doctor --scan <dir>` finds immediate-child `.h2a` buses under a
// directory (e.g. a directory of cloned repos) and reports them as
// candidate split-brain forks. `--prune` deletes them — but ONLY the
// ORPHAN ones (no live/fresh presence heartbeat). A bus with any live
// session must NEVER be deleted, --prune or not.
//
// Tests:
//  1. dry-run (--scan, no --prune): lists both buses, classifies orphan vs
//     live correctly, deletes nothing.
//  2. --prune: deletes the orphan bus, leaves the live bus untouched, and
//     report.pruned reflects exactly what was removed.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore, runCli, writePresence } from "../dist/index.js";

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; }
  };
}

/**
 * Build a scan directory with two repo-local stray buses:
 *  - <scanDir>/repo-orphan/.h2a — a bare/empty bus, no live presence.
 *  - <scanDir>/repo-live/.h2a   — a bus with one fresh presence heartbeat.
 * Returns their absolute .h2a paths.
 */
function makeFixture(scanDir) {
  const orphanBus = join(scanDir, "repo-orphan", ".h2a");
  const liveBus = join(scanDir, "repo-live", ".h2a");

  // Orphan: a leftover bus dir with no presence at all (the common case for
  // a stray init from a past session that was never cleaned up).
  mkdirSync(orphanBus, { recursive: true });

  // Live: a properly-initialised store with a fresh heartbeat.
  createLocalStore({ root: liveBus });
  writePresence(liveBus, {
    sessionId: "sess:live-in-stray-bus",
    instance: "claude:repo-live:aaaaaaaaaaaa",
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: []
  });

  return { orphanBus, liveBus };
}

test("doctor --scan (dry-run): lists orphan + live stray buses, deletes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp7-dry-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    const root = join(dir, "bus", ".h2a");
    runCli(["init", "--root", root], captureStreams(dir));

    const scanDir = join(dir, "repos");
    mkdirSync(scanDir, { recursive: true });
    const { orphanBus, liveBus } = makeFixture(scanDir);

    const streams = captureStreams(dir);
    const rc = runCli(["doctor", "--root", root, "--scan", scanDir], streams);
    assert.equal(rc, 0, `exit should be 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);

    const warn = report.warnings.find((w) => w.check === "strayBuses");
    assert.ok(warn, `expected strayBuses warning; warnings=${JSON.stringify(report.warnings)}`);
    assert.equal(warn.count, 2);
    assert.equal(warn.orphanCount, 1, JSON.stringify(warn));
    assert.equal(warn.liveCount, 1, JSON.stringify(warn));

    const orphanEntry = warn.buses.find((b) => b.path === orphanBus);
    const liveEntry = warn.buses.find((b) => b.path === liveBus);
    assert.ok(orphanEntry, "orphan bus should be listed");
    assert.ok(liveEntry, "live bus should be listed");
    assert.equal(orphanEntry.orphan, true);
    assert.equal(orphanEntry.live, false);
    assert.equal(liveEntry.orphan, false);
    assert.equal(liveEntry.live, true);

    // Dry-run (no --prune): report.pruned is absent, nothing was deleted.
    assert.equal(report.pruned, undefined, "dry-run must not report a pruned list");
    assert.ok(existsSync(orphanBus), "dry-run must not delete the orphan bus");
    assert.ok(existsSync(liveBus), "dry-run must not delete the live bus");
  } finally {
    if (savedEnv === undefined) delete process.env.H2A_ROOT;
    else process.env.H2A_ROOT = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor --scan --prune: deletes ONLY the orphan stray bus, leaves the live one untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp7-prune-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    const root = join(dir, "bus", ".h2a");
    runCli(["init", "--root", root], captureStreams(dir));

    const scanDir = join(dir, "repos");
    mkdirSync(scanDir, { recursive: true });
    const { orphanBus, liveBus } = makeFixture(scanDir);

    const streams = captureStreams(dir);
    const rc = runCli(["doctor", "--root", root, "--scan", scanDir, "--prune"], streams);
    assert.equal(rc, 0, `exit should be 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);

    // The orphan bus is gone; the live bus survives untouched.
    assert.ok(!existsSync(orphanBus), "orphan bus must be removed by --prune");
    assert.ok(existsSync(liveBus), "live bus must NEVER be removed, even with --prune");

    // report.pruned lists exactly the orphan bus, not the live one.
    assert.ok(Array.isArray(report.pruned), "report.pruned should be an array with --prune");
    const prunedPaths = report.pruned.map((p) => p.path);
    assert.ok(prunedPaths.includes(orphanBus), `expected ${orphanBus} in pruned list`);
    assert.ok(!prunedPaths.includes(liveBus), `live bus must not appear in pruned list`);

    // stderr notes the live bus was skipped (visible operator signal).
    assert.match(streams.stderrText, /skipped 1 stray bus\(es\) with live presence/);
    assert.ok(streams.stderrText.includes(liveBus), "skip message should name the live bus path");
  } finally {
    if (savedEnv === undefined) delete process.env.H2A_ROOT;
    else process.env.H2A_ROOT = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor --scan --prune on an all-orphan scan dir: prunes both, no live-skip message", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp7-allorphan-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    const root = join(dir, "bus", ".h2a");
    runCli(["init", "--root", root], captureStreams(dir));

    const scanDir = join(dir, "repos");
    const busA = join(scanDir, "repo-a", ".h2a");
    const busB = join(scanDir, "repo-b", ".h2a");
    mkdirSync(busA, { recursive: true });
    mkdirSync(busB, { recursive: true });

    const streams = captureStreams(dir);
    const rc = runCli(["doctor", "--root", root, "--scan", scanDir, "--prune"], streams);
    assert.equal(rc, 0, `exit should be 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);

    assert.ok(!existsSync(busA));
    assert.ok(!existsSync(busB));
    const prunedPaths = report.pruned.map((p) => p.path);
    assert.ok(prunedPaths.includes(busA) && prunedPaths.includes(busB));
    assert.ok(
      !streams.stderrText.includes("skipped"),
      `no live buses in this fixture — no skip message expected: ${streams.stderrText}`
    );
  } finally {
    if (savedEnv === undefined) delete process.env.H2A_ROOT;
    else process.env.H2A_ROOT = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});
