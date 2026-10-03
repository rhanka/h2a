import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as lock from "../dist/runtime/local-files/succession-lock.js";
import { __test } from "./succession-lock-test-seam.mjs";
import { createIdentityController } from "../dist/runtime/mcp/identity-state.js";

function fixture(fn) {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-operator-"));
  try { fn(prefix, lock.lockPathFor(prefix)); }
  finally { rmSync(prefix, { recursive: true, force: true }); }
}
const token = "a".repeat(32);
const dead = () => ({ ...lock.makeLockRec(token), pid: 999_999_999 });
const breakLock = (path, options = {}) => lock.breakLockAsOperator(path, { expectToken: token, ...options });

function observeSucc(fn, observe) {
  const original = fs.linkSync;
  fs.linkSync = (from, to) => {
    original(from, to);
    if (to.includes(".succ.")) observe(to);
  };
  syncBuiltinESMExports();
  try { return fn(); }
  finally { fs.linkSync = original; syncBuiltinESMExports(); }
}

test("T-operator-live-refusé: even assertDead cannot break a live holder or signal it", () => {
  fixture((prefix, path) => {
    const holder = lock.acquirePrefixLock(prefix);
    const originalKill = process.kill;
    const signals = [];
    process.kill = (pid, signal) => { signals.push(signal); return originalKill(pid, signal); };
    try {
      const result = breakLock(path, { expectToken: holder.token, assertDead: true });
      assert.equal(result.broken, false);
      assert.equal(result.reason, "live");
      assert.equal(result.pid, process.pid);
      assert.equal(holder.stillHeld(), true);
      assert.ok(signals.every((signal) => signal === 0), "only non-destructive liveness probes are allowed");
      assert.deepEqual(readdirSync(prefix), [".h2a-upgrade.lock"]);
    } finally { process.kill = originalKill; holder.release(); }
  });
});

test("T-operator-dead-normal: elect through SUCC, retire g without republishing LOCK", () => {
  fixture((prefix, path) => {
    writeFileSync(path, JSON.stringify(dead()));
    const seen = [];
    const result = observeSucc(() => breakLock(path), (succ) => {
      const record = lock.readLockRecord(succ);
      assert.equal(record.target, token);
      assert.equal(record.operator, undefined, "certain death uses ordinary succession");
      seen.push(record.token);
      assert.equal(lock.acquirePrefixLock(prefix).acquired, false, "the elected operator excludes another successor");
    });
    assert.equal(result.broken, true);
    assert.equal(seen.length, 1);
    assert.equal(lock.readLockHolder(path), "absent");
    assert.deepEqual(readdirSync(prefix), []);
    const winner = lock.acquirePrefixLock(prefix);
    assert.equal(winner.acquired, true);
    winner.release();
  });
});

test("T-operator-undecidable: require assertDead, fence raw legacy bytes, and re-read before unlink", () => {
  fixture((prefix, path) => {
    const raw = JSON.stringify({ pid: 2910836, hostname: "fixture-only", startedAt: "fixture-only" }) + "\n";
    writeFileSync(path, raw);
    const legacyToken = lock.readLockHolder(path).token;
    const refusal = breakLock(path, { expectToken: legacyToken });
    assert.equal(refusal.broken, false);
    assert.equal(refusal.reason, "assert-dead-required");
    assert.equal(refusal.legacyRecords, 1);
    assert.equal(refusal.diagnostic.code, "legacy-record");
    assert.match(refusal.diagnostic.command, /h2a identity unlock/);
    assert.equal(readFileSync(path, "utf8"), raw);
    assert.equal(breakLock(path).reason, "token-mismatch");
    let seen = 0;
    const replacement = lock.makeLockRec("b".repeat(32));
    const stale = observeSucc(() => breakLock(path, { expectToken: legacyToken, assertDead: true }), (succ) => {
      const record = lock.readLockRecord(succ);
      assert.equal(record.operator, true);
      assert.equal(record.target, legacyToken);
      seen++;
      writeFileSync(path, JSON.stringify(replacement));
    });
    assert.equal(seen, 1);
    assert.equal(stale.broken, false);
    assert.equal(stale.reason, "token-mismatch");
    assert.equal(lock.readLockRecord(path).token, replacement.token, "never remove a replacement LOCK");
    writeFileSync(path, raw);
    const result = breakLock(path, { expectToken: legacyToken, assertDead: true });
    assert.equal(result.broken, true);
    assert.equal(lock.readLockHolder(path), "absent");
    assert.deepEqual(readdirSync(prefix), []);
  });
});

test("T-operator: invalid, absent, corrupt, and mismatched tokens leave storage untouched", () => {
  fixture((prefix, path) => {
    assert.equal(breakLock(path).reason, "absent");
    writeFileSync(path, "not-json");
    assert.equal(breakLock(path, { assertDead: true }).reason, "corrupt");
    assert.equal(readFileSync(path, "utf8"), "not-json");
    writeFileSync(path, JSON.stringify(dead()));
    assert.equal(breakLock(path, { expectToken: "" }).reason, "invalid-token");
    assert.equal(breakLock(path, { expectToken: "../unsafe-token" }).reason, "invalid-token");
    assert.equal(breakLock(path, { expectToken: "c".repeat(32), assertDead: true }).reason, "token-mismatch");
    assert.deepEqual(readdirSync(prefix), [".h2a-upgrade.lock"]);
  });
});

test("T-operator: a live successor excludes the operator; dead operator links remain traversable", () => {
  fixture((prefix, path) => {
    writeFileSync(path, JSON.stringify(dead()));
    const successorToken = "c".repeat(32);
    const succPath = `${path}.succ.${token}`;
    writeFileSync(succPath, JSON.stringify({ ...lock.makeLockRec(successorToken, token), operator: true }));
    assert.equal(breakLock(path).reason, "busy");
    assert.equal(lock.readLockRecord(path).token, token);
    writeFileSync(succPath, JSON.stringify({ ...dead(), token: successorToken, target: token, operator: true }));
    const result = breakLock(path);
    assert.equal(result.broken, true);
    assert.deepEqual(readdirSync(prefix), []);
  });
});

test("T-operator-chaîne-post-rupture: an elected automatic retire sees absence and publishes fresh", () => {
  fixture((prefix, path) => {
    writeFileSync(path, JSON.stringify(dead()));
    let breaks = 0;
    // The operator completes after the automatic fresh death read but before its
    // election. The automatic retire then sees absence and publishes exclusively.
    const lease = __test.acquirePrefixLock(prefix, {}, { hooks: {
      beforeSucceedDeadToken: () => { assert.equal(breakLock(path).broken, true); breaks++; },
      afterPublishSucc: () => { assert.equal(lock.readLockHolder(path), "absent"); }
    } });
    assert.equal(breaks, 1);
    assert.equal(lease.acquired, true);
    assert.notEqual(lease.token, token);
    assert.equal(lease.stillHeld(), true);
    assert.equal(lock.acquirePrefixLock(prefix).acquired, false);
    lease.release();
  });
});

test("T-operator-pendant-retry: operator removal never creates two holders or deletes the winner", () => {
  fixture((prefix, path) => {
    writeFileSync(path, JSON.stringify(dead()));
    let errorCallback;
    let resolvedCallback;
    let clock = 0n;
    let attempts = 0;
    let winner;
    let retryLease;
    const controller = createIdentityController({
      request: { root: prefix, cwd: prefix, host: "agent" },
      timeoutMs: 5000,
      retryMinIntervalMs: 0,
      nowNs: () => clock,
      activate: () => ({ ok: true, sessionId: "fixture-session" }),
      spawnWorker: () => {
        attempts++;
        if (attempts === 2) {
          retryLease = __test.acquirePrefixLock(prefix, {}, { hooks: {
            beforePublishLock: () => {
              assert.equal(breakLock(path).broken, true);
              winner = lock.acquirePrefixLock(prefix);
              assert.equal(winner.acquired, true);
            }
          } });
        }
        return {
          onError: (callback) => { errorCallback = callback; },
          onResolved: (callback) => { resolvedCallback = callback; },
          onExitWithoutResult: () => {},
          cancel: () => {}
        };
      }
    });
    try {
      controller.start();
      errorCallback("identity_timeout", "fixture contention");
      clock = 6_000_000_000n;
      assert.equal(controller.retry(), true);
      assert.equal(controller.retry(), false, "only one retry may be pending");
      assert.equal(retryLease.acquired, false, "the retry cannot become a second holder");
      assert.equal(retryLease.stillHeld(), false);
      retryLease.release();
      assert.equal(winner.stillHeld(), true);
      assert.equal(lock.readLockRecord(path).token, winner.token);
      assert.equal(breakLock(path, { assertDead: true }).reason, "token-mismatch");
      assert.equal(breakLock(path, { expectToken: winner.token, assertDead: true }).reason, "live");
      errorCallback("identity_timeout", "winner holds lock");
      assert.equal(controller.status().state, "identity_failed");
      assert.equal(winner.stillHeld(), true);
      // After the winner releases, the next retry can own the lock and become ready.
      winner.release();
      assert.equal(controller.retry(), true);
      const next = lock.acquirePrefixLock(prefix);
      assert.equal(next.acquired, true);
      resolvedCallback({ instance: "agent:fixture", host: "agent", action: "override", privateKeyPath: "", publicKeyPath: "" });
      assert.equal(controller.status().state, "identity_ready");
      assert.equal(next.stillHeld(), true);
      next.release();
    } finally { controller.cancel("fixture cleanup"); winner?.release(); retryLease?.release(); }
  });
});
