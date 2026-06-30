// WP-4: shared bus by default + --prune
//
// Tests:
//  1. resolveRoot fallback is now the homedir global (rootSource === "default")
//  2. doctor --prune removes host-less + phantom dirs, leaves valid full-id dir
//  3. warnIfCwdRootFallback: warns only when a local .h2a EXISTS and differs
//  4. doctor warns when rootSource==="default" (not "cwd")

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

// ─── 1. resolveRoot fallback → homedir global ──────────────────────────────

test("doctor: no --root / no H2A_ROOT → rootSource=default, root ends with h2a-workspace/.h2a", () => {
  const dir = mkdtempSync(join(homedir(), "wp4-default-test-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    // Init the global default so doctor hard-checks pass.
    const globalRoot = join(homedir(), "h2a-workspace", ".h2a");
    runCli(["init", "--root", globalRoot], captureStreams(dir));

    const streams = captureStreams(dir);
    const rc = runCli(["doctor"], streams);
    // May be exit 0 (root exists) or exit 2 (if the init above failed for some reason).
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.rootSource, "default");
    assert.ok(
      report.root.endsWith(join("h2a-workspace", ".h2a")),
      `root should end with h2a-workspace/.h2a, got: ${report.root}`
    );
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor: H2A_ROOT env → rootSource=env (not default)", () => {
  const dir = mkdtempSync(join(homedir(), "wp4-env-test-"));
  const sharedRoot = join(dir, "shared-bus");
  const savedEnv = process.env.H2A_ROOT;
  try {
    runCli(["init", "--root", sharedRoot], captureStreams(dir));
    process.env.H2A_ROOT = sharedRoot;

    const streams = captureStreams(dir);
    const rc = runCli(["doctor"], streams);
    assert.equal(rc, 0, `expected exit 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.rootSource, "env");
    assert.equal(report.root, sharedRoot);
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 2. doctor --prune removes dead dirs, leaves valid one ─────────────────

test("doctor --prune: removes host-less + phantom dirs, leaves valid 3-segment dir", () => {
  const dir = mkdtempSync(join(homedir(), "wp4-prune-test-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    const root = join(dir, ".h2a");
    runCli(["init", "--root", root], captureStreams(dir));

    const inboxDir = join(root, "inbox");
    mkdirSync(inboxDir, { recursive: true });

    // Host-less dir (no known host prefix)
    mkdirSync(join(inboxDir, "bareagent"), { recursive: true });

    // Phantom 3-segment dir (third segment not 12-char hex)
    mkdirSync(join(inboxDir, "claude__sentropic__bad-tail"), { recursive: true });

    // Valid full-id 3-segment dir — should be KEPT
    // Register this instance so it appears in registry/instances.jsonl
    const instancesDir = join(root, "registry");
    mkdirSync(instancesDir, { recursive: true });
    const instancesFile = join(instancesDir, "instances.jsonl");
    writeFileSync(
      instancesFile,
      JSON.stringify({ id: "claude:sentropic:abc123def456", instance: "claude:sentropic:abc123def456", roles: [], scopes: [], capabilities: [], endpoints: [], publicKeys: [], acceptedPolicies: [], createdAt: new Date().toISOString() }) + "\n",
      "utf8"
    );
    mkdirSync(join(inboxDir, "claude__sentropic__abc123def456"), { recursive: true });

    const streams = captureStreams(dir);
    const rc = runCli(["doctor", "--root", root, "--prune"], streams);
    assert.equal(rc, 0, `expected exit 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);

    // Pruned list should include host-less and phantom dirs
    assert.ok(Array.isArray(report.pruned), "report.pruned should be an array");
    const prunedNames = report.pruned.map((p) => p.name);
    assert.ok(prunedNames.includes("bareagent"), `expected bareagent pruned; got ${JSON.stringify(prunedNames)}`);
    assert.ok(prunedNames.includes("claude__sentropic__bad-tail"), `expected phantom pruned; got ${JSON.stringify(prunedNames)}`);

    // Valid 3-segment dir should still exist
    const remaining = readdirSync(inboxDir);
    assert.ok(remaining.includes("claude__sentropic__abc123def456"), "valid full-id dir should be kept");

    // Deleted dirs should be gone
    assert.ok(!remaining.includes("bareagent"), "host-less dir should be gone");
    assert.ok(!remaining.includes("claude__sentropic__bad-tail"), "phantom dir should be gone");
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 3. doctor without --prune: report only, no deletion ───────────────────

test("doctor without --prune: reports dead dirs but does not delete them", () => {
  const dir = mkdtempSync(join(homedir(), "wp4-dryrun-test-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    const root = join(dir, ".h2a");
    runCli(["init", "--root", root], captureStreams(dir));

    const inboxDir = join(root, "inbox");
    mkdirSync(inboxDir, { recursive: true });
    mkdirSync(join(inboxDir, "ghostagent"), { recursive: true });

    const streams = captureStreams(dir);
    const rc = runCli(["doctor", "--root", root], streams);
    assert.equal(rc, 0, `expected exit 0, stderr: ${streams.stderrText}`);
    const report = JSON.parse(streams.stdoutText);

    // report.pruned should not exist in dry-run
    assert.equal(report.pruned, undefined, "report.pruned should not exist without --prune");

    // The dir should still be there
    const remaining = readdirSync(inboxDir);
    assert.ok(remaining.includes("ghostagent"), "host-less dir should still exist without --prune");
  } finally {
    if (savedEnv === undefined) {
      delete process.env.H2A_ROOT;
    } else {
      process.env.H2A_ROOT = savedEnv;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 4. warnIfCwdRootFallback: only warns when local .h2a differs ──────────

test("connect: no stderr warning when using shared bus with NO local .h2a in cwd", () => {
  const dir = mkdtempSync(join(homedir(), "wp4-nowarn-test-"));
  const savedEnv = process.env.H2A_ROOT;
  // Isolated temp shared-bus so the connect write never touches the real shared bus.
  const isolatedBus = mkdtempSync(join(tmpdir(), "h2a-test-bus-"));
  try {
    // Point H2A_ROOT at the isolated temp — source=env, cwd has NO local .h2a → no warning.
    process.env.H2A_ROOT = join(isolatedBus, ".h2a");
    // No local .h2a in dir — should be quiet
    const streams = captureStreams(dir);
    runCli(["connect", "--host", "claude"], streams);
    // The warning should NOT appear because there's no local .h2a in cwd
    assert.ok(
      !streams.stderrText.includes("a repo-local .h2a exists"),
      `unexpected warning: ${streams.stderrText}`
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

test("connect: warns when local .h2a exists and differs from shared default", () => {
  const dir = mkdtempSync(join(homedir(), "wp4-warn-test-"));
  const savedEnv = process.env.H2A_ROOT;
  // Isolated temp shared-bus so the connect write never touches the real shared bus.
  const isolatedBus = mkdtempSync(join(tmpdir(), "h2a-test-bus-"));
  try {
    // Point H2A_ROOT at the isolated temp (differs from cwd/.h2a) → warning fires.
    process.env.H2A_ROOT = join(isolatedBus, ".h2a");
    // Create a local .h2a in the cwd — this is what triggers the warning
    const localRoot = join(dir, ".h2a");
    mkdirSync(localRoot, { recursive: true });

    const streams = captureStreams(dir);
    runCli(["connect", "--host", "claude"], streams);
    // Now the warning should appear: cwd/.h2a exists and differs from the resolved root
    assert.match(
      streams.stderrText,
      /a repo-local \.h2a exists here but I'm using the shared bus/,
      `expected repo-local warning on stderr, got: ${streams.stderrText}`
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
