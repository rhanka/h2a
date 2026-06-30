import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import test from "node:test";

import { runCli, sanitizeStorePaths } from "../dist/index.js";

// These tests seed a *legacy* store whose ids contain `:` used directly as
// directory/file names (the pre-DEC-062 layout). Windows forbids `:` in path
// names, so such a store can never have been created there in the first
// place — the migration pass (DEC-064) is a POSIX-only concern. We skip the
// colon-seeding tests on Windows and track it as a known, intentional gap.
const skipOnWindows =
  platform === "win32"
    ? { skip: "Windows: legacy `:`-named stores are POSIX-only (DEC-062/064)" }
    : {};

function legacyStore() {
  const root = mkdtempSync(join(tmpdir(), "h2a-legacy-"));
  // Simulate a pre-DEC-062 store: ids with `:` used directly as dir/file names.
  mkdirSync(join(root, "negotiations", "nego:codex"), { recursive: true });
  writeFileSync(join(root, "negotiations", "nego:codex", "journal.jsonl"), "");
  mkdirSync(join(root, "inbox", "claude:proj-1"), { recursive: true });
  mkdirSync(join(root, "outbox", "codex:demo"), { recursive: true });
  mkdirSync(join(root, "contracts", "contract:alpha"), { recursive: true });
  mkdirSync(join(root, "engagements", "engagement:ship-v1"), { recursive: true });
  mkdirSync(join(root, "policies"), { recursive: true });
  writeFileSync(join(root, "policies", "policy:retention.json"), "{}");
  mkdirSync(join(root, "presence"), { recursive: true });
  writeFileSync(join(root, "presence", "sess:abc123.json"), "{}");
  return root;
}

test("sanitizeStorePaths dry-run reports would-rename without touching disk (DEC-064)", skipOnWindows, () => {
  const root = legacyStore();
  try {
    const result = sanitizeStorePaths(root, { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    const tos = result.renamed.map((e) => e.to.split(/[\\/]/).pop()).sort();
    assert.deepEqual(tos, [
      "claude__proj-1",
      "codex__demo",
      "contract__alpha",
      "engagement__ship-v1",
      "nego__codex",
      "policy__retention.json",
      "sess__abc123.json"
    ]);
    for (const e of result.renamed) {
      assert.equal(e.status, "would-rename");
    }
    // Dry-run did not move anything.
    assert.ok(existsSync(join(root, "negotiations", "nego:codex")));
    assert.equal(existsSync(join(root, "negotiations", "nego__codex")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sanitizeStorePaths actually renames every `:`-bearing entry (DEC-064)", skipOnWindows, () => {
  const root = legacyStore();
  try {
    const result = sanitizeStorePaths(root, { dryRun: false });
    assert.equal(result.ok, true);
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.renamed.length, 7);

    // dirs renamed
    assert.ok(existsSync(join(root, "negotiations", "nego__codex")));
    assert.ok(existsSync(join(root, "negotiations", "nego__codex", "journal.jsonl")));
    assert.ok(existsSync(join(root, "inbox", "claude__proj-1")));
    assert.ok(existsSync(join(root, "outbox", "codex__demo")));
    assert.ok(existsSync(join(root, "contracts", "contract__alpha")));
    assert.ok(existsSync(join(root, "engagements", "engagement__ship-v1")));
    // files renamed (extension preserved)
    assert.ok(existsSync(join(root, "policies", "policy__retention.json")));
    assert.ok(existsSync(join(root, "presence", "sess__abc123.json")));

    // originals gone
    assert.equal(existsSync(join(root, "negotiations", "nego:codex")), false);
    assert.equal(existsSync(join(root, "presence", "sess:abc123.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sanitizeStorePaths is a no-op on an already-clean store", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-clean-"));
  try {
    mkdirSync(join(root, "negotiations", "nego__codex"), { recursive: true });
    const result = sanitizeStorePaths(root, { dryRun: false });
    assert.equal(result.ok, true);
    assert.equal(result.renamed.length, 0);
    assert.equal(result.conflicts.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sanitizeStorePaths reports a conflict when the sanitized target already exists", skipOnWindows, () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-conflict-"));
  try {
    mkdirSync(join(root, "negotiations", "nego:codex"), { recursive: true });
    mkdirSync(join(root, "negotiations", "nego__codex"), { recursive: true });
    const result = sanitizeStorePaths(root, { dryRun: false });
    assert.equal(result.ok, false);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].status, "conflict");
    // The legacy dir is preserved (not overwritten).
    assert.ok(existsSync(join(root, "negotiations", "nego:codex")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a store migrate --sanitize-paths --dry-run emits an action envelope", skipOnWindows, () => {
  const root = legacyStore();
  try {
    let stdout = "";
    const streams = {
      stdout: { write: (c) => void (stdout += c) },
      stderr: { write: () => {} },
      cwd: () => process.cwd()
    };
    const rc = runCli(
      ["store", "migrate", "--root", root, "--sanitize-paths", "--dry-run"],
      streams
    );
    assert.equal(rc, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.renamed.length, 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a store migrate --sanitize-paths exits 2 on a conflict", skipOnWindows, () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-cli-conflict-"));
  try {
    mkdirSync(join(root, "inbox", "claude:proj-1"), { recursive: true });
    mkdirSync(join(root, "inbox", "claude__proj-1"), { recursive: true });
    let stdout = "";
    const streams = {
      stdout: { write: (c) => void (stdout += c) },
      stderr: { write: () => {} },
      cwd: () => process.cwd()
    };
    const rc = runCli(
      ["store", "migrate", "--root", root, "--sanitize-paths"],
      streams
    );
    assert.equal(rc, 2);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
