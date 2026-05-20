// DEC-036 — advisory file locking around the local-files store.
//
// We exercise three behaviours:
//   (1) no-contention happy path — registerInstance + appendNegotiationEvent
//       under a tight `lockTimeoutMs` still succeed when nothing else holds
//       the lock.
//   (2) stale lock detection — a `.lock` file referencing a clearly-dead PID
//       (99999999) on the same hostname is reclaimed; the next operation
//       succeeds within a few hundred ms.
//   (3) live lock timeout — a `.lock` file holding the *current* process PID
//       (the test runner itself, very much alive) blocks the operation until
//       `lockTimeoutMs` elapses; `LockTimeoutError` is then thrown.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LockTimeoutError,
  createLocalStore,
  withLockSync
} from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-lock-"));
}

test("registerInstance under no contention completes with a tight lock timeout", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root, lockTimeoutMs: 200 });
    store.registerInstance({
      id: "happy:01",
      instance: "happy:01",
      roles: ["CONDUCTOR"],
      scopes: ["scope:s"],
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-20T00:00:00.000Z"
    });
    assert.equal(store.listInstances().length, 1);
    // Lock file should be released after the call.
    assert.equal(existsSync(join(store.paths.registry, ".lock")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale lock with a dead PID is reclaimed automatically", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root, lockTimeoutMs: 1500 });
    const lockPath = join(store.paths.registry, ".lock");

    // 99999999 is far above the typical /proc/sys/kernel/pid_max on Linux,
    // and matches no live process on macOS either — `kill(pid, 0)` returns
    // ESRCH so the lock is considered stale.
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 99999999,
        hostname: hostname(),
        startedAt: "2020-01-01T00:00:00.000Z"
      })
    );

    const before = Date.now();
    store.registerInstance({
      id: "stale:01",
      instance: "stale:01",
      roles: ["CONDUCTOR"],
      scopes: ["scope:s"],
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-20T00:00:00.000Z"
    });
    const elapsed = Date.now() - before;
    // Lock reclamation is a single retry on the stale-lock branch; we expect
    // it to complete well under the 1500ms timeout.
    assert.ok(elapsed < 800, `expected fast reclaim, took ${elapsed}ms`);
    assert.equal(store.listInstances()[0].id, "stale:01");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live lock holding the current PID times out with LockTimeoutError", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root, lockTimeoutMs: 200 });
    const lockPath = join(store.paths.registry, ".lock");

    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        hostname: hostname(),
        startedAt: new Date().toISOString()
      })
    );

    const before = Date.now();
    assert.throws(
      () =>
        store.registerInstance({
          id: "blocked:01",
          instance: "blocked:01",
          roles: ["CONDUCTOR"],
          scopes: ["scope:s"],
          capabilities: [],
          endpoints: [],
          publicKeys: [],
          acceptedPolicies: [],
          createdAt: "2026-05-20T00:00:00.000Z"
        }),
      LockTimeoutError
    );
    const elapsed = Date.now() - before;
    // Should have waited roughly the full timeout (200ms) but not vastly more.
    assert.ok(elapsed >= 150, `expected to wait the timeout, took only ${elapsed}ms`);
    assert.ok(elapsed < 2000, `timed out way over budget at ${elapsed}ms`);

    // The lock file holding *our* PID is still there — we did not steal it.
    const stillOurs = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.equal(stillOurs.pid, process.pid);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withLockSync exposes LockTimeoutError directly with lockPath in the message", () => {
  const root = freshRoot();
  try {
    mkdirSync(root, { recursive: true });
    const lockPath = join(root, "direct.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        hostname: hostname(),
        startedAt: new Date().toISOString()
      })
    );
    try {
      withLockSync(lockPath, () => undefined, { timeoutMs: 100, pollMs: 20 });
      assert.fail("expected LockTimeoutError");
    } catch (err) {
      assert.ok(err instanceof LockTimeoutError);
      assert.match(err.message, /direct\.lock/);
      assert.equal(err.lockPath, lockPath);
      assert.equal(err.lastSeenOwner?.pid, process.pid);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
