import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), "velocity-install-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeEvidence(dir) {
  const evidence = {
    targetId: "ci",
    installStartedAt: "2026-10-18T10:05:00Z",
    installCompletedAt: "2026-10-18T10:05:00Z",
    smokeCompletedAt: "2026-10-18T10:06:00Z",
    installOutcome: "success",
    smokeOutcome: "success",
    expectedVersion: "0.98.7",
    observedVersion: "0.98.7",
    expectedTuple: "h2a-0.98.7.tgz",
    observedTuple: "h2a-0.98.7.tgz",
    artifactIntegrity: `sha256:${"a".repeat(64)}`,
    resolvedExecutable: "/tmp/prefix/bin/h2a",
    repo: "rhanka/h2a",
    lotOccurrence: "L1",
    mergeSha: "a".repeat(40),
    releaseSourceSha: "b".repeat(40),
  };
  const path = join(dir, "smoke-evidence.json");
  writeFileSync(path, JSON.stringify(evidence));
  return path;
}

test("producer to attestation to actual replays a target install receipt", (t) => {
  const dir = tempRoot(t);
  const evidence = writeEvidence(dir);
  const plan = join(dir, "plan.json");
  writeFileSync(plan, JSON.stringify({ repo: "rhanka/h2a", lotOccurrence: "L1", mergeSha: "a".repeat(40), targetId: "ci" }));
  const out = join(dir, "installations", "ci.json");
  const child = spawnSync(
    process.execPath,
    [
      "scripts/record-velocity-install.mjs",
      "--plan", plan,
      "--target", "ci",
      "--evidence", evidence,
      "--out", out,
    ],
    { cwd: join(import.meta.dirname, "..", "..", ".."), encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  const receipt = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(receipt.installedAt, "2026-10-18T10:06:00Z");
  assert.equal(receipt.mergeToInstalledSeconds, 360);
});

test("missing evidence leaves the target unknown with no sample", (t) => {
  const dir = tempRoot(t);
  const out = join(dir, "installations", "ci.json");
  const child = spawnSync(
    process.execPath,
    ["scripts/record-velocity-install.mjs", "--plan", join(dir, "missing-plan.json"), "--target", "ci", "--evidence", join(dir, "missing.json"), "--out", out],
    { cwd: join(import.meta.dirname, "..", "..", ".."), encoding: "utf8" },
  );
  assert.notEqual(child.status, 0);
});

test("a CI-runner receipt never proves the workstation target", (t) => {
  const dir = tempRoot(t);
  const evidence = writeEvidence(dir);
  const plan = join(dir, "plan.json");
  writeFileSync(plan, JSON.stringify({ repo: "rhanka/h2a", lotOccurrence: "L1", mergeSha: "a".repeat(40), targetId: "workstation" }));
  const out = join(dir, "installations", "workstation.json");
  mkdirSync(join(dir, "installations"), { recursive: true });
  const child = spawnSync(
    process.execPath,
    ["scripts/record-velocity-install.mjs", "--plan", plan, "--target", "workstation", "--evidence", evidence, "--out", out],
    { cwd: join(import.meta.dirname, "..", "..", ".."), encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  const receipt = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(receipt.installedAt, "unknown");
});
