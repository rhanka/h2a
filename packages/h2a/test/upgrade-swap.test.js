// Exercised (not reasoned) integration tests for the staged auto-upgrade's real
// filesystem behaviors, against the REAL nested/self-contained global layout
// (npm nests h2a's deps under <prefix>/lib/node_modules/@sentropic/h2a/node_modules/).
// Covers: same-filesystem gate + rollback (B2), the exclusive per-prefix lock under
// real multi-process concurrency + stale reclaim (B3), the atomic swap + repair
// marker (kill mid-swap), the staged native-module validation, and an end-to-end
// swap. No npm, no network.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { defaultUpgradeRuntime, performAutoUpgrade, H2A_CLI_PACKAGE } from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_CHILD = join(HERE, "upgrade-lock-child.mjs");
const HOOK_CHILD = join(HERE, "upgrade-lock-hook-child.mjs");
const rt = defaultUpgradeRuntime;

function firstLinePromise(p) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const settle = (v) => { if (!done) { done = true; resolve(v); } };
    p.stdout.on("data", (c) => {
      out += c.toString("utf8");
      const nl = out.indexOf("\n");
      if (nl >= 0) { try { settle(JSON.parse(out.slice(0, nl)).acquired === true); } catch { settle(false); } }
    });
    p.on("close", () => settle(false));
    p.on("error", () => settle(false));
  });
}

async function waitFile(path, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (!existsSync(path) && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  return existsSync(path);
}

// Seed a REAL v3-format stale lock: a child acquires, is SIGKILL'd while holding
// (no release runs), leaving a lock file owned by a now-dead pid — the exact incident.
function seedKilledHolder(prefix) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [LOCK_CHILD, prefix], { encoding: "utf8" });
    let out = "";
    p.stdout.on("data", (c) => {
      out += c.toString("utf8");
      if (out.includes("\n")) {
        let acq = false;
        try { acq = JSON.parse(out.split("\n")[0]).acquired === true; } catch {}
        p.kill("SIGKILL");
        setTimeout(() => resolve(acq && existsSync(lockPath(prefix))), 80);
      }
    });
    p.on("error", () => resolve(false));
  });
}

const globalPkgDir = (prefix) => join(prefix, "lib", "node_modules", H2A_CLI_PACKAGE);
const stagedPkgDir = (stagingPrefix) => join(stagingPrefix, "lib", "node_modules", H2A_CLI_PACKAGE);
const markerPath = (prefix) => join(prefix, "lib", "node_modules", ".h2a-upgrade-swap.json");
const lockPath = (prefix) => join(prefix, ".h2a-upgrade.lock");

function freshPrefix() {
  return mkdtempSync(join(tmpdir(), "h2a-upg-"));
}

// Spawn N lock-child processes CONCURRENTLY (all started before any finishes, so
// they truly race). Each acquirer HOLDS until killed, so the result is load-robust:
// read each child's first line (acquired true/false), count the acquirers, then
// SIGTERM every child. Exactly one acquirer is the mutual-exclusion invariant.
function raceLockChildren(prefix, n) {
  const procs = Array.from({ length: n }, () =>
    spawn(process.execPath, [LOCK_CHILD, prefix], { encoding: "utf8" })
  );
  const firstLine = (p) => new Promise((resolve) => {
    let out = "";
    let done = false;
    const settle = (val) => { if (!done) { done = true; resolve(val); } };
    p.stdout.on("data", (c) => {
      out += c.toString("utf8");
      const nl = out.indexOf("\n");
      if (nl >= 0) {
        try { settle(JSON.parse(out.slice(0, nl)).acquired === true); }
        catch { settle(false); }
      }
    });
    p.on("close", () => settle(false));
    p.on("error", () => settle(false));
  });
  return Promise.all(procs.map(firstLine)).then((results) => {
    for (const p of procs) { try { p.kill("SIGTERM"); } catch { /* best-effort */ } }
    return results.filter(Boolean).length;
  });
}
// Write a SELF-CONTAINED package dir: its own package.json + nested node_modules,
// mirroring the real npm global layout.
function writeSelfContainedPkg(pkgDir, version, { withNative = true, nativeThrows = false } = {}) {
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: H2A_CLI_PACKAGE, version }), "utf8");
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  // A runnable bin that reports the version, so the REAL probeStagedVersion works.
  writeFileSync(join(pkgDir, "dist", "bin.js"), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(version)});\n`, "utf8");
  if (withNative) {
    const pty = join(pkgDir, "node_modules", "node-pty");
    mkdirSync(pty, { recursive: true });
    writeFileSync(join(pty, "package.json"), JSON.stringify({ name: "node-pty", version: "1.1.0", main: "index.js" }), "utf8");
    writeFileSync(join(pty, "index.js"), nativeThrows ? "throw new Error('node-pty ABI mismatch');\n" : "module.exports = { spawn() {} };\n", "utf8");
  }
}

test("prefix lock: release only removes the lock the caller owns (no stealing another owner)", () => {
  const prefix = freshPrefix();
  try {
    const a = rt.acquirePrefixLock(prefix);
    assert.equal(a.acquired, true);
    // Simulate another owner overwriting the lock file with a different token.
    writeFileSync(lockPath(prefix), JSON.stringify({ pid: process.pid, at: Date.now(), token: "someone-else" }), "utf8");
    a.release(); // must be a no-op: our token no longer owns the file
    assert.equal(existsSync(lockPath(prefix)), true, "release must not delete a lock owned by a different token");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("prefix lock: a lock left by a KILLED holder (certainly-dead pid) is reclaimed", { timeout: 20_000 }, async () => {
  const prefix = freshPrefix();
  try {
    mkdirSync(prefix, { recursive: true });
    const seeded = await seedKilledHolder(prefix); // real v3 lock owned by a now-dead pid
    assert.equal(seeded, true, "seed: a real lock file remains after the holder was killed");
    const a = rt.acquirePrefixLock(prefix);
    assert.equal(a.acquired, true, "a certainly-dead holder's lock is reclaimed");
    a.release();
    assert.equal(existsSync(lockPath(prefix)), false);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("prefix lock: a LIVE holder is NEVER reclaimed (liveness, not age — the fail-closed safety)", { timeout: 20_000 }, async () => {
  const prefix = freshPrefix();
  mkdirSync(prefix, { recursive: true });
  const holder = spawn(process.execPath, [LOCK_CHILD, prefix], { encoding: "utf8" });
  try {
    assert.equal(await firstLinePromise(holder), true, "the live holder acquired");
    const b = rt.acquirePrefixLock(prefix);
    assert.equal(b.acquired, false, "a live holder must never be broken (no age-based reclaim)");
    assert.equal(b.reason, "busy");
  } finally {
    holder.kill("SIGTERM");
    rmSync(prefix, { recursive: true, force: true });
  }
});

// B-1 / R1 (cross-source liveness safety): a LIVE holder whose lock records a start
// from a DIFFERENT source (e.g. a macOS `ps:` record read by a Linux `proc:` reader —
// or a mixed roll) has an UNDATABLE start ⇒ "live", so it is never reclaimed. Comparing
// format-fragile start values across sources is exactly what let two TZ-skewed lanes
// declare a live holder dead. R1: this is the SAME rule as an unknown time namespace —
// not comparable ⇒ live (busy), NOT undecidable (which would raise a false M-2 alarm on
// a healthy holder). It still must never be reclaimed; only the reason changes to "busy".
test("B-1/R1: a live holder whose start-time comes from a different source is never reclaimed (busy, not undecidable)", { timeout: 20_000 }, async () => {
  const prefix = freshPrefix();
  mkdirSync(prefix, { recursive: true });
  const holder = spawn(process.execPath, [LOCK_CHILD, prefix], { encoding: "utf8" });
  try {
    assert.equal(await firstLinePromise(holder), true, "the live holder acquired");
    // Rewrite the on-disk record's start to a foreign source (simulate a macOS
    // `ps:`-sourced holder), keeping the same LIVE pid/host/boot/ns.
    const rec = JSON.parse(readFileSync(lockPath(prefix), "utf8"));
    rec.start = "ps:Mon Sep 24 08:44:00 2026";
    writeFileSync(lockPath(prefix), JSON.stringify(rec), "utf8");
    const b = rt.acquirePrefixLock(prefix);
    assert.equal(b.acquired, false, "a live holder with a cross-source start-time must not be reclaimed");
    assert.equal(b.reason, "busy", "an undatable cross-source start ⇒ live ⇒ busy (never undecidable/M-2 on a healthy holder)");
  } finally {
    holder.kill("SIGTERM");
    rmSync(prefix, { recursive: true, force: true });
  }
});

// CI GATE (deterministic, no timing luck): pause actor A mid-succession (right
// after it elected itself successor of the dead holder), race actor B into the
// same reclaim while A is paused, then release A. A broken reclaim lets both hold;
// the proven algorithm admits at most one.
test("B3 DETERMINISTIC GATE: a forced succession interleave yields at most one holder", { timeout: 25_000 }, async () => {
  const prefix = freshPrefix();
  let A, B;
  try {
    mkdirSync(prefix, { recursive: true });
    assert.equal(await seedKilledHolder(prefix), true, "seed a dead holder to trigger the reclaim path");
    const pause = join(prefix, "pause.sentinel");
    const reached = join(prefix, "reached.sentinel");
    A = spawn(process.execPath, [HOOK_CHILD, prefix, "afterPublishSucc", pause, reached], { encoding: "utf8" });
    const aFirst = firstLinePromise(A);
    assert.equal(await waitFile(reached, 12_000), true, "actor A reached the succession-election hook");
    B = spawn(process.execPath, [LOCK_CHILD, prefix], { encoding: "utf8" });
    const bAcq = await firstLinePromise(B); // resolves while A is paused mid-succession
    writeFileSync(pause, "go", "utf8"); // let A finish
    const aAcq = await aFirst;
    // Hardened: not merely "<= 1" (which accepts zero). The elected successor A
    // must acquire, and B — racing while A held the succession — must be refused.
    assert.equal(aAcq, true, "the elected successor A must acquire the lock");
    assert.equal(bAcq, false, "B, racing A's held succession, must be refused (never a second holder, never zero)");
  } finally {
    try { A?.kill("SIGKILL"); } catch { /* */ }
    try { B?.kill("SIGKILL"); } catch { /* */ }
    rmSync(prefix, { recursive: true, force: true });
  }
});

// CI GATE (deterministic, Lemma C — targeted unlink): a successor that elected itself
// for a dead holder g must unlink LOCK only while it is STILL exactly g. We pause the
// successor at `beforeRetireUnlink` (it has already decided LOCK == g), then — in that
// window — REPLACE LOCK with a fresh, LIVE owner r0 (a different token: a manual
// intervention or a new holder). On resume the successor must NOT delete r0 and must
// NOT acquire; it re-evaluates and finds r0 live (busy). Pre-Lemma-C code decided from
// the stale read and blind-unlinked r0 — deleting a live holder's lock, then acquiring.
test("Lemma C GATE: a LOCK replaced by a live owner during the retire window is never deleted", { timeout: 25_000 }, async () => {
  const prefix = freshPrefix();
  const otherPrefix = freshPrefix();
  let holder, succ;
  try {
    mkdirSync(prefix, { recursive: true });
    mkdirSync(otherPrefix, { recursive: true });
    // A genuinely LIVE holder in a DIFFERENT prefix, so its on-disk record describes
    // an alive process on this host (livenessOf → live). We reuse that record as r0.
    holder = spawn(process.execPath, [LOCK_CHILD, otherPrefix], { encoding: "utf8" });
    assert.equal(await firstLinePromise(holder), true, "the live owner acquired its own prefix lock");
    const r0 = readFileSync(lockPath(otherPrefix), "utf8");
    const r0token = JSON.parse(r0).token;

    // Seed a certainly-dead holder g in our prefix, then pause a successor right
    // before it unlinks g.
    assert.equal(await seedKilledHolder(prefix), true, "seed a dead holder to trigger the reclaim path");
    const pause = join(prefix, "pause.sentinel");
    const reached = join(prefix, "reached.sentinel");
    succ = spawn(process.execPath, [HOOK_CHILD, prefix, "beforeRetireUnlink", pause, reached], { encoding: "utf8" });
    const succFirst = firstLinePromise(succ);
    assert.equal(await waitFile(reached, 12_000), true, "the successor reached the pre-unlink hook");

    // In the retire window, LOCK becomes a live owner r0 (a token != g).
    writeFileSync(lockPath(prefix), r0, "utf8");

    writeFileSync(pause, "go", "utf8"); // let the successor resume
    const succAcq = await succFirst;

    assert.equal(succAcq, false, "the successor must NOT acquire: LOCK is now a live owner, not g");
    assert.equal(existsSync(lockPath(prefix)), true, "LOCK must survive: a lock we do not own is never deleted");
    assert.equal(JSON.parse(readFileSync(lockPath(prefix), "utf8")).token, r0token, "LOCK still bears the live owner's token, untouched");
  } finally {
    try { succ?.kill("SIGKILL"); } catch { /* */ }
    try { holder?.kill("SIGTERM"); } catch { /* */ }
    rmSync(prefix, { recursive: true, force: true });
    rmSync(otherPrefix, { recursive: true, force: true });
  }
});

// Opt-in LOAD test (statistical, time/load-dependent). Not in the default suite —
// run with H2A_LOCK_STRESS=1. Establishes frequency under real concurrency; the
// deterministic gate above is the regression guard.
test("B3 LOAD (opt-in): N processes racing a killed-holder lock → exactly one reclaims", { skip: !process.env.H2A_LOCK_STRESS, timeout: 120_000 }, async () => {
  for (let i = 0; i < 30; i++) {
    const prefix = freshPrefix();
    try {
      mkdirSync(prefix, { recursive: true });
      assert.equal(await seedKilledHolder(prefix), true);
      const acquired = await raceLockChildren(prefix, 24);
      assert.equal(acquired, 1, `iter ${i}: exactly one of 24 racers may reclaim (got ${acquired})`);
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  }
});

// N2 (Windows layout regression): the post-lock idempotence native check must resolve the
// LIVE global package dir by layout (flat <prefix>/node_modules/<pkg> on Windows, nested
// <prefix>/lib/node_modules/<pkg> on Linux/macOS), not the always-nested staged path — or
// on Windows it would never find the native module, never report already-current, and
// re-stage ~130 MB on every lane. Real fs + real readGlobalPkgVersion/verifyStagedNative.
test("N2 idempotence: a flat-layout global at target with a loadable native is already-current (no re-stage)", () => {
  const prefix = freshPrefix();
  try {
    writeSelfContainedPkg(join(prefix, "node_modules", H2A_CLI_PACKAGE), "999.0.0", { withNative: true });
    const calls = { fetch: 0, stage: 0, swap: 0 };
    const runtime = {
      now: () => 1,
      readCache: () => undefined,
      writeCache: () => {},
      fetchLatest: () => "999.0.0",
      runInstall: () => true,
      resolvePrefix: () => prefix,
      completeRepairIfPending: () => false,
      acquirePrefixLock: () => ({ acquired: true, release: () => {} }),
      fetchTarball: () => { calls.fetch++; return { ok: true, file: "/x.tgz" }; },
      stageInstall: () => { calls.stage++; return { ok: true }; },
      probeStagedVersion: () => "999.0.0",
      verifyStagedNative: rt.verifyStagedNative, // REAL: loads node-pty from the given dir
      swapPackageDir: () => { calls.swap++; return { ok: true, repaired: false }; },
      readGlobalPkgVersion: rt.readGlobalPkgVersion, // REAL: finds the flat layout
      writeDiagnostics: () => {}
    };
    const r = performAutoUpgrade("0.97.7", { runtime, prefix });
    assert.equal(r.outcome, "already-current", "a flat-layout install at target with a loadable native is current");
    assert.equal(calls.fetch, 0, "no re-fetch");
    assert.equal(calls.stage, 0, "no re-stage on the flat (Windows) layout");
    assert.equal(calls.swap, 0);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("verifyStagedNative: loads a present native module, fails when it cannot load", () => {
  const prefix = freshPrefix();
  try {
    const okDir = stagedPkgDir(join(prefix, "ok"));
    writeSelfContainedPkg(okDir, "0.98.0", { withNative: true, nativeThrows: false });
    assert.equal(rt.verifyStagedNative(okDir).ok, true, "a loadable native module validates");

    const badDir = stagedPkgDir(join(prefix, "bad"));
    writeSelfContainedPkg(badDir, "0.98.0", { withNative: true, nativeThrows: true });
    assert.equal(rt.verifyStagedNative(badDir).ok, false, "a native module that throws on load fails validation");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("swapPackageDir: happy path replaces the self-contained dir and clears the marker", () => {
  const prefix = freshPrefix();
  try {
    writeSelfContainedPkg(globalPkgDir(prefix), "0.97.7");
    const staging = join(prefix, ".stage");
    writeSelfContainedPkg(stagedPkgDir(staging), "0.97.8");
    const r = rt.swapPackageDir(prefix, stagedPkgDir(staging), "0.97.8");
    assert.equal(r.ok, true);
    assert.equal(rt.readGlobalPkgVersion(prefix), "0.97.8");
    assert.equal(existsSync(join(globalPkgDir(prefix), "node_modules", "node-pty")), true, "the swapped dir keeps its nested deps");
    assert.equal(existsSync(markerPath(prefix)), false, "marker cleared on success");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("B2 SAME-FS GATE: a cross-device staging is refused with no mutation", { skip: !existsSync("/dev/shm") }, () => {
  const prefix = freshPrefix();
  const shmStaging = mkdtempSync(join("/dev/shm", "h2a-upg-shm-"));
  try {
    writeSelfContainedPkg(globalPkgDir(prefix), "0.97.7");
    writeSelfContainedPkg(stagedPkgDir(shmStaging), "0.97.8");
    const r = rt.swapPackageDir(prefix, stagedPkgDir(shmStaging), "0.97.8");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /cross-device/);
    assert.equal(rt.readGlobalPkgVersion(prefix), "0.97.7", "the install is untouched when the FS gate fails");
    assert.equal(existsSync(markerPath(prefix)), false, "no marker is left behind");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
    rmSync(shmStaging, { recursive: true, force: true });
  }
});

test("KILL MID-SWAP: a process that died between the two renames repairs FORWARD on next boot", () => {
  const prefix = freshPrefix();
  try {
    const current = globalPkgDir(prefix);
    const prev = `${current}.h2a-prev-0.97.7-x`;
    const staging = stagedPkgDir(join(prefix, ".stage"));
    writeSelfContainedPkg(prev, "0.97.7");
    writeSelfContainedPkg(staging, "0.97.8");
    mkdirSync(join(prefix, "lib", "node_modules"), { recursive: true });
    writeFileSync(markerPath(prefix), JSON.stringify({ phase: "backed-up", prefix, currentDir: current, prevDir: prev, stagingPkgDir: staging, version: "0.97.8", at: Date.now(), pid: 2147483646 }), "utf8");
    assert.equal(existsSync(current), false, "precondition: current dir missing (mid-swap)");
    assert.equal(rt.completeRepairIfPending(prefix), true);
    assert.equal(existsSync(current), true, "install restored to a usable state");
    assert.equal(rt.readGlobalPkgVersion(prefix), "0.97.8", "forward completion lands the staged version");
    assert.equal(existsSync(markerPath(prefix)), false);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("KILL MID-SWAP: if staging is gone, repair ROLLS BACK to the previous version", () => {
  const prefix = freshPrefix();
  try {
    const current = globalPkgDir(prefix);
    const prev = `${current}.h2a-prev-0.97.7-y`;
    const staging = stagedPkgDir(join(prefix, ".stage")); // never created
    writeSelfContainedPkg(prev, "0.97.7");
    mkdirSync(join(prefix, "lib", "node_modules"), { recursive: true });
    writeFileSync(markerPath(prefix), JSON.stringify({ phase: "backed-up", prefix, currentDir: current, prevDir: prev, stagingPkgDir: staging, version: "0.97.8", at: Date.now(), pid: 2147483646 }), "utf8");
    assert.equal(rt.completeRepairIfPending(prefix), true);
    assert.equal(existsSync(current), true, "install remains usable after rollback");
    assert.equal(rt.readGlobalPkgVersion(prefix), "0.97.7", "rollback restores the previous version");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL (real fs): performAutoUpgrade swaps the real self-contained dir end to end", () => {
  const prefix = freshPrefix();
  try {
    writeSelfContainedPkg(globalPkgDir(prefix), "0.97.7");
    // Fake only the network/npm steps; stage a REAL self-contained tree that the
    // real swap/native-verify/lock/verify then operate on.
    const runtime = {
      ...rt,
      fetchLatest: () => "0.97.8",
      now: () => Date.now(),
      readCache: () => undefined,
      writeCache: () => {},
      resolvePrefix: () => prefix,
      fetchTarball: () => ({ ok: true, file: join(prefix, "fake.tgz") }),
      stageInstall: (_tarball, stagingPrefix) => {
        writeSelfContainedPkg(stagedPkgDir(stagingPrefix), "0.97.8", { withNative: true });
        return { ok: true };
      }
      // probeStagedVersion / verifyStagedNative / swapPackageDir / readGlobalPkgVersion /
      // acquirePrefixLock / completeRepairIfPending / writeDiagnostics: REAL defaults.
    };
    const r = performAutoUpgrade("0.97.7", { runtime, prefix, cachePath: join(prefix, "upgrade-check.json") });
    assert.equal(r.outcome, "upgraded", r.message);
    assert.equal(r.verifiedVersion, "0.97.8");
    assert.equal(rt.readGlobalPkgVersion(prefix), "0.97.8");
    assert.equal(existsSync(join(globalPkgDir(prefix), "node_modules", "node-pty")), true, "the new install carries its own nested deps");
    assert.equal(existsSync(lockPath(prefix)), false, "the prefix lock is released");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL (real fs): a staged native that cannot load leaves the real install untouched", () => {
  const prefix = freshPrefix();
  try {
    writeSelfContainedPkg(globalPkgDir(prefix), "0.97.7");
    const runtime = {
      ...rt,
      fetchLatest: () => "0.98.0",
      now: () => Date.now(),
      readCache: () => undefined,
      writeCache: () => {},
      resolvePrefix: () => prefix,
      fetchTarball: () => ({ ok: true, file: join(prefix, "fake.tgz") }),
      stageInstall: (_tarball, stagingPrefix) => {
        writeSelfContainedPkg(stagedPkgDir(stagingPrefix), "0.98.0", { withNative: true, nativeThrows: true });
        return { ok: true };
      }
    };
    const r = performAutoUpgrade("0.97.7", { runtime, prefix, cachePath: join(prefix, "upgrade-check.json") });
    assert.equal(r.outcome, "failed", r.message);
    assert.equal(rt.readGlobalPkgVersion(prefix), "0.97.7", "the existing install is left usable and unchanged");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});
