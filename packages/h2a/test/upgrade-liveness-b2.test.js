// B2 liveness decomposition (platform simulations that a single-platform CI cannot
// otherwise exercise). Each test is RED against the pre-B2 behaviour:
//   - the namespace readers ignored the platform → returned the Linux id (or null)
//     instead of the known "host" sentinel, so a macOS/Windows dead holder read as
//     a foreign namespace → undecidable → NEVER reclaimed (the 4-incident class);
//   - livenessOf compared two null namespaces as if co-located, and skipped the
//     time-namespace check when it was unknown → a live holder declared "dead".
// The classifier + livenessOf are exported from the package for exactly this matrix.
import assert from "node:assert/strict";
import test from "node:test";

import { livenessOf, procStartInfo, readPidNs, readTimeNs } from "../dist/index.js";

const ABSENT_PID = 999_999_999; // no such process → kill(0) ESRCH
const tok = "a".repeat(20);

const throwCode = (code) => () => {
  const e = new Error(code);
  e.code = code;
  throw e;
};

// A platform without namespaces must yield the KNOWN sentinel "host", never null:
// null would make a same-host dead holder undecidable and wedge upgrades forever.
test("B2 readPidNs/readTimeNs: a platform without namespaces yields the known 'host' sentinel", () => {
  assert.equal(readPidNs("darwin"), "host");
  assert.equal(readPidNs("win32"), "host");
  assert.equal(readTimeNs("darwin"), "host");
  assert.equal(readTimeNs("win32"), "host");
});

// timeNs is SYMMETRIC with pidNs: any Linux /proc failure is unknown (null), never a
// false "host". A masked /proc (ns/pid present, ns/time hidden while time namespaces
// ARE in use — gVisor / some sandboxes) must NOT read as "host": that would compare
// start times across time bases and risk a false death (the B-1 class). null is safe
// here because an unknown time base routes to "start not comparable ⇒ live".
test("B2 readTimeNs: any Linux /proc failure is unknown (null), symmetric with readPidNs", () => {
  assert.equal(readTimeNs("linux", throwCode("ENOENT")), null);
  assert.equal(readTimeNs("linux", throwCode("EACCES")), null);
});

// pidNs is the conservative gate that decides reclaim: /proc/self/ns/pid is present
// on every healthy Linux /proc, so ANY failure is unknown (null), never a false
// "host" that could match a foreign namespace.
test("B2 readPidNs: any Linux /proc failure is the conservative unknown (null), never a false 'host'", () => {
  assert.equal(readPidNs("linux", throwCode("ENOENT")), null);
  assert.equal(readPidNs("linux", throwCode("EACCES")), null);
});

// Vivacity: a certainly-dead holder recorded on a no-namespace platform must be
// reclaimable. Built through the REAL readers so a regression to null re-wedges it.
for (const plat of ["darwin", "win32"]) {
  test(`B2 vivacity(${plat}-sim): a dead holder is certainly-dead (reclaimable), never undecidable`, () => {
    const self = {
      host: "h",
      boot: "b",
      ns: readPidNs(plat),
      timeNs: readTimeNs(plat),
      pid: process.pid,
      start: "ps:now"
    };
    const dead = {
      host: "h",
      boot: "b",
      ns: "host",
      timeNs: "host",
      pid: ABSENT_PID,
      start: "ps:Mon Sep 21 00:00:00 2026",
      token: tok,
      at: Date.now()
    };
    assert.equal(livenessOf(dead, self), "dead");
  });
}

// The incident branch (PID absent in a known shared namespace) never consults timeNs,
// so a disappeared holder is reclaimed even when the time base is UNKNOWN (null). This
// is what keeps an unknown time namespace from ever wedging a real incident.
test("B2 vivacity(unknown time base): a disappeared holder is reclaimed with timeNs null", () => {
  const self = { host: "h", boot: "b", ns: "nsX", timeNs: null, pid: process.pid, start: "proc:1" };
  const dead = { host: "h", boot: "b", ns: "nsX", timeNs: null, pid: ABSENT_PID, start: "proc:2", token: tok, at: Date.now() };
  assert.equal(livenessOf(dead, self), "dead"); // pid absent in a known shared ns ⇒ dead
});

// Null-equality: two records whose namespace is unreadable (null) must never be
// treated as co-located. A live holder (this very process) would otherwise be
// declared dead and its lock reclaimed → a second holder.
test("B2 null-namespace: two null namespaces are undecidable, never a false co-location", () => {
  const self = { host: "h", boot: "b", ns: null, timeNs: null, pid: process.pid, start: "proc:1" };
  const r = { host: "h", boot: "b", ns: null, timeNs: null, pid: process.pid, start: "proc:1", token: tok, at: Date.now() };
  assert.equal(livenessOf(r, self), "undecidable");
});

// A proc-sourced comparison with an UNKNOWN time namespace (null) is not comparable,
// so the recorded start is undatable ⇒ "live": a live holder is never falsely
// reclaimed AND never falsely declared dead. Critically it is NOT undecidable, so a
// healthy live holder with an unreadable time base raises no false M-2 alarm.
test("B2 time-namespace: an unknown time namespace on a proc comparison is 'live' (undatable), not undecidable", () => {
  const self = { host: "h", boot: "b", ns: "nsX", timeNs: "host", pid: process.pid, start: "proc:1" };
  // Same live pid, a DIFFERENT recorded proc start, but the record's time namespace
  // is unknown: the comparison cannot conclude reuse ⇒ undatable ⇒ live.
  const r = {
    host: "h",
    boot: "b",
    ns: "nsX",
    timeNs: null,
    pid: process.pid,
    start: "proc:999999999",
    token: tok,
    at: Date.now()
  };
  assert.equal(livenessOf(r, self), "live");
});

// Two DIFFERENT known time namespaces on a proc comparison are also not comparable
// (the classic time-ns skew) ⇒ undatable ⇒ live. Never a false death, no M-2 noise.
test("B2 time-namespace: two different known time namespaces on a proc comparison are 'live' (undatable)", () => {
  const self = { host: "h", boot: "b", ns: "nsX", timeNs: "time:[A]", pid: process.pid, start: "proc:1" };
  const r = {
    host: "h",
    boot: "b",
    ns: "nsX",
    timeNs: "time:[B]",
    pid: process.pid,
    start: "proc:999999999",
    token: tok,
    at: Date.now()
  };
  assert.equal(livenessOf(r, self), "live");
});

// h-cond's masked-/proc case (gVisor / sandbox): ns/pid is readable (a real id), but
// ns/time is hidden (ENOENT → null) while time namespaces ARE in use. A PID-present
// holder with a mismatched proc start must be LEFT ALIVE — no reclaim (it may be the
// live holder) AND no false death (we cannot compare start times across time bases).
test("B2 masked-/proc: ns/pid readable, ns/time hidden, PID present ⇒ live (no reclaim, no false death)", () => {
  const nsId = readPidNs("linux"); // a real readable id on this CI /proc
  const self = { host: "h", boot: "b", ns: nsId, timeNs: readTimeNs("linux", throwCode("ENOENT")), pid: process.pid, start: "proc:1" };
  assert.equal(self.timeNs, null, "a hidden ns/time reads as unknown (null), never a false 'host'");
  const r = {
    host: "h",
    boot: "b",
    ns: nsId,
    timeNs: null,
    pid: process.pid, // present (alive)
    start: "proc:999999999", // a start that would look like reuse if it were comparable
    token: tok,
    at: Date.now()
  };
  assert.equal(livenessOf(r, self), "live");
});

// B1: off Linux, a boot DIFFERENCE must NOT short-circuit to undecidable (that wedged a
// Mac rebooted mid-lock forever). It falls through to kill(0) + the start comparison,
// which decide the incident class on any platform. platform is injected because
// livenessOf reads process.platform (= linux on CI) for the boot check otherwise.
test("B1 boot-diff(darwin-sim): a boot difference with the PID absent ⇒ dead (reclaimable), not undecidable", () => {
  const self = { host: "h", boot: "boot-NEW", ns: "host", timeNs: "host", pid: process.pid, start: "ps:now" };
  const dead = { host: "h", boot: "boot-OLD", ns: "host", timeNs: "host", pid: ABSENT_PID, start: "ps:then", token: tok, at: Date.now() };
  assert.equal(livenessOf(dead, self, { platform: "darwin" }), "dead");
});

test("B1 boot-diff(darwin-sim): a boot difference with the PID present and a matching start ⇒ live", () => {
  const self = { host: "h", boot: "boot-NEW", ns: "host", timeNs: "host", pid: process.pid, start: "ps:now" };
  const r = { host: "h", boot: "boot-OLD", ns: "host", timeNs: "host", pid: process.pid, start: "ps:SAME", token: tok, at: Date.now() };
  const probe = () => ({ start: "ps:SAME" }); // confirmed same process (same ps start)
  assert.equal(livenessOf(r, self, { platform: "darwin", probe }), "live");
});

// B3: under Linux a mis-mapped /proc (unshare --pid without --mount-proc) makes BOTH
// /proc AND ps read the wrong namespace's process. procStartInfo must return undefined
// (undatable ⇒ live), never fall back to ps — a false different start would double-hold.
test("B3 procStartInfo(linux, mis-mapped /proc): returns undefined, never a ps fallback", () => {
  assert.equal(procStartInfo(process.pid, "linux", () => false), undefined);
});

test("B3 livenessOf(linux, mis-mapped /proc): a present PID with an undatable start ⇒ live, never a false dead", () => {
  const self = { host: "h", boot: "b", ns: "nsX", timeNs: "host", pid: process.pid, start: "proc:1" };
  const r = { host: "h", boot: "b", ns: "nsX", timeNs: "host", pid: process.pid, start: "proc:999999999", token: tok, at: Date.now() };
  const probe = () => undefined; // mis-mapped /proc: no datable start
  assert.equal(livenessOf(r, self, { platform: "linux", probe }), "live");
});

// R1: a start comparison across DIFFERENT sources (proc vs ps) is not comparable ⇒
// undatable ⇒ live (never undecidable/M-2 on a healthy holder). Same rule as an unknown
// time namespace. A "legacy" (malformed, pre-source-prefix) start is untrustworthy and
// must stay undecidable (fail closed) — never a fragile dead/live from raw values.
test("R1 cross-source: a proc record vs a ps probe on a live PID ⇒ live (undatable), not undecidable", () => {
  const self = { host: "h", boot: "b", ns: "nsX", timeNs: "host", pid: process.pid, start: "proc:1" };
  const r = { host: "h", boot: "b", ns: "nsX", timeNs: "host", pid: process.pid, start: "proc:1", token: tok, at: Date.now() };
  const probe = () => ({ start: "ps:Mon Sep 24 08:44:00 2026" });
  assert.equal(livenessOf(r, self, { platform: "linux", probe }), "live");
});

test("R1 legacy source: two legacy (malformed) starts are undecidable, never a fragile dead", () => {
  const self = { host: "h", boot: "b", ns: "nsX", timeNs: "host", pid: process.pid, start: "proc:1" };
  const r = { host: "h", boot: "b", ns: "nsX", timeNs: "host", pid: process.pid, start: "legacy-A-no-prefix", token: tok, at: Date.now() };
  const probe = () => ({ start: "legacy-B-no-prefix" }); // both legacy, different values
  assert.equal(livenessOf(r, self, { platform: "linux", probe }), "undecidable");
});

// N6: on darwin, procStartInfo uses `ps` (the real process table, absolute fork time), never
// /proc. This is the one non-Linux platform whose ps start is a stable identity.
test("N6 procStartInfo(darwin-sim): uses ps (real process table), producing a ps: start", () => {
  const info = procStartInfo(process.pid, "darwin", () => false);
  assert.ok(info && typeof info.start === "string" && info.start.startsWith("ps:"), "darwin ⇒ ps: start");
});

// R-BSD: `ps` is trusted ONLY on darwin (absolute fork time). On FreeBSD/OpenBSD ps start
// is boot-relative and its boot time is re-derived on a clock step, so it is not stable —
// a clock jump could false-death a live holder (I3). Those platforms ⇒ undefined (live).
test("R-BSD procStartInfo: FreeBSD/OpenBSD do NOT trust ps (undatable ⇒ live), only darwin does", () => {
  assert.equal(procStartInfo(process.pid, "freebsd", () => false), undefined);
  assert.equal(procStartInfo(process.pid, "openbsd", () => false), undefined);
  const dar = procStartInfo(process.pid, "darwin", () => false);
  assert.ok(dar && typeof dar.start === "string" && dar.start.startsWith("ps:"), "darwin still uses ps");
});
