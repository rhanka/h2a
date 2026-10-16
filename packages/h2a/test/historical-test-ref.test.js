import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { ensureHistoricalGitRef, IDENTITY_BASE_REF, LEGACY_HOST_REF } from "../../../scripts/historical-test-ref.mjs";

test("should pin historical fixture commits with remotely fetchable full object IDs", () => {
  assert.match(LEGACY_HOST_REF, /^[a-f0-9]{40}\^$/);
  assert.match(IDENTITY_BASE_REF, /^[a-f0-9]{40}$/);
});

test("should provide a historical parent in a depth-one checkout with a bounded fetch", () => {
  const lab = mkdtempSync(join(tmpdir(), "historical-ref-"));
  const origin = join(lab, "origin"), checkout = join(lab, "checkout");
  mkdirSync(origin);
  const git = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git(origin, "init", "-b", "fixture");
    let historical;
    for (let i = 0; i < 5; i++) {
      git(origin, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", `test: create fixture ${i}`);
      if (i === 3) historical = git(origin, "rev-parse", "HEAD");
    }
    git(lab, "clone", "--depth=1", pathToFileURL(origin).href, checkout);
    assert.notEqual(spawnSync("git", ["cat-file", "-e", `${historical}^`], { cwd: checkout }).status, 0);
    ensureHistoricalGitRef(checkout, `${historical}^`);
    assert.equal(git(checkout, "rev-parse", `${historical}^`), git(origin, "rev-parse", `${historical}^`));
    assert.equal(git(checkout, "rev-list", "--count", historical), "2", "fetch the requested commit and its parent, rather than all history");
    ensureHistoricalGitRef(checkout, `${historical}^`); // Already available: no second fetch.
  } finally { rmSync(lab, { recursive: true, force: true }); }
});
