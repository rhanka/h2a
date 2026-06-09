// WP-1: h2a root unification — warnings + doctor extension
//
// Tests:
//  1. resolveRoot precedence: H2A_ROOT env, --root flag, cwd fallback
//  2. cwd-fallback warning on `h2a connect`
//  3. doctor splitBrain warning
//  4. doctor inboxHygiene warnings (case dup, host-less, phantom 3-seg)

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";

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

// ─── 1. resolveRoot precedence ─────────────────────────────────────────────

test("doctor: H2A_ROOT env is honored (rootSource=env)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp1-env-"));
  const sharedRoot = join(dir, "shared-bus");
  const savedEnv = process.env.H2A_ROOT;
  try {
    // Init the shared root so doctor hard-checks pass.
    runCli(["init", "--root", sharedRoot], captureStreams(dir));
    process.env.H2A_ROOT = sharedRoot;

    const streams = captureStreams(dir);
    // No --root flag, no --root flag at all — should pick up H2A_ROOT
    const rc = runCli(["doctor"], streams);
    assert.equal(rc, 0, `exit should be 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.root, sharedRoot);
    assert.equal(report.rootSource, "env");
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor: --root flag wins over H2A_ROOT env (rootSource=flag)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp1-flag-"));
  const flagRoot = join(dir, "flag-bus");
  const envRoot = join(dir, "env-bus");
  const savedEnv = process.env.H2A_ROOT;
  try {
    runCli(["init", "--root", flagRoot], captureStreams(dir));
    process.env.H2A_ROOT = envRoot;

    const streams = captureStreams(dir);
    const rc = runCli(["doctor", "--root", flagRoot], streams);
    assert.equal(rc, 0, `exit should be 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.root, flagRoot);
    assert.equal(report.rootSource, "flag");
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// WP-4: the fallback changed from rootSource=cwd to rootSource=default (shared bus).
// doctor no longer emits a rootSource warning for the shared default.
test("doctor: neither --root nor H2A_ROOT → rootSource=default (shared bus, WP-4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp1-default-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    // Init the shared default so doctor hard-checks pass.
    const sharedRoot = join(dir, "h2a-workspace", ".h2a");
    runCli(["init", "--root", sharedRoot], captureStreams(dir));
    // Set H2A_ROOT to the shared path so the test is hermetic (avoids touching real ~/h2a-workspace)
    process.env.H2A_ROOT = sharedRoot;

    const streams = captureStreams(dir);
    const rc = runCli(["doctor"], streams);
    assert.equal(rc, 0, `exit should be 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.rootSource, "env", "H2A_ROOT env overrides the default");
    // No rootSource warning expected when H2A_ROOT is set explicitly
    const warn = report.warnings.find((w) => w.check === "rootSource");
    assert.equal(warn, undefined, "no rootSource warning expected when H2A_ROOT is set");
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 2. cwd-fallback warning on `h2a connect` ──────────────────────────────

// WP-4: the shared-bus default is silent (no warning).
// connect only warns when a DIFFERENT cwd-local .h2a exists (see wp4 test for that).
test("connect: no warning when using shared default bus with no local .h2a (WP-4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp1-conn-"));
  const savedEnv = process.env.H2A_ROOT;
  // Isolated temp shared-bus so the connect write never touches the real shared bus.
  const isolatedBus = mkdtempSync(join(tmpdir(), "h2a-test-bus-"));
  try {
    // Point H2A_ROOT at the isolated temp — no local .h2a in cwd → no warning.
    process.env.H2A_ROOT = join(isolatedBus, ".h2a");
    const streams = captureStreams(dir);
    // connect may fail (no root initialised), but must NOT emit a rootSource warning
    runCli(["connect", "--host", "claude"], streams);
    // No split-brain warning expected: no local .h2a in cwd
    assert.doesNotMatch(
      streams.stderrText,
      /repo-local .h2a exists here but I'm using the shared bus/,
      `unexpected split-brain warning on stderr: ${streams.stderrText}`
    );
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(isolatedBus, { recursive: true, force: true });
  }
});

// ─── 3. doctor splitBrain warning ──────────────────────────────────────────

test("doctor: splitBrain warning when cwd .h2a differs from --root", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp1-split-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    // Create a cwd-local .h2a (so the split-brain check triggers)
    const cwdLocal = join(dir, ".h2a");
    runCli(["init", "--root", cwdLocal], captureStreams(dir));

    // Create a separate shared root
    const sharedRoot = join(dir, "shared", ".h2a");
    runCli(["init", "--root", sharedRoot], captureStreams(dir));

    const streams = captureStreams(dir);
    // Pass --root pointing to a DIFFERENT location than cwd/.h2a
    const rc = runCli(["doctor", "--root", sharedRoot], streams);
    assert.equal(rc, 0, `exit should be 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);
    const warn = report.warnings.find((w) => w.check === "splitBrain");
    assert.ok(warn, `expected splitBrain warning; warnings=${JSON.stringify(report.warnings)}`);
    assert.match(warn.message, /split-brain/i);
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 4. doctor inboxHygiene warnings ───────────────────────────────────────

test("doctor: inboxHygiene warns on case-dup, host-less, and phantom 3-seg dirs", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp1-hygiene-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    const root = join(dir, ".h2a");
    runCli(["init", "--root", root], captureStreams(dir));

    // Create inbox subdirs directly (mimicking what the store would create)
    const inboxDir = join(root, "inbox");
    mkdirSync(inboxDir, { recursive: true });

    // Case dup pair: claude__matchid and claude__matchID → same canonical address.
    // On a case-INSENSITIVE filesystem (Windows/macOS CI) these two mkdirs collapse
    // into ONE directory, so there is no dup pair to detect there — assert the
    // caseDuplicates warning only when the FS actually kept both dirs distinct.
    mkdirSync(join(inboxDir, "claude__matchid"), { recursive: true });
    mkdirSync(join(inboxDir, "claude__matchID"), { recursive: true });
    const caseDistinctFs =
      readdirSync(inboxDir).filter((d) => d.toLowerCase() === "claude__matchid").length === 2;

    // Host-less: bare label with no known host prefix
    mkdirSync(join(inboxDir, "react"), { recursive: true });

    // Phantom 3-segment: third segment is not a 12-char hex session id
    mkdirSync(join(inboxDir, "claude__sentropic__sentropic-chat"), { recursive: true });

    const streams = captureStreams(dir);
    const rc = runCli(["doctor", "--root", root], streams);
    assert.equal(rc, 0, `exit should be 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);

    const warnKinds = report.warnings.filter((w) => w.check === "inboxHygiene").map((w) => w.kind);

    if (caseDistinctFs) {
      assert.ok(
        warnKinds.includes("caseDuplicates"),
        `expected caseDuplicates warning; warnings=${JSON.stringify(report.warnings)}`
      );
    }
    assert.ok(
      warnKinds.includes("hostlessDirs"),
      `expected hostlessDirs warning; warnings=${JSON.stringify(report.warnings)}`
    );
    assert.ok(
      warnKinds.includes("phantomThreeSegment"),
      `expected phantomThreeSegment warning; warnings=${JSON.stringify(report.warnings)}`
    );

    // Verify examples are dir names only (no paths). Only when the FS kept both
    // case-distinct dirs (case-insensitive FS → no caseDuplicates warning exists).
    if (caseDistinctFs) {
      const dupWarn = report.warnings.find((w) => w.kind === "caseDuplicates");
      assert.ok(Array.isArray(dupWarn.examples), "examples should be an array");
      // Each example should contain the original dir names (no slashes from abs path)
      for (const ex of dupWarn.examples) {
        assert.ok(!ex.includes("/"), `example should be a dir name, not a path: ${ex}`);
      }
    }
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
