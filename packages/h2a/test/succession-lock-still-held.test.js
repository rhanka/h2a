import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquirePrefixLock, lockPathFor, makeLockRec, readLockRecord } from "../dist/runtime/local-files/succession-lock.js";

function withHolder(fn) {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-still-held-"));
  const lease = acquirePrefixLock(prefix);
  try { fn(prefix, lease); }
  finally { lease.release(); rmSync(prefix, { recursive: true, force: true }); }
}

test("T-stillHeld: an acquired lease confirms its current token repeatedly", () => {
  withHolder((prefix, lease) => {
    assert.equal(lease.acquired, true);
    assert.equal(lease.stillHeld(), true);
    assert.equal(lease.stillHeld(), true);
    assert.equal(readLockRecord(lockPathFor(prefix)).token, lease.token);
  });
});

test("T-stillHeld: denied leases never claim ownership", () => {
  withHolder((prefix) => {
    const denied = acquirePrefixLock(prefix);
    assert.equal(denied.acquired, false);
    assert.equal(denied.stillHeld(), false);
    denied.release();
    assert.equal(denied.stillHeld(), false);
  });
});

test("T-stillHeld: a released lease stays false even if its old bytes reappear", () => {
  withHolder((prefix, lease) => {
    const path = lockPathFor(prefix);
    const record = readLockRecord(path);
    lease.release();
    assert.equal(lease.stillHeld(), false);
    writeFileSync(path, JSON.stringify(record));
    assert.equal(lease.stillHeld(), false);
  });
});

test("T-stillHeld: an absent LOCK fails closed", () => {
  withHolder((prefix, lease) => {
    unlinkSync(lockPathFor(prefix));
    assert.equal(lease.stillHeld(), false);
  });
});

test("T-stillHeld: replacement ownership is preserved by check and stale release", () => {
  withHolder((prefix, lease) => {
    const path = lockPathFor(prefix);
    const replacement = makeLockRec("b".repeat(32));
    writeFileSync(path, JSON.stringify(replacement));
    assert.equal(lease.stillHeld(), false);
    lease.release();
    assert.equal(readLockRecord(path).token, replacement.token);
  });
});

test("T-stillHeld: corrupt, legacy, and unreadable LOCKs never confirm ownership", () => {
  for (const raw of ["not-json", JSON.stringify({ pid: process.pid, hostname: "fixture", startedAt: "fixture" }), null]) {
    withHolder((prefix, lease) => {
      const path = lockPathFor(prefix);
      if (raw === null) { unlinkSync(path); mkdirSync(path); }
      else writeFileSync(path, raw);
      assert.equal(lease.stillHeld(), false);
    });
  }
});
