// Exercised (not reasoned) integration tests for the staged auto-upgrade's real
// filesystem behaviors, against the REAL nested/self-contained global layout
// (npm nests h2a's deps under <prefix>/lib/node_modules/@sentropic/h2a/node_modules/).
// Covers: same-filesystem gate + rollback (B2), the exclusive per-prefix lock under
// real multi-process concurrency + stale reclaim (B3), the atomic swap + repair
// marker (kill mid-swap), the staged native-module validation, and an end-to-end
// swap. No npm, no network.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { setupNativeTestEnvironment } from "./helpers/native-isolation.js";
setupNativeTestEnvironment(after);

import { defaultUpgradeRuntime, performAutoUpgrade, H2A_CLI_PACKAGE } from "../dist/index.js";
import { me } from "../dist/runtime/local-files/succession-lock.js";

import * as ptyUpgrade from "../dist/runtime/upgrade/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_CHILD = join(HERE, "upgrade-lock-child.mjs");
const HOOK_CHILD = join(HERE, "upgrade-lock-hook-child.mjs");
const rt = defaultUpgradeRuntime;
const self = me();
const supportsLivenessProof = ["linux", "darwin"].includes(process.platform)
  && self.hostKind === "machine-id"
  && self.boot !== null;

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
async function stopLockChildren(procs) {
  const live = procs.filter(p => p.exitCode === null && p.signalCode === null);
  const exits = live.map(p => once(p, "close").catch(() => {}));
  for (const p of live) p.kill("SIGTERM");
  let timer;
  try {
    const closed = await Promise.race([Promise.all(exits).then(() => true), new Promise(resolve => {
      timer = setTimeout(() => resolve(false), 500);
    })]);
    if (!closed) for (const p of live) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
    await Promise.all(exits);
  } finally { clearTimeout(timer); }
}

async function seedKilledHolder(prefix, context) {
  const p = spawn(process.execPath, [LOCK_CHILD, prefix], { encoding: "utf8" });
  context?.after(() => stopLockChildren([p]));
  const closed = once(p, "close").catch(() => {});
  try {
    const acquired = await firstLinePromise(p);
    p.kill("SIGKILL");
    await closed; // Reap the killed holder, rather than assume death after 80ms.
    return acquired && existsSync(lockPath(prefix));
  } finally { await stopLockChildren([p]); }
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
async function raceLockChildren(prefix, n, context) {
  const procs = Array.from({ length: n }, () =>
    spawn(process.execPath, [LOCK_CHILD, prefix], { encoding: "utf8" })
  );
  context?.after(() => stopLockChildren(procs));
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
  try {
    const results = await Promise.all(procs.map(firstLine));
    return results.filter(Boolean).length;
  } finally { await stopLockChildren(procs); }
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

test("prefix lock: a lock left by a KILLED holder (certainly-dead pid) is reclaimed", { skip: !supportsLivenessProof && "requires a supported, strong host identity with a known boot (Lot 4 §2)", timeout: 20_000 }, async () => {
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

test("prefix lock: a LIVE holder is NEVER reclaimed (liveness, not age — the fail-closed safety)", { skip: !supportsLivenessProof && "requires a supported, strong host identity with a known boot (Lot 4 §2)", timeout: 20_000 }, async () => {
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
test("B-1/R1: a live holder whose start-time comes from a different source is never reclaimed (busy, not undecidable)", { skip: !supportsLivenessProof && "requires a supported, strong host identity with a known boot (Lot 4 §2)", timeout: 20_000 }, async () => {
  const prefix = freshPrefix();
  mkdirSync(prefix, { recursive: true });
  const holder = spawn(process.execPath, [LOCK_CHILD, prefix], { encoding: "utf8" });
  try {
    assert.equal(await firstLinePromise(holder), true, "the live holder acquired");
    // Use the other source on each platform, keeping the LIVE pid/host/boot/ns.
    const rec = JSON.parse(readFileSync(lockPath(prefix), "utf8"));
    rec.start = rec.start?.startsWith("ps:") ? "proc:1" : "ps:Mon Sep 24 08:44:00 2026";
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
test("B3 DETERMINISTIC GATE: a forced succession interleave yields at most one holder", { skip: !supportsLivenessProof && "requires a supported, strong host identity with a known boot (Lot 4 §2)", timeout: 25_000 }, async () => {
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
test("Lemma C GATE: a LOCK replaced by a live owner during the retire window is never deleted", { skip: !supportsLivenessProof && "requires a supported, strong host identity with a known boot (Lot 4 §2)", timeout: 25_000 }, async () => {
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
if (process.env.H2A_LOCK_STRESS) test("B3 LOAD (opt-in): N processes racing a killed-holder lock → exactly one reclaims", { timeout: 120_000 }, async t => {
  for (let i = 0; i < 30; i++) {
    const prefix = freshPrefix();
    try {
      mkdirSync(prefix, { recursive: true });
      assert.equal(await seedKilledHolder(prefix, t), true);
      const acquired = await raceLockChildren(prefix, 24, t);
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

if (process.platform === "linux") test("B2 SAME-FS GATE: a cross-device staging is refused with no mutation", () => {
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
    // This filesystem fixture has no PTY host. Keep that new I/O seam explicit;
    // the real PTY probe/switch is exercised by upgrade-pty-contract.test.ts.
    // Stage a REAL tree for swap/native verification/lock/version validation.
    const runtime = {
      ...rt,
      preparePtyUpgrade: () => ({ state: "absent", owners: [], components: [], legacyHosts: [] }),
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

// Phase B / D28: a pin has an independent lifetime from all component PIDs.
function retainedFixture(prefix, name) {
  const installDir = globalPkgDir(prefix) + '.h2a-prev-' + name;
  const frontendModule = join(installDir, 'dist/native-terminal/frontend-process.js');
  mkdirSync(dirname(frontendModule), {recursive:true}); writeFileSync(frontendModule, 'export {};');
  const codeIdentity = {dev:statSync(frontendModule).dev,ino:statSync(frontendModule).ino};
  const target = {installDir,frontendModule,codeIdentity,ownerProtocolVersion:1};
  const qualification = {ownerProtocolVersion:1,codePath:frontendModule,codeIdentity};
  return {target,qualification};
}

test('should retain the previous install while a live owner or frontend still runs from it', () => {
  const prefix=freshPrefix(), lock=rt.acquirePrefixLock(prefix);
  try {
    const {target}=retainedFixture(prefix,'1.0.0-2147483646-live');
    ptyUpgrade.recordPtyInstallReferences(prefix,lock,target.installDir,[{...me(),token:'test-component',at:Date.now()}]);
    ptyUpgrade.sweepPtyRetainedInstalls(prefix,lock);
    assert.equal(existsSync(target.frontendModule),true);
    ptyUpgrade.recordPtyInstallReferences(prefix,lock,target.installDir,[]);
    ptyUpgrade.sweepPtyRetainedInstalls(prefix,lock);
    assert.equal(existsSync(target.installDir),false,'positive no-reference proof permits an unpinned residue to be reaped');
  } finally {lock.release();rmSync(prefix,{recursive:true,force:true});}
});

test('should keep a rollback pin after all old component references disappear and a sweep runs', () => {
  const prefix=freshPrefix(), lock=rt.acquirePrefixLock(prefix);
  try {
    const {target,qualification}=retainedFixture(prefix,'1.0.0-2147483646-idle');
    ptyUpgrade.recordPtyInstallReferences(prefix,lock,target.installDir,[]);
    ptyUpgrade.pinPtyRollbackFrontend(prefix,lock,target,qualification);
    ptyUpgrade.sweepPtyRetainedInstalls(prefix,lock);
    assert.equal(existsSync(target.frontendModule),true);
    assert.deepEqual(ptyUpgrade.readPtyRollbackFrontend(prefix,1),target);
  } finally {lock.release();rmSync(prefix,{recursive:true,force:true});}
});

test('should release a rollback pin only after a qualified replacement is pinned or B is fully abandoned', () => {
  const prefix=freshPrefix(), lock=rt.acquirePrefixLock(prefix);
  try {
    const old=retainedFixture(prefix,'1.0.0-2147483646-old'), next=retainedFixture(prefix,'1.0.1-2147483646-next');
    ptyUpgrade.recordPtyInstallReferences(prefix,lock,old.target.installDir,[]);
    ptyUpgrade.recordPtyInstallReferences(prefix,lock,next.target.installDir,[]);
    ptyUpgrade.pinPtyRollbackFrontend(prefix,lock,old.target,old.qualification);
    assert.throws(()=>ptyUpgrade.pinPtyRollbackFrontend(prefix,lock,next.target,{...next.qualification,ownerProtocolVersion:99}));
    assert.deepEqual(ptyUpgrade.readPtyRollbackFrontend(prefix,1),old.target);
    ptyUpgrade.pinPtyRollbackFrontend(prefix,lock,next.target,next.qualification);
    ptyUpgrade.sweepPtyRetainedInstalls(prefix,lock);
    assert.equal(existsSync(old.target.installDir),false);
    assert.equal(existsSync(next.target.installDir),true);
  } finally {lock.release();rmSync(prefix,{recursive:true,force:true});}
});

test('should keep retained installs when pin or reference metadata is unreadable', () => {
  const prefix=freshPrefix(), lock=rt.acquirePrefixLock(prefix);
  try {
    const {target}=retainedFixture(prefix,'1.0.0-2147483646-unknown');
    const info=statSync(target.installDir);
    const installs={[target.installDir]:{identity:{dev:info.dev,ino:info.ino},components:[]}};
    for(const bytes of ['{broken',JSON.stringify({version:1,pins:[],installs}),JSON.stringify({version:1,pins:{},installs,unknownReferences:0})]) {
      writeFileSync(join(prefix,'.h2a-pty-retention.json'),bytes);
      ptyUpgrade.sweepPtyRetainedInstalls(prefix,lock);
      assert.equal(existsSync(target.frontendModule),true,'invalid metadata is not absence of a rollback pin');
    }
  } finally {lock.release();rmSync(prefix,{recursive:true,force:true});}
});


test('should recover a rollback pin by code identity after a crash between install rename and retention relocation', () => {
  const prefix=freshPrefix(), lock=rt.acquirePrefixLock(prefix);
  try {
    const current=globalPkgDir(prefix), stage=stagedPkgDir(join(prefix,'.stage'));
    for(const [dir,version] of [[current,'1.0.0'],[stage,'1.0.1']]) {
      writeSelfContainedPkg(dir,version);mkdirSync(join(dir,'dist/native-terminal'),{recursive:true});writeFileSync(join(dir,'dist/native-terminal/frontend-process.js'),'export const version='+JSON.stringify(version)+';');
    }
    const frontendModule=join(current,'dist/native-terminal/frontend-process.js');
    const codeIdentity={dev:statSync(frontendModule).dev,ino:statSync(frontendModule).ino};
    ptyUpgrade.recordPtyInstallReferences(prefix,lock,current,[]);
    ptyUpgrade.pinPtyRollbackFrontend(prefix,lock,{installDir:current,frontendModule,ownerProtocolVersion:1,codeIdentity},{ownerProtocolVersion:1,codePath:frontendModule,codeIdentity});
    const swap=rt.swapPackageDir(prefix,stage,'1.0.1');assert.equal(swap.ok,true);
    // No relocation callback: this is the interrupted interval.
    const pin=ptyUpgrade.readPtyRollbackFrontend(prefix,1);
    assert.equal(pin.frontendModule,join(swap.prevDir,'dist/native-terminal/frontend-process.js'));
    assert.equal(statSync(pin.frontendModule).ino,codeIdentity.ino);
    ptyUpgrade.recordPtyInstallReferences(prefix,lock,swap.prevDir,[]);
    ptyUpgrade.sweepPtyRetainedInstalls(prefix,lock);
    assert.equal(existsSync(pin.frontendModule),true,'the identity pin protects its relocated install from every sweep');
  } finally {lock.release();rmSync(prefix,{recursive:true,force:true});}
});

test('should refuse a colliding backup destination without deleting its retained frontend', () => {
  const prefix=freshPrefix(), crypto=createRequire(import.meta.url)('node:crypto'), original=crypto.randomUUID;
  try {
    writeSelfContainedPkg(globalPkgDir(prefix),'1.0.0');
    const occupied=retainedFixture(prefix,'1.0.0-'+process.pid+'-aaaaaaaa');
    const stage=stagedPkgDir(join(prefix,'.stage'));writeSelfContainedPkg(stage,'1.0.1');
    crypto.randomUUID=()=> 'aaaaaaaa-0000-0000-0000-000000000000';syncBuiltinESMExports();
    const result=rt.swapPackageDir(prefix,stage,'1.0.1');
    assert.equal(result.ok,false);assert.equal(existsSync(occupied.target.frontendModule),true);
    assert.equal(rt.readGlobalPkgVersion(prefix),'1.0.0');
  } finally {crypto.randomUUID=original;syncBuiltinESMExports();rmSync(prefix,{recursive:true,force:true});}
});


test('should retain a deferred legacy result when the installed frontend is already current', () => {
  const prefix=freshPrefix(), current=globalPkgDir(prefix);
  try {
    writeSelfContainedPkg(current,'1.0.0');
    const frontendModule=join(current,'node_modules/@sentropic/h2a-runtime/dist/native-terminal/frontend-process.js');
    mkdirSync(dirname(frontendModule),{recursive:true});writeFileSync(frontendModule,'export {};');
    const codeIdentity={dev:statSync(frontendModule).dev,ino:statSync(frontendModule).ino};
    const loaded={pid:process.pid,version:'1.0.0',codePath:frontendModule,codeIdentity};
    const plan={state:'active',owners:[{socketPath:join(prefix,'b.sock'),status:{ownerProtocolVersion:1,owner:loaded,frontend:loaded}}],
      components:[loaded],legacyHosts:[{socketPath:join(prefix,'lf1.sock'),hostPid:process.pid}]};
    const result=performAutoUpgrade('1.0.0',{prefix,runtime:{...rt,fetchLatest:()=> '1.0.0',preparePtyUpgrade:()=>plan,
      switchPtyFrontend:()=>{throw new Error('no replacement needed');}}});
    assert.equal(result.outcome,'pty-deferred');
    assert.equal(result.pty.status,'deferred');
    assert.equal(result.pty.owners.length,2);
    assert.equal(result.pty.owners.find(owner=>owner.socketPath===plan.legacyHosts[0].socketPath)?.status,'deferred');
    assert.equal(result.pty.owners.find(owner=>owner.socketPath===plan.owners[0].socketPath)?.status,'switched');
  } finally {rmSync(prefix,{recursive:true,force:true});}
});
