import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LockTimeoutError, withLeaseSync } from "../dist/index.js";

function freshLockPath() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-lease-"));
  return { dir, lock: join(dir, "x.lock") };
}

test("withLeaseSync runs the section and releases the lease (DEC-065)", () => {
  const { dir, lock } = freshLockPath();
  try {
    const out = withLeaseSync(lock, (h) => {
      assert.ok(existsSync(lock), "lease file exists while held");
      assert.equal(typeof h.nonce, "string");
      assert.equal(h.fencingToken, 1);
      return 42;
    });
    assert.equal(out, 42);
    assert.equal(existsSync(lock), false, "lease released after section");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withLeaseSync serializes nested re-entry via timeout (live lease not stealable)", () => {
  const { dir, lock } = freshLockPath();
  try {
    assert.throws(
      () =>
        withLeaseSync(
          lock,
          () => {
            // Inner acquire on the same path with a long lease + short timeout:
            // the outer lease is fresh, so the inner cannot steal it.
            withLeaseSync(lock, () => "inner", {
              timeoutMs: 150,
              pollMs: 20,
              leaseMs: 30000
            });
          },
          { leaseMs: 30000 }
        ),
      LockTimeoutError
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withLeaseSync steals an expired lease and bumps the fencing token (cross-host model)", () => {
  const { dir, lock } = freshLockPath();
  try {
    // Forge a stale lease (renewedAt far in the past, short leaseMs).
    const stale = {
      holder: "otherhost:999",
      nonce: "deadbeef",
      acquiredAt: "2020-01-01T00:00:00.000Z",
      renewedAt: "2020-01-01T00:00:00.000Z",
      leaseMs: 1000,
      fencingToken: 7
    };
    writeFileSync(lock, JSON.stringify(stale));

    const token = withLeaseSync(lock, (h) => h.fencingToken, { leaseMs: 30000 });
    // Stolen lease increments the token from the stale 7 → 8.
    assert.equal(token, 8);
    assert.equal(existsSync(lock), false, "released after stealing + running");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withLeaseSync does NOT delete a lease that was stolen from us mid-section", () => {
  const { dir, lock } = freshLockPath();
  try {
    // Hold with a very short lease, then simulate a competitor stealing it
    // during our section by overwriting the file with a different nonce.
    let competitorNonce;
    withLeaseSync(
      lock,
      () => {
        competitorNonce = "competitor-nonce";
        writeFileSync(
          lock,
          JSON.stringify({
            holder: "competitor:1",
            nonce: competitorNonce,
            acquiredAt: new Date().toISOString(),
            renewedAt: new Date().toISOString(),
            leaseMs: 30000,
            fencingToken: 99
          })
        );
      },
      { leaseMs: 10 }
    );
    // Our release must NOT have unlinked the competitor's lease.
    assert.ok(existsSync(lock), "competitor lease survives our release");
    const onDisk = JSON.parse(readFileSync(lock, "utf8"));
    assert.equal(onDisk.nonce, competitorNonce);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withLeaseSync acquires immediately when no lease exists (fresh token = 1)", () => {
  const { dir, lock } = freshLockPath();
  try {
    const token = withLeaseSync(lock, (h) => h.fencingToken);
    assert.equal(token, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
