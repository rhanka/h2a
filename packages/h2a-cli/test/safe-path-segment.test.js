import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inboxDir,
  localStorePaths,
  negotiationDir,
  outboxDir,
  presenceFile,
  safePathSegment
} from "../dist/index.js";

test("safePathSegment maps `:` to `__` (DEC-062)", () => {
  assert.equal(safePathSegment("nego:codex"), "nego__codex");
  assert.equal(safePathSegment("claude:proj-1"), "claude__proj-1");
  assert.equal(safePathSegment("sess:abc123"), "sess__abc123");
});

test("safePathSegment maps every Windows-forbidden character", () => {
  for (const bad of [":", "/", "\\", "<", ">", '"', "|", "?", "*"]) {
    const out = safePathSegment(`a${bad}b`);
    assert.equal(
      out,
      "a__b",
      `expected ${bad} to be replaced by __, got "${out}"`
    );
  }
});

test("safePathSegment collapses runs of forbidden chars into a single __", () => {
  assert.equal(safePathSegment("a:::b"), "a__b");
  assert.equal(safePathSegment("a:/:b"), "a__b");
});

test("safePathSegment maps empty input to a single `_` so we never write empty segments", () => {
  assert.equal(safePathSegment(""), "_");
  assert.equal(safePathSegment(":::"), "__");
});

test("safePathSegment passes safe ids through unchanged", () => {
  assert.equal(safePathSegment("nego-codex"), "nego-codex");
  assert.equal(safePathSegment("claude.proj.1"), "claude.proj.1");
  assert.equal(safePathSegment("conductor_1"), "conductor_1");
});

test("negotiationDir / inboxDir / outboxDir / presenceFile all run through safePathSegment", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-paths-"));
  try {
    const paths = localStorePaths(root);

    const nego = negotiationDir(paths, "nego:codex");
    assert.equal(nego, join(root, "negotiations", "nego__codex"));

    const inbox = inboxDir(paths, "claude:proj-1");
    assert.equal(inbox, join(root, "inbox", "claude__proj-1"));

    const outbox = outboxDir(paths, "codex:demo");
    assert.equal(outbox, join(root, "outbox", "codex__demo"));

    const presence = presenceFile(paths, "sess:abc123");
    assert.equal(presence, join(root, "presence", "sess__abc123.json"));

    // mkdir actually works with the sanitized path (regression check for
    // the Windows ENOENT this DEC fixed).
    mkdirSync(nego, { recursive: true });
    assert.ok(existsSync(nego));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
