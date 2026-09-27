import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as lock from "../dist/runtime/local-files/succession-lock.js";
import * as upgrade from "../dist/runtime/upgrade/index.js";

const publicLockExports = [
  "STALE_LOCK_ALERT_MS", "PREFIX_LOCK_MAX_ROUNDS", "PREFIX_LOCK_MAX_CHAIN",
  "PREFIX_LOCK_TMP_DEBRIS_MAX_AGE_MS", "UPGRADE_RESIDUE_MAX_AGE_MS",
  "readPidNs", "readTimeNs", "procStartInfo", "livenessOf", "acquirePrefixLock"
];

test("extracted lock retains the upgrade module's public bindings", () => {
  for (const name of publicLockExports) assert.strictEqual(upgrade[name], lock[name], name);
  assert.equal("lockPathFor" in upgrade, false);
});

test("extracted lock acquires, excludes another holder, and releases", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-lock-extract-"));
  try {
    const holder = lock.acquirePrefixLock(prefix);
    assert.equal(holder.acquired, true);
    assert.equal(lock.acquirePrefixLock(prefix).acquired, false);
    holder.release();
    const next = lock.acquirePrefixLock(prefix);
    assert.equal(next.acquired, true);
    next.release();
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});
