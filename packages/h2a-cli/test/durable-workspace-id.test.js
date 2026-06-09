/**
 * Tests for durable git-based workspace id.
 *
 * Suite 1 — PURE (no git, no fs): computeDurableWorkspaceId
 *   Deterministic, stable, regression-pinned expected hashes.
 *
 * Suite 2 — GIT SMOKE (skipped gracefully if git is unavailable):
 *   - init a temp repo, assert ws: prefix
 *   - copy/move to a second path, assert IDENTICAL id (path-independence)
 *   - a non-git dir returns undefined
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  computeDurableWorkspaceId,
  durableWorkspaceId
} from "../dist/index.js";

// ---------------------------------------------------------------------------
// Suite 1 — PURE
// ---------------------------------------------------------------------------

test("computeDurableWorkspaceId: deterministic and stable (regression pin vector 1)", () => {
  // Fixed expected: sha256("abc\n") => edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb
  const expected =
    "ws:edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb";
  assert.equal(computeDurableWorkspaceId("abc", ""), expected);
  // Calling again must produce the exact same value (deterministic).
  assert.equal(computeDurableWorkspaceId("abc", ""), expected);
});

test("computeDurableWorkspaceId: regression pin vector 2 (different rootCommit)", () => {
  // sha256("def\n") => da1464fd7ceaf38ff56043bc1774af4fb5cb83ef5358981d78de0b8be5a6fbcb
  const expected =
    "ws:da1464fd7ceaf38ff56043bc1774af4fb5cb83ef5358981d78de0b8be5a6fbcb";
  assert.equal(computeDurableWorkspaceId("def", ""), expected);
});

test("computeDurableWorkspaceId: different rootCommit → different id", () => {
  const a = computeDurableWorkspaceId("abc", "");
  const b = computeDurableWorkspaceId("def", "");
  assert.notEqual(a, b);
});

test("computeDurableWorkspaceId: same rootCommit + different worktreeRelPath → different id", () => {
  const main = computeDurableWorkspaceId("abc", "");
  const linked = computeDurableWorkspaceId("abc", "my-feature");
  assert.notEqual(main, linked);
  // Regression pin for the linked worktree case.
  assert.equal(
    linked,
    "ws:81a25e53c1b1c56cc708a5fed4958388aeaef6c611b18e01d61c4a21a5e61820"
  );
});

test("computeDurableWorkspaceId: result always starts with ws:", () => {
  assert.match(computeDurableWorkspaceId("abc", ""), /^ws:/);
  assert.match(computeDurableWorkspaceId("abc", "linked"), /^ws:/);
});

// ---------------------------------------------------------------------------
// Suite 2 — GIT SMOKE (skip gracefully if git not available)
// ---------------------------------------------------------------------------

function gitAvailable() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize a bare-minimum git repo suitable for the smoke test.
 * Configures a local user so `git commit` works in CI with no global config.
 */
function initRepo(dir) {
  const opts = { cwd: dir, stdio: "ignore", timeout: 10000 };
  execFileSync("git", ["init"], opts);
  execFileSync("git", ["config", "user.email", "test@example.com"], opts);
  execFileSync("git", ["config", "user.name", "Test"], opts);
  // Create a minimal initial commit so HEAD and rev-list work.
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], opts);
}

test("durableWorkspaceId git smoke: returns ws: value and is path-independent", () => {
  if (!gitAvailable()) {
    // Skip gracefully — no git on this machine / CI agent.
    return;
  }

  const dir1 = mkdtempSync(join(tmpdir(), "h2a-ws-smoke1-"));
  const dir2 = mkdtempSync(join(tmpdir(), "h2a-ws-smoke2-"));
  try {
    // Initialise repo in dir1.
    initRepo(dir1);
    const id1 = durableWorkspaceId(dir1);
    assert.ok(
      typeof id1 === "string" && id1.startsWith("ws:"),
      `expected a ws: string, got ${id1}`
    );

    // Copy the repo to dir2 (simulates a clone at a different path).
    cpSync(dir1, dir2, { recursive: true });
    const id2 = durableWorkspaceId(dir2);

    assert.equal(
      id2,
      id1,
      "same git history at a different path must produce the SAME workspace id (path-independence)"
    );
  } finally {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
});

test("durableWorkspaceId git smoke: non-git directory returns undefined", () => {
  if (!gitAvailable()) {
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "h2a-ws-nongit-"));
  try {
    const result = durableWorkspaceId(dir);
    assert.equal(result, undefined, "non-git dir must return undefined");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
