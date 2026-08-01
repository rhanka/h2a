# DESIGN — Session-lease worker attribution (extend #106, one object)

Owner: runtime (WP5). Reviewer: arch (WP6). Status: DESIGN — **implementation HELD**
by conductor's post-storm stabilization freeze (build only once the fleet is stable and
the owner has scoped the mass-WAKE). This document is the load-free deliverable; the code
follows the freeze lift.

Provenance: concludes Étude 1 (keep tmux; native buys a process **ledger**, not a terminal)
via runtime measurements M1–M5. This is the "something built" half of that study.

## 1. The one object

There is exactly ONE registry, and it already exists: `SessionLeaseStore`
(`packages/h2a-runtime/src/session-lease.ts`, #106, MERGED). It is machine-scoped, sits
beside `registry.json` (not under any `.track/`), computes abandonment clocklessly in the
READER (`isSessionLeaseAbandoned`: `now − heartbeatAt > ttlMs`), holds one active lease per
`sessionId`, and mints a fresh generation `token` per acquisition.

The pid→lane attribution ledger is NOT a second registry. It is a **missing field** on this
one. The lease PORTES the attribution; the attribution is what the lease PROUVE. Building a
separate ledger would create two readers that diverge — the exact failure this repo keeps
paying for.

What #106 does not record today: **which OS process is the worker.** It keys
`sessionId → holder` and proves life by CPU rate of the pane tree. It never records the
process identity. That field is the whole of this work.

## 2. The field

```
worker?: {
  pid: number;        // the WORKING grandchild (claude/codex), not the pane wrapper
  startTime: string;  // /proc/<pid>/stat field 22 (ticks since boot), as string
  bootId: string;     // /proc/sys/kernel/random/boot_id
}
```

`(pid, startTime, bootId)` is a composite identity that is stable against pid recycling
AND against reboots. Rationale: a bare pid is an assertion about an instant; pids recycle,
and a persisted store survives a reboot, so `(pid, startTime)` is unique only WITHIN one
boot. The chain is: the worker is bound to a pid, the pid to a startTime, the startTime to
a boot. It stops there and it is complete. (arch refinement 3.)

Cost note: `startTime` is field 22 of the SAME `/proc/<pid>/stat` line `parseProcStat`
already reads (it currently extracts ppid/utime/stime; adding starttime = read `fields[19]`
after the last `)`), so it is ZERO extra syscalls. `bootId` is one cheap read, cached per
process.

## 3. The single liveness predicate (arch refinement 1 — the load-bearing rule)

There is ONE pure projection, imported by the abandon reader, the slot counter, and every
future consumer. It must not live in the slot counter while abandonment lives elsewhere —
two readers WILL diverge (one says "lease live", the other "slot free").

```
ALIVE(lease, live /proc, now)  ⟺  ¬abandoned(lease, now)  ∧  workerValid(lease, /proc)

workerValid(lease, /proc)  ⟺  lease.worker present
                              ∧ lease.worker.bootId === currentBootId
                              ∧ /proc/<lease.worker.pid> exists
                              ∧ /proc/<lease.worker.pid>.startTime === lease.worker.startTime
```

`workerValid` is a **conjunct of life**, never a display field. Slot count of live leases =
`leases.filter(l => ALIVE(l, /proc, now))`. Finished-but-alive frees its slot by TTL; a
recycled pid never counts as a live slot.

## 4. The danger this closes, and the race it opens (arch refinement 2)

DANGER: **a lease that beats while its worker is dead.** If the HOLDER (the h2a process)
beats, not the worker, a lease can keep beating after its worker died or was replaced —
literally the finished-but-alive hoarding (4 325 slot-minutes for 61 minutes of work),
moved one notch: the holder still exists, it beats, the slot stays taken. §3 closes it:
`worker-invalid ⟹ ¬ALIVE ⟹ slot returned, even if the holder still beats.` This is exactly
why worker-validity must be a conjunct of life and not a field someone forgot to read.

RACE (the counterpart, and it is real): between the OLD worker's death and the NEW worker's
resolution at relaunch, the lease is momentarily worker-invalid — therefore reclaimable. The
pool could reap a session **in the middle of its own relaunch** — the worst possible moment
to kill it.

PARADE (already in the store's shape): **re-resolution happens under the lease TOKEN, in the
SAME act as the relaunch** — not after, not by a third-party observer. While the holder
presents its token, the re-resolution window is protected. Optional explicit `worker:
"resolving"` state is acceptable ONLY WITH ITS OWN BOUND (a resolving-deadline), else
"resolving" becomes the new silent hole.

## 5. Reader before writer (form constraint — from M2, the class this repo mass-produces)

The M2 finding: `@h2a_status_surface` is written correctly at install and read by NOBODY
downstream, so its failure is structurally silent. A `worker` field with no consumer would
reproduce that identically. So this design NAMES the readers before the writer:

- **WHO reads `worker`:** the `ALIVE` predicate (§3), consumed by (a) the slot counter,
  (b) the reclaim-proposal reader, (c) the read-back auditor (§6).
- **WHEN:** every supervising pass, and every slot-admission check.
- **WHAT HAPPENS WHEN INVALID:** the lease is not ALIVE → its slot is counted free → it
  becomes a reclaim PROPOSAL (never an automatic kill; this store proposes, a human/conductor
  disposes), EXCEPT while protected by the relaunch token window (§4).

The writer (`acquire`/relaunch populating `worker` via one /proc walk — arch refinement 2b:
/proc is MOVED to acquire-time, not eliminated; the worker is a grandchild, resolved once by
`busiestDescendant` from `pane_pid`, then read a thousand times) ships only after its reader.

## 6. The read-back auditor (the M2 class fix — substrate-independent, ship even if nothing else moves)

A supervising pass that reads LIVE sessions and CONSUMES the confirmation state:
- confirms the status surface marker `@h2a_status_surface` is actually present on each live
  managed session (today read only by install/uninstall — zero downstream consumer);
- confirms each live lease's `worker` still validates.
Drift (marker absent, or worker invalid outside the token window) becomes a reported finding.
This repairs the CLASS "a locally-correct result that nobody consumes downstream" — of which
the status bar was one case — not just the bar.

**DESIGN CONSTRAINT — the fix must not become the storm it audits (arch danger, load-bearing).**
The storm that froze the machine was ~330 `h2a status` processes: ONE node process per refresh
per session across 57 sessions. The bug was the per-refresh SPAWN, not the session count. An
auditor implemented as a PER-SESSION probe is that exact form. Therefore, by construction:
- **ONE pass for the WHOLE fleet, never one per session.** tmux lists every session and its
  options in a SINGLE invocation (`tmux list-sessions`/`show-options -A`); the auditor reads
  the whole fleet in one shot and compares in memory. Worker validity likewise: one `/proc`
  scan, compared against all leases in memory — not one scan per lease.
- **NO spawn per refresh.** The audit is a BOUNDED act — on demand, or on a loose cadence —
  NEVER hooked to a render/refresh cycle.
- **General rule for the whole class fix:** a reader that costs one process per subject is not
  a reader, it is a LOAD. Repairing "a local result nobody consumes" must not create its twin,
  "a consumer that costs more than what it verifies." Every consumer added under this class fix
  is fleet-wide-single-pass or it does not ship.

## 7. Sequencing

Design (this doc): now. Implementation (the `worker` field + `ALIVE` predicate + the
read-back auditor, delegated build with discriminating tests): HELD for the conductor's
post-storm stabilization freeze to lift. Study 1's formal write-up cites M1–M5 in parallel.
