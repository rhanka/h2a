import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireLoopExecutorLease,
  loopExecutorLockPath,
  tryAcquireLease,
  releaseLeaseHandle
} from "../dist/index.js";

// L1 Lot 0 — per-loop executor lease: single-writer, steal-after-TTL, fencing.

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-exec-lease-"));
  return { dir, root: join(dir, ".h2a") };
}

test("acquireLoopExecutorLease grants a held lease with a fencing token", () => {
  const { dir, root } = freshRoot();
  try {
    const lease = acquireLoopExecutorLease(root, "loop-A");
    assert.ok(lease, "lease acquired");
    assert.equal(typeof lease.token, "number");
    assert.equal(lease.token, 1, "first acquisition token = 1");
    const lockPath = loopExecutorLockPath(root, "loop-A");
    assert.ok(existsSync(lockPath), "lock file exists while held");
    lease.release();
    assert.equal(existsSync(lockPath), false, "lock removed after release");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("single-writer: a second acquisition on the same loop is refused while held", () => {
  const { dir, root } = freshRoot();
  try {
    const first = acquireLoopExecutorLease(root, "loop-B", { leaseMs: 60000 });
    assert.ok(first);
    const second = acquireLoopExecutorLease(root, "loop-B", { leaseMs: 60000 });
    assert.equal(second, null, "second executor refused while first holds a live lease");
    first.release();
    const third = acquireLoopExecutorLease(root, "loop-B", { leaseMs: 60000 });
    assert.ok(third, "acquirable again after release");
    third.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("distinct loops do not contend", () => {
  const { dir, root } = freshRoot();
  try {
    const a = acquireLoopExecutorLease(root, "loop-C", { leaseMs: 60000 });
    const b = acquireLoopExecutorLease(root, "loop-D", { leaseMs: 60000 });
    assert.ok(a && b, "different loopIds each get their own lease");
    a.release();
    b.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("steal-after-TTL: an expired lease is stealable with a bumped fencing token", async () => {
  const { dir, root } = freshRoot();
  try {
    const first = acquireLoopExecutorLease(root, "loop-E", { leaseMs: 20 });
    assert.ok(first);
    assert.equal(first.token, 1);
    // Do NOT release; let the short lease expire.
    await new Promise((r) => setTimeout(r, 60));
    const stolen = acquireLoopExecutorLease(root, "loop-E", { leaseMs: 60000 });
    assert.ok(stolen, "expired lease stolen");
    assert.equal(stolen.token, 2, "fencing token bumped on steal");
    stolen.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release is idempotent and does not delete a newer holder's lease", async () => {
  const { dir, root } = freshRoot();
  try {
    const first = acquireLoopExecutorLease(root, "loop-F", { leaseMs: 20 });
    assert.ok(first);
    await new Promise((r) => setTimeout(r, 60));
    const stolen = acquireLoopExecutorLease(root, "loop-F", { leaseMs: 60000 });
    assert.ok(stolen && stolen.token === 2);
    // The overrun holder releases late: must NOT unlink the new holder's lease.
    first.release();
    const lockPath = loopExecutorLockPath(root, "loop-F");
    assert.ok(existsSync(lockPath), "new holder's lease survives the stale release");
    // And calling release twice is a no-op.
    first.release();
    stolen.release();
    assert.equal(existsSync(lockPath), false, "removed once the true holder releases");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("primitive tryAcquireLease/releaseLeaseHandle is exposed (held acquire/release)", () => {
  const { dir } = freshRoot();
  try {
    const lock = join(dir, "x.lock");
    const h = tryAcquireLease(lock, { leaseMs: 60000 });
    assert.ok(h, "held lease acquired");
    assert.equal(h.fencingToken, 1);
    assert.equal(tryAcquireLease(lock, { leaseMs: 60000 }), null, "second refused while held");
    assert.ok(existsSync(lock));
    releaseLeaseHandle(lock, h);
    assert.equal(existsSync(lock), false, "released via releaseLeaseHandle");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
