import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cmdUpgrade,
  checkUpgrade,
  isNewerVersion,
  performUpgrade,
  performAutoUpgrade,
  defaultUpgradeRuntime,
  isQuietUpgradeOutcome,
  upgradeCachePath,
  canReexec,
  reexecSelf,
  H2A_AUTO_UPGRADE_CHECK_TTL_MS,
  H2A_REEXEC_GUARD_ENV,
  H2A_UPGRADE_CHECK_TTL_MS,
  STALE_LOCK_ALERT_MS
} from "../dist/index.js";

// Legacy check-flow fake (fetchLatest/runInstall/now/cache) for checkUpgrade +
// performUpgrade, whose signatures are unchanged.
function fakeRuntime(overrides = {}) {
  const calls = { fetch: 0, install: 0 };
  return {
    calls,
    runtime: {
      fetchLatest: () => { calls.fetch++; return overrides.latest ?? "999.0.0"; },
      runInstall: () => { calls.install++; return overrides.installOk ?? true; },
      now: () => overrides.now ?? 1_000_000,
      readCache: () => overrides.cache,
      writeCache: (_p, e) => { calls.written = e; },
      ...overrides.runtime
    }
  };
}

// Full seam fake for the staged performAutoUpgrade. Every method is present so
// the M2 fail-safe never has to fire (a legacy/partial fake is tested separately).
// The default path drives a successful "upgraded"; overrides steer each branch.
function stagedFake(overrides = {}) {
  const calls = { fetch: 0, stage: 0, probe: 0, native: 0, swap: 0, verify: 0, lock: 0, released: 0, install: 0, diag: 0, repair: 0 };
  const latest = overrides.latest ?? "999.0.0";
  const runtime = {
    now: () => overrides.now ?? 1_000_000,
    readCache: () => overrides.cache,
    writeCache: (_p, e) => { calls.written = e; },
    fetchLatest: () => latest,
    runInstall: () => { calls.install++; return overrides.installOk ?? true; },
    resolvePrefix: () => overrides.prefix ?? "/fake/prefix",
    completeRepairIfPending: () => { calls.repair++; return overrides.repaired ?? false; },
    acquirePrefixLock: () => {
      calls.lock++;
      return overrides.lock ?? { acquired: true, release: () => { calls.released++; } };
    },
    fetchTarball: () => { calls.fetch++; return overrides.fetch ?? { ok: true, file: "/fake/staged.tgz" }; },
    stageInstall: () => { calls.stage++; return overrides.stage ?? { ok: true }; },
    probeStagedVersion: () => { calls.probe++; return overrides.probed ?? latest; },
    verifyStagedNative: () => { calls.native++; return overrides.native ?? { ok: true }; },
    swapPackageDir: () => { calls.swap++; return overrides.swap ?? { ok: true, repaired: false }; },
    // Stateful, to model reality: BEFORE the swap the global prefix holds the
    // pre-existing version (drives the post-lock idempotence check); AFTER the swap
    // it holds the newly installed version (drives the post-swap verification).
    readGlobalPkgVersion: () => {
      calls.verify++;
      return calls.swap > 0 ? (overrides.verified ?? latest) : (overrides.installed ?? CUR);
    },
    writeDiagnostics: () => { calls.diag++; },
    ...overrides.runtime
  };
  return { runtime, calls };
}

const CUR = "0.97.7";

test("isNewerVersion compares strict X.Y.Z", () => {
  assert.equal(isNewerVersion("0.16.0", "0.15.0"), true);
  assert.equal(isNewerVersion("1.0.0", "0.99.99"), true);
  assert.equal(isNewerVersion("0.15.0", "0.15.0"), false);
  assert.equal(isNewerVersion("0.14.9", "0.15.0"), false);
  assert.equal(isNewerVersion("garbage", "0.15.0"), false);
});

test("checkUpgrade (force) hits the network and flags an available upgrade", () => {
  const { runtime, calls } = fakeRuntime({ latest: "0.16.0" });
  const r = checkUpgrade("0.15.0", { runtime, force: true });
  assert.deepEqual(
    { current: r.current, latest: r.latest, upgradeAvailable: r.upgradeAvailable, fromCache: r.fromCache },
    { current: "0.15.0", latest: "0.16.0", upgradeAvailable: true, fromCache: false }
  );
  assert.equal(calls.fetch, 1);
});

test("checkUpgrade uses a fresh cache (no network) and writes the cache when stale", () => {
  const fresh = fakeRuntime({ now: 1_000_000, cache: { checkedAt: 999_000, latest: "0.16.0" } });
  const r1 = checkUpgrade("0.15.0", { runtime: fresh.runtime, cachePath: "/x", ttlMs: 10_000 });
  assert.equal(r1.fromCache, true);
  assert.equal(r1.upgradeAvailable, true);
  assert.equal(fresh.calls.fetch, 0);

  const stale = fakeRuntime({ now: 1_000_000, cache: { checkedAt: 1, latest: "0.15.0" }, latest: "0.16.0" });
  const r2 = checkUpgrade("0.15.0", { runtime: stale.runtime, cachePath: "/x", ttlMs: 10_000 });
  assert.equal(r2.fromCache, false);
  assert.equal(stale.calls.fetch, 1);
  assert.equal(stale.calls.written.latest, "0.16.0");
});

test("auto-upgrade TTL is short (1h) and well under the 24h notice TTL", () => {
  assert.equal(H2A_AUTO_UPGRADE_CHECK_TTL_MS, 60 * 60 * 1000);
  assert.ok(H2A_AUTO_UPGRADE_CHECK_TTL_MS < H2A_UPGRADE_CHECK_TTL_MS);
});

test("checkUpgrade never throws on registry failure", () => {
  const r = checkUpgrade("0.15.0", { runtime: { fetchLatest: () => undefined, runInstall: () => false, now: () => 0, readCache: () => undefined, writeCache: () => {} }, force: true });
  assert.equal(r.upgradeAvailable, false);
  assert.equal(r.latest, undefined);
});

test("performUpgrade delegates to runInstall (legacy in-place path, kept for compat)", () => {
  const { runtime, calls } = fakeRuntime({ installOk: true });
  assert.equal(performUpgrade(runtime), true);
  assert.equal(calls.install, 1);
});

// ---------------------------------------------------------------------------
// performAutoUpgrade — staged, self-contained, non-destructive.
// ---------------------------------------------------------------------------

test("performAutoUpgrade POSITIVE CONTROL: a legitimate upgrade succeeds end to end", () => {
  const { runtime, calls } = stagedFake({ latest: "999.0.0" });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "upgraded");
  assert.equal(r.target, "999.0.0");
  assert.equal(r.verifiedVersion, "999.0.0");
  assert.match(r.message, /auto-upgraded .* \(applies on next launch\)/);
  // Full sequence ran, native was validated, lock released.
  assert.equal(calls.fetch, 1);
  assert.equal(calls.stage, 1);
  assert.equal(calls.probe, 1);
  assert.equal(calls.native, 1, "the staged native module must be validated before swap");
  assert.equal(calls.swap, 1);
  // Two global reads: the post-lock idempotence check (pre-swap) + the post-swap
  // verification. The idempotence read saw the pre-existing version, so the upgrade ran.
  assert.equal(calls.verify, 2);
  assert.ok(calls.released >= 1, "prefix lock must be released");
  assert.equal(calls.written.lastOutcome, "ok");
});

test("performAutoUpgrade fails (no swap) when the staged native module cannot load", () => {
  const { runtime, calls } = stagedFake({ latest: "999.0.0", native: { ok: false, error: "node-pty ABI mismatch" } });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "failed");
  assert.equal(calls.swap, 0, "a failed native validation must never swap");
  assert.ok(calls.released >= 1);
});

test("performAutoUpgrade defers on a propagation delay (tarball not yet installable), no mutation", () => {
  const { runtime, calls } = stagedFake({ latest: "999.0.0", fetch: { ok: false, error: "404 tarball" } });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "deferred-propagation");
  assert.equal(calls.stage, 0);
  assert.equal(calls.swap, 0);
  assert.equal(calls.written.lastOutcome, "deferred-propagation");
  assert.equal(calls.written.consecutiveFailures, 1, "a propagation defer must count toward backoff");
});

test("performAutoUpgrade skips (no mutation) when another lane holds the prefix lock", () => {
  const { runtime, calls } = stagedFake({ latest: "999.0.0", lock: { acquired: false, release: () => {} } });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "skipped-locked");
  assert.equal(calls.fetch, 0);
  assert.equal(calls.swap, 0);
});

// M-2: an UNDECIDABLE lock owner (dead-or-unknown → manual intervention) is a distinct,
// boot-VISIBLE outcome — never folded into the quiet skipped-locked (a live installer),
// so the wedge class (the 4-incident lineage) surfaces at boot instead of hiding.
test("performAutoUpgrade surfaces an undecidable lock owner as blocked-undecidable, not skipped-locked (M-2)", () => {
  const { runtime, calls } = stagedFake({
    latest: "999.0.0",
    lock: { acquired: false, reason: "dead-undecidable", release: () => {} }
  });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "blocked-undecidable");
  assert.match(r.message, /undecidable/);
  assert.equal(calls.fetch, 0, "no work is attempted behind an undecidable lock");
  assert.equal(calls.swap, 0);
});

// Idempotence under the lock: the version check runs BEFORE the lock, so a peer lane
// may install the target while we wait. Once we hold the lock, re-reading the global
// version must short-circuit — no re-fetch/stage/swap of ~130 MB.
test("performAutoUpgrade is idempotent under the lock: a peer lane's install short-circuits with no re-stage", () => {
  const { runtime, calls } = stagedFake({ latest: "999.0.0", installed: "999.0.0" });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "already-current");
  assert.equal(r.current, "999.0.0");
  assert.equal(calls.fetch, 0, "no tarball fetch when the global is already at target");
  assert.equal(calls.stage, 0, "no staging when already at target");
  assert.equal(calls.swap, 0, "no swap when already at target");
  assert.ok(calls.released >= 1, "the lock is still released");
});

// Idempotence requires a LOADABLE native module: a version-correct install whose native
// binding fails to load (e.g. a manual `npm i -g` interrupted mid-write) is broken, not
// current. It must be re-staged, never short-circuited to already-current.
test("performAutoUpgrade idempotence: a version-correct but broken-native install is re-staged, not declared current", () => {
  let nativeCalls = 0;
  const { runtime, calls } = stagedFake({
    latest: "999.0.0",
    installed: "999.0.0", // pre-swap global already reports the target...
    runtime: {
      // ...but its native module fails on the idempotence check (1st call); the freshly
      // staged one loads (2nd call), so the re-stage repairs it.
      verifyStagedNative: () => {
        nativeCalls++;
        return nativeCalls === 1 ? { ok: false, error: "broken native binding" } : { ok: true };
      }
    }
  });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.notEqual(r.outcome, "already-current", "a broken-native install must not be declared current");
  assert.equal(r.outcome, "upgraded", "it re-stages and swaps to repair the broken install");
  assert.ok(calls.stage >= 1, "the broken install is re-staged");
  assert.ok(calls.swap >= 1, "and swapped");
});

// R2 staleness alert: a lock far older than any legitimate upgrade, held "live" ONLY
// because its start time is not comparable on this kernel (a reused PID may be masking a
// dead holder), is surfaced as a diagnostic — WITHOUT any reclaim and WITHOUT advising
// removal. Uses a REAL prefix + a real lock record (correct reader identity) since the
// alert re-reads the on-disk record; the fake acquire returns busy.
test("performAutoUpgrade R2: an old, undatable-live lock is surfaced (diagnostic only, no reclaim)", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-r2-"));
  const lockFile = join(prefix, ".h2a-upgrade.lock");
  try {
    // Acquire once with the REAL runtime to get a record carrying this process's true
    // identity (host/boot/ns/pid/start), then release and rewrite it as old + undatable.
    const NOW = 10_000_000_000; // the fake clock the alert's age check reads
    const lease = defaultUpgradeRuntime.acquirePrefixLock(prefix);
    assert.equal(lease.acquired, true, "seed: the real lock acquired");
    const rec = JSON.parse(readFileSync(lockFile, "utf8"));
    lease.release();
    rec.timeNs = null; // proc start no longer comparable ⇒ live is undatable
    rec.at = NOW - (STALE_LOCK_ALERT_MS + 60_000); // older than the alert threshold, on the fake clock
    writeFileSync(lockFile, JSON.stringify(rec), "utf8");

    const diags = [];
    const { runtime } = stagedFake({
      latest: "999.0.0",
      now: NOW,
      lock: { acquired: false, reason: "busy", release: () => {} },
      runtime: { resolvePrefix: () => prefix, writeDiagnostics: (_path, record) => diags.push(record) }
    });
    const r = performAutoUpgrade(CUR, { runtime, prefix });
    // N1: the alert must be a distinct, boot-VISIBLE outcome (plain skipped-locked is
    // suppressed at boot), carrying the message + logPath — never a reclaim.
    assert.equal(r.outcome, "skipped-locked-stale", "an old, undatable-live lock is surfaced, not the quiet skipped-locked");
    assert.match(r.message, /not confirmable on this kernel/);
    assert.ok(r.logPath, "the stale outcome carries the logPath for the operator");
    assert.equal(existsSyncLock(lockFile), true, "the lock is never removed by the alert");
    assert.doesNotMatch(r.message, /\bremove\b/i, "the alert must never advise removing the lock");
    const alert = diags.find((d) => d.outcome === "skipped-locked-stale");
    assert.ok(alert, "the staleness diagnostic is also written to the log");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

// N6 (negative R2): a YOUNG busy lock, or a datable-live holder, must NOT raise the stale
// outcome — it stays the quiet skipped-locked (no false alarm on a healthy fresh install).
test("performAutoUpgrade R2 negative: a young busy lock stays quiet skipped-locked (no false stale alarm)", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-r2n-"));
  const lockFile = join(prefix, ".h2a-upgrade.lock");
  try {
    const NOW = 10_000_000_000;
    const lease = defaultUpgradeRuntime.acquirePrefixLock(prefix);
    assert.equal(lease.acquired, true);
    const rec = JSON.parse(readFileSync(lockFile, "utf8"));
    lease.release();
    rec.timeNs = null; // undatable...
    rec.at = NOW - 1000; // ...but held only ~1s: well under the threshold
    writeFileSync(lockFile, JSON.stringify(rec), "utf8");
    const { runtime } = stagedFake({
      latest: "999.0.0",
      now: NOW,
      lock: { acquired: false, reason: "busy", release: () => {} },
      runtime: { resolvePrefix: () => prefix }
    });
    const r = performAutoUpgrade(CUR, { runtime, prefix });
    assert.equal(r.outcome, "skipped-locked", "a young lock must not raise the stale outcome");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

// N6(d): an OLD lock whose holder is DATABLE (its start time is comparable — a healthy,
// confirmed live process) must NOT raise the stale outcome. The alert targets only the
// undatable case (a reused PID could mask a dead holder); a confirmed-live holder, however
// long it holds, is not that case — no false alarm on a healthy Linux host.
test("performAutoUpgrade R2 negative: an old but DATABLE-live lock stays quiet skipped-locked", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-r2d-"));
  const lockFile = join(prefix, ".h2a-upgrade.lock");
  try {
    const NOW = 10_000_000_000;
    const lease = defaultUpgradeRuntime.acquirePrefixLock(prefix);
    assert.equal(lease.acquired, true);
    const rec = JSON.parse(readFileSync(lockFile, "utf8"));
    lease.release();
    // Keep the real proc start AND the real timeNs (comparable ⇒ datable), just age it.
    rec.at = NOW - (STALE_LOCK_ALERT_MS + 60_000);
    writeFileSync(lockFile, JSON.stringify(rec), "utf8");
    const { runtime } = stagedFake({
      latest: "999.0.0",
      now: NOW,
      lock: { acquired: false, reason: "busy", release: () => {} },
      runtime: { resolvePrefix: () => prefix }
    });
    const r = performAutoUpgrade(CUR, { runtime, prefix });
    assert.equal(r.outcome, "skipped-locked", "a datable-live holder must not raise the stale outcome, even when old");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

// N3: parseLockRec accepts any finite `at`, so `new Date(at).toISOString()` in the
// blocked-undecidable message could throw a RangeError and (at boot) silently swallow the
// whole M-2 alarm. safeAtIso must keep the diagnostic from crashing on an out-of-range at.
test("performAutoUpgrade N3: an out-of-range lock timestamp never crashes the blocked-undecidable diagnostic", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-n3-"));
  const lockFile = join(prefix, ".h2a-upgrade.lock");
  try {
    const lease = defaultUpgradeRuntime.acquirePrefixLock(prefix);
    assert.equal(lease.acquired, true);
    const rec = JSON.parse(readFileSync(lockFile, "utf8"));
    lease.release();
    rec.at = 1e300; // finite but far outside Date's representable range
    writeFileSync(lockFile, JSON.stringify(rec), "utf8");
    const { runtime } = stagedFake({
      latest: "999.0.0",
      lock: { acquired: false, reason: "dead-undecidable", release: () => {} },
      runtime: { resolvePrefix: () => prefix }
    });
    let r;
    assert.doesNotThrow(() => {
      r = performAutoUpgrade(CUR, { runtime, prefix });
    }, "an out-of-range at must not throw out of performAutoUpgrade");
    assert.equal(r.outcome, "blocked-undecidable");
    assert.match(r.message, /epoch-ms:/, "the raw timestamp is shown when it is not a valid date");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

function existsSyncLock(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

test("performAutoUpgrade fails (install intact) when the staged binary reports the wrong version", () => {
  const { runtime, calls } = stagedFake({ latest: "999.0.0", probed: "1.2.3" });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "failed");
  assert.equal(calls.native, 0, "native validation is not reached on a version mismatch");
  assert.equal(calls.swap, 0);
});

test("performAutoUpgrade fails when the post-swap global version does not match the target", () => {
  const { runtime, calls } = stagedFake({ latest: "999.0.0", verified: "0.97.7" });
  const r = performAutoUpgrade(CUR, { runtime, prefix: "/fake/prefix", cachePath: "/x" });
  assert.equal(r.outcome, "failed");
  assert.equal(calls.swap, 1);
  assert.match(r.message, /verification mismatch/);
});

test("performAutoUpgrade throttles a repeated failure/defer on the SAME target (version-indexed backoff)", () => {
  const now = 1_000_000_000;
  const cache = { checkedAt: now, latest: "999.0.0", lastOutcome: "deferred-propagation", consecutiveFailures: 3, lastAttemptVersion: "999.0.0", lastAttemptAt: now - 1000 };
  const { runtime, calls } = stagedFake({ latest: "999.0.0", now, cache });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "skipped-throttled");
  assert.equal(calls.fetch, 0);
  assert.equal(calls.swap, 0);
});

test("performAutoUpgrade does NOT throttle when the target changed since the last failure", () => {
  const now = 1_000_000_000;
  const cache = { checkedAt: now, latest: "999.0.0", lastOutcome: "failed", consecutiveFailures: 5, lastAttemptVersion: "998.0.0", lastAttemptAt: now - 1 };
  const { runtime, calls } = stagedFake({ latest: "999.0.0", now, cache });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "upgraded", "a new target resets the backoff");
  assert.equal(calls.swap, 1);
});

test("performAutoUpgrade reports already-current when no newer version exists", () => {
  const { runtime, calls } = stagedFake({ latest: "0.0.1" });
  const r = performAutoUpgrade(CUR, { runtime, cachePath: "/x", prefix: "/fake/prefix" });
  assert.equal(r.outcome, "already-current");
  assert.equal(calls.swap, 0);
});

// M-3 regression: the version-indexed backoff must ESCALATE across boots that
// cross the 1h TTL. The v2/v3 bug was that checkUpgrade rewrote the cache without
// lastAttemptVersion, so the counter reset to 1 every boot (RED) — a backoff test
// that never crosses the TTL is a false-green, so this one advances `now` past it.
test("performAutoUpgrade backoff escalates across boots crossing the TTL (M-3)", () => {
  const TTL = H2A_AUTO_UPGRADE_CHECK_TTL_MS;
  let cache;
  let now = 1_000_000_000;
  // A persistent in-memory cache + a runtime whose tarball fetch always defers
  // (a persistent failure of the SAME target version).
  const runtimeFor = () => ({
    now: () => now,
    readCache: () => cache,
    writeCache: (_p, e) => { cache = e; },
    fetchLatest: () => "999.0.0",
    resolvePrefix: () => "/fake/prefix",
    completeRepairIfPending: () => false,
    acquirePrefixLock: () => ({ acquired: true, release: () => {} }),
    fetchTarball: () => ({ ok: false, error: "not yet installable" }),
    stageInstall: () => ({ ok: true }),
    probeStagedVersion: () => "999.0.0",
    verifyStagedNative: () => ({ ok: true }),
    swapPackageDir: () => ({ ok: true }),
    // The fetch always defers, so no swap ever lands: the global stays at the
    // pre-existing version (the post-lock idempotence check must not short-circuit).
    readGlobalPkgVersion: () => CUR,
    writeDiagnostics: () => {}
  });
  const counters = [];
  const outcomes = [];
  for (let boot = 0; boot < 6; boot++) {
    outcomes.push(performAutoUpgrade(CUR, { runtime: runtimeFor(), cachePath: "/x", prefix: "/fake/prefix" }).outcome);
    counters.push(cache?.consecutiveFailures ?? 0);
    now += TTL + 60_000; // next boot, past the TTL reset window
  }
  assert.ok(Math.max(...counters) >= 3, `backoff must escalate across TTL boundaries (counters ${JSON.stringify(counters)})`);
  assert.ok(outcomes.includes("skipped-throttled"), "a persistent same-version failure must eventually throttle a boot");
});

test("performAutoUpgrade M2 FAIL-SAFE: an injected runtime missing a method throws, never runs a real op", () => {
  // A legacy 5-method fake (the shape that silently triggered real npm/fs in v1).
  const legacy = {
    fetchLatest: () => "999.0.0",
    runInstall: () => true,
    now: () => 1,
    readCache: () => undefined,
    writeCache: () => {}
  };
  assert.throws(
    () => performAutoUpgrade(CUR, { runtime: legacy, prefix: "/fake/prefix" }),
    /missing runtime method/,
    "a partial injected runtime must fail fast, not fall back to real operations"
  );
});

// ---------------------------------------------------------------------------
// cmdUpgrade — explicit, user-invoked path (no in-place npm i -g fallback).
// ---------------------------------------------------------------------------

test("cmdUpgrade --check reports without installing", () => {
  const { runtime } = stagedFake({ latest: "999.0.0" });
  let out = "";
  const rc = cmdUpgrade({ check: "true" }, { stdout: { write: (c) => void (out += c) }, stderr: { write: () => {} } }, runtime);
  assert.equal(rc, 0);
  assert.match(out, /"upgradeAvailable": true/);
});

test("cmdUpgrade (bare) performs the staged upgrade when one is available", () => {
  const { runtime, calls } = stagedFake({ latest: "999.0.0" });
  let out = "";
  const rc = cmdUpgrade({}, { stdout: { write: (c) => void (out += c) }, stderr: { write: () => {} } }, runtime);
  assert.equal(rc, 0);
  assert.equal(calls.swap, 1);
  assert.equal(calls.install, 0, "the staged path must never use in-place npm i -g");
  assert.match(out, /"upgraded": true/);
});

test("cmdUpgrade (bare) does not upgrade when already current", () => {
  const { runtime, calls } = stagedFake({ latest: "0.0.1" });
  let out = "";
  const rc = cmdUpgrade({}, { stdout: { write: (c) => void (out += c) }, stderr: { write: () => {} } }, runtime);
  assert.equal(rc, 0);
  assert.equal(calls.swap, 0);
  assert.match(out, /"upgraded": false/);
});

test("cmdUpgrade (bare) reports retry-later on a propagation defer, without forcing npm i -g", () => {
  const { runtime, calls } = stagedFake({ latest: "999.0.0", fetch: { ok: false, error: "not yet on registry" } });
  let out = "";
  const rc = cmdUpgrade({}, { stdout: { write: (c) => void (out += c) }, stderr: { write: () => {} } }, runtime);
  assert.equal(rc, 0);
  assert.equal(calls.swap, 0);
  assert.equal(calls.install, 0, "explicit upgrade must not fall back to npm i -g on a propagation delay");
  assert.match(out, /not yet installable|retry later/);
});

test("upgradeCachePath is under the root", () => {
  assert.equal(upgradeCachePath("/r/.h2a"), join("/r/.h2a", "upgrade-check.json"));
});

// ---------------------------------------------------------------------------
// reexec (unchanged).
// ---------------------------------------------------------------------------

test("reexecSelf calls execve with the same binary+args and the guard env set", () => {
  let captured;
  const ok = reexecSelf({
    execve: (file, args, env) => { captured = { file, args, env }; return undefined; },
    execPath: process.execPath,
    argv: ["/path/bin.js", "mcp-serve", "--auto-upgrade"],
    env: { PATH: "/x" }
  });
  assert.equal(ok, true);
  assert.equal(captured.file, process.execPath);
  assert.deepEqual(captured.args, [process.execPath, "/path/bin.js", "mcp-serve", "--auto-upgrade"]);
  assert.equal(captured.env[H2A_REEXEC_GUARD_ENV], "1", "guard env must be set to break re-exec loops");
});

test("reexecSelf returns false (no native crash) when the target binary is missing", () => {
  let called = false;
  assert.equal(
    reexecSelf({ execve: () => { called = true; }, execPath: "/no/such/binary-xyz", argv: [] }),
    false
  );
  assert.equal(called, false, "execve must not be called for a missing target");
});

test("reexecSelf returns false when execve throws (catchable)", () => {
  assert.equal(
    reexecSelf({ execve: () => { throw new Error("ENOSYS"); }, execPath: process.execPath, argv: [] }),
    false
  );
});

test("canReexec reflects process.execve availability", () => {
  assert.equal(canReexec(), typeof process.execve === "function");
});

// N6(c): the boot-visibility filter is a single shared predicate (used by both the
// in-process seam and the boot worker). The actionable states — crucially blocked-undecidable
// (M-2) and skipped-locked-stale (R2) — must NOT be quiet, or a wedged/stale lock would be
// invisible at boot (the visibility B2's acceptance depends on).
test("isQuietUpgradeOutcome: only benign no-op skips are quiet; M-2 and R2 stale surface at boot", () => {
  for (const quiet of ["already-current", "skipped-throttled", "skipped-locked"]) {
    assert.equal(isQuietUpgradeOutcome(quiet), true, `${quiet} should be quiet`);
  }
  for (const loud of ["upgraded", "failed", "deferred-propagation", "blocked-undecidable", "skipped-locked-stale"]) {
    assert.equal(isQuietUpgradeOutcome(loud), false, `${loud} must surface at boot`);
  }
});
