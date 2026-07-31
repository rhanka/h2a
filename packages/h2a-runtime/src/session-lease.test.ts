import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_LEASE_TTL_MS,
  DEFAULT_WORKING_CPU_MS_PER_SECOND,
  SessionLeaseError,
  SessionLeaseStore,
  cpuRateMsPerSecond,
  decideSessionBeat,
  isSessionLeaseAbandoned,
  planLeaseSupervision,
  reclaimProposals,
  resolveSessionLeasePath,
  type SessionLease,
} from "./session-lease.js";

// Scratch dir inside the package (never /tmp), like the other test suites.
const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "session-lease",
);

let scratch: string;
let leasePath: string;

/** A store whose clock is a variable the test moves — the store owns no clock. */
function storeAt(clock: { iso: string }, ids: string[] = []): SessionLeaseStore {
  let n = 0;
  return new SessionLeaseStore(leasePath, {
    now: () => clock.iso,
    newId: () => ids[n++] ?? `id-${n}`,
  });
}

const T0 = "2026-07-30T10:00:00.000Z";
const plusMinutes = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "l-"));
  leasePath = join(scratch, "session-leases.json");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("abandonment is clockless and computed by the reader", () => {
  it("declares a lease abandoned only past its TTL, at the instant the CALLER injects", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock);
    const lease = store.acquire({ sessionId: "job-a", holder: "conductor" });

    // Same lease, three different reader instants — nothing on disk changes.
    expect(isSessionLeaseAbandoned(lease, plusMinutes(T0, 29))).toBe(false);
    expect(isSessionLeaseAbandoned(lease, plusMinutes(T0, 30))).toBe(false);
    expect(isSessionLeaseAbandoned(lease, plusMinutes(T0, 31))).toBe(true);
    expect(store.abandoned(plusMinutes(T0, 31)).map((l) => l.sessionId)).toEqual(["job-a"]);
    expect(store.abandoned(plusMinutes(T0, 29))).toEqual([]);
  });

  it("frees a FINISHED-BUT-ALIVE session after one TTL — the 994-minute hoard the store exists for", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock);
    const lease = store.acquire({ sessionId: "sub-7", holder: "conductor", cpuMs: 100_000 });

    // It works for 20 minutes (beaten), then FINISHES while its process stays
    // alive: nothing kills it, and nothing beats it either.
    clock.iso = plusMinutes(T0, 20);
    store.heartbeat({ sessionId: "sub-7", token: lease.token, cpuMs: 900_000 });

    expect(store.abandoned(plusMinutes(T0, 45))).toEqual([]); // still inside its TTL
    const proposals = reclaimProposals(store.readAll(), plusMinutes(T0, 51));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.sessionId).toBe("sub-7");
    expect(proposals[0]!.idleMs).toBe(31 * 60_000);
  });

  it("stamps every timestamp from the injected clock — the store reads no clock of its own", () => {
    const clock = { iso: T0 };
    const lease = storeAt(clock).acquire({ sessionId: "job-a", holder: "conductor" });
    expect(lease.acquiredAt).toBe(T0);
    expect(lease.heartbeatAt).toBe(T0);
    expect(lease.expiresAt).toBe(
      new Date(Date.parse(T0) + DEFAULT_SESSION_LEASE_TTL_MS).toISOString(),
    );
  });
});

describe("one active lease per session, and the token that guards it", () => {
  it("refuses a second acquisition while the lease is LIVE", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock);
    store.acquire({ sessionId: "job-a", holder: "conductor" });
    clock.iso = plusMinutes(T0, 10);
    expect(() => store.acquire({ sessionId: "job-a", holder: "other" })).toThrow(
      SessionLeaseError,
    );
  });

  it("lets an ABANDONED lease be re-acquired, and the stale holder can no longer beat or release it", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock, ["lease-1", "token-1", "lease-2", "token-2"]);
    const first = store.acquire({ sessionId: "job-a", holder: "conductor" });

    clock.iso = plusMinutes(T0, 31); // first lease is now abandoned
    const second = store.acquire({ sessionId: "job-a", holder: "reclaimer" });
    expect(second.token).not.toBe(first.token);
    expect(store.readAll()).toHaveLength(1); // replaced, not duplicated

    expect(() =>
      store.heartbeat({ sessionId: "job-a", token: first.token }),
    ).toThrow(/token mismatch/);
    expect(() => store.release({ sessionId: "job-a", token: first.token })).toThrow(
      /token mismatch/,
    );
    // The rightful holder still can.
    expect(store.heartbeat({ sessionId: "job-a", token: second.token }).holder).toBe(
      "reclaimer",
    );
  });

  it("rejects a heartbeat, an observation and a release that present no matching token", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock);
    store.acquire({ sessionId: "job-a", holder: "conductor" });
    expect(() => store.heartbeat({ sessionId: "job-a", token: "guessed" })).toThrow(
      SessionLeaseError,
    );
    expect(() =>
      store.observe({ sessionId: "job-a", token: "guessed", cpuMs: 1 }),
    ).toThrow(SessionLeaseError);
    expect(() => store.release({ sessionId: "job-a", token: "guessed" })).toThrow(
      SessionLeaseError,
    );
  });

  it("rejects a heartbeat or a release on a session that holds no lease", () => {
    const store = storeAt({ iso: T0 });
    expect(() => store.heartbeat({ sessionId: "ghost", token: "t" })).toThrow(/no lease/);
    expect(() => store.release({ sessionId: "ghost", token: "t" })).toThrow(/no lease/);
  });

  it("renews the abandonment window on a heartbeat, and gives the slot back on a release", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock);
    const lease = store.acquire({ sessionId: "job-a", holder: "conductor" });

    clock.iso = plusMinutes(T0, 25);
    const beaten = store.heartbeat({ sessionId: "job-a", token: lease.token });
    expect(beaten.heartbeatAt).toBe(plusMinutes(T0, 25));
    expect(isSessionLeaseAbandoned(beaten, plusMinutes(T0, 50))).toBe(false);

    store.release({ sessionId: "job-a", token: lease.token });
    expect(store.readAll()).toEqual([]);
  });
});

describe("observing is not beating", () => {
  it("records the CPU reading WITHOUT extending the lease", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock);
    const lease = store.acquire({ sessionId: "job-a", holder: "conductor", cpuMs: 1_000 });

    clock.iso = plusMinutes(T0, 10);
    const observed = store.observe({ sessionId: "job-a", token: lease.token, cpuMs: 1_100 });

    expect(observed.sample).toEqual({ cpuMs: 1_100, sampledAt: plusMinutes(T0, 10) });
    expect(observed.heartbeatAt).toBe(T0); // NOT renewed
    expect(observed.expiresAt).toBe(lease.expiresAt);
    expect(isSessionLeaseAbandoned(observed, plusMinutes(T0, 31))).toBe(true);
  });

  it("keeps a burst of past work from buying a renewal it no longer deserves", () => {
    // Worked hard for one minute, then finished. Without a separate observation
    // the AVERAGE rate since the last beat stays high for many minutes and the
    // supervising pass keeps renewing a session that does nothing.
    const clock = { iso: T0 };
    const store = storeAt(clock);
    const lease = store.acquire({ sessionId: "job-a", holder: "conductor", cpuMs: 0 });

    clock.iso = plusMinutes(T0, 1);
    const afterBurst = store.observe({ sessionId: "job-a", token: lease.token, cpuMs: 30_000 });
    expect(
      decideSessionBeat({ lease: afterBurst, cpuMsNow: 30_900, now: plusMinutes(T0, 2) }).action,
    ).toBe("observe"); // 900 ms of CPU over 60 s = 15 ms/s → finished-but-alive

    // Had the baseline stayed at acquire time, the same instant would have read
    // 30 900 ms over 120 s = 257 ms/s and beaten the lease.
    expect(
      decideSessionBeat({ lease, cpuMsNow: 30_900, now: plusMinutes(T0, 2) }).action,
    ).toBe("beat");
  });
});

describe("the beat decision (pure)", () => {
  const base: SessionLease = {
    leaseId: "l1",
    sessionId: "job-a",
    holder: "conductor",
    acquiredAt: T0,
    heartbeatAt: T0,
    expiresAt: plusMinutes(T0, 30),
    ttlMs: DEFAULT_SESSION_LEASE_TTL_MS,
    token: "tok",
    sample: { cpuMs: 10_000, sampledAt: T0 },
  };

  it("beats a working tree and only observes one under the bar", () => {
    // +60 000 ms of CPU over 60 s = 1 000 ms/s (a full core) → working.
    const working = decideSessionBeat({ lease: base, cpuMsNow: 70_000, now: plusMinutes(T0, 1) });
    expect(working).toMatchObject({ action: "beat", reason: "working" });
    expect(working.rateMsPerSecond).toBeCloseTo(1000, 5);

    // +900 ms over 60 s = 15 ms/s — the measured finished-but-alive burn.
    const finished = decideSessionBeat({ lease: base, cpuMsNow: 10_900, now: plusMinutes(T0, 1) });
    expect(finished).toMatchObject({ action: "observe", reason: "under-threshold" });
    expect(finished.rateMsPerSecond).toBeCloseTo(15, 5);
  });

  it("treats the threshold as inclusive and honours an explicit bar", () => {
    const atBar = decideSessionBeat({
      lease: base,
      cpuMsNow: 10_000 + DEFAULT_WORKING_CPU_MS_PER_SECOND * 60,
      now: plusMinutes(T0, 1),
    });
    expect(atBar.action).toBe("beat");
    expect(
      decideSessionBeat({
        lease: base,
        cpuMsNow: 10_000 + DEFAULT_WORKING_CPU_MS_PER_SECOND * 60,
        now: plusMinutes(T0, 1),
        workingRateMsPerSecond: 500,
      }).action,
    ).toBe("observe");
  });

  it("NEVER beats when the pane cannot be read — an unreadable pane is not proof of work", () => {
    expect(
      decideSessionBeat({ lease: base, cpuMsNow: undefined, now: plusMinutes(T0, 1) }),
    ).toEqual({ action: "unknown", reason: "no-cpu-reading" });
  });

  it("only observes when there is no baseline, or when the counter went backwards", () => {
    const noSample: SessionLease = { ...base, sample: undefined };
    expect(
      decideSessionBeat({ lease: noSample, cpuMsNow: 5_000, now: plusMinutes(T0, 1) }),
    ).toEqual({ action: "observe", reason: "no-baseline" });

    // Tree replaced (relaunch / pid reuse): a negative delta is not a rate.
    expect(
      decideSessionBeat({ lease: base, cpuMsNow: 50, now: plusMinutes(T0, 1) }).action,
    ).toBe("observe");
    expect(cpuRateMsPerSecond(base, 50, plusMinutes(T0, 1))).toBeUndefined();
    expect(cpuRateMsPerSecond(base, 20_000, T0)).toBeUndefined(); // zero elapsed
  });
});

describe("the reclaim report proposes, and can never name a session that still beats", () => {
  it("lists only abandoned leases, longest-idle first", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock);
    const hoarder = store.acquire({ sessionId: "hoarder", holder: "conductor" });
    const idle = store.acquire({ sessionId: "idle", holder: "conductor" });
    const worker = store.acquire({ sessionId: "worker", holder: "conductor" });

    clock.iso = plusMinutes(T0, 40);
    store.heartbeat({ sessionId: "idle", token: idle.token });
    clock.iso = plusMinutes(T0, 100);
    store.heartbeat({ sessionId: "worker", token: worker.token });

    const proposals = reclaimProposals(store.readAll(), plusMinutes(T0, 101));
    expect(proposals.map((p) => p.sessionId)).toEqual(["hoarder", "idle"]);
    expect(proposals[0]!.idleMs).toBeGreaterThan(proposals[1]!.idleMs);
    expect(hoarder.sessionId).toBe("hoarder");
  });

  it("excludes a lease beaten one millisecond ago", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock);
    store.acquire({ sessionId: "job-a", holder: "conductor" });
    const now = new Date(Date.parse(T0) + 1).toISOString();
    expect(reclaimProposals(store.readAll(), now)).toEqual([]);
  });
});

describe("what a supervising pass must do with each lease (pure)", () => {
  const lease = (sessionId: string): SessionLease => ({
    leaseId: `l-${sessionId}`,
    sessionId,
    holder: "conductor",
    acquiredAt: T0,
    heartbeatAt: T0,
    expiresAt: plusMinutes(T0, 30),
    ttlMs: DEFAULT_SESSION_LEASE_TTL_MS,
    token: `tok-${sessionId}`,
  });

  it("releases the lease of a terminal session, probes a running one, and carries its pane", () => {
    const steps = planLeaseSupervision(
      [lease("done-job"), lease("failed-job"), lease("running-job")],
      [
        { id: "done-job", jobState: "done" },
        { id: "failed-job", jobState: "failed" },
        { id: "running-job", jobState: "running", tmuxSession: "h2a-running-job" },
      ],
    );
    expect(steps).toEqual([
      { sessionId: "done-job", action: "release", reason: "terminal" },
      { sessionId: "failed-job", action: "release", reason: "terminal" },
      { sessionId: "running-job", action: "probe", tmuxSession: "h2a-running-job" },
    ]);
  });

  it("LEAVES a lease whose session the registry does not know — a lost registry must not wipe live leases", () => {
    expect(planLeaseSupervision([lease("orphan")], [])).toEqual([
      { sessionId: "orphan", action: "leave", reason: "unregistered" },
    ]);
  });
});

describe("the store on disk", () => {
  it("is MACHINE-scoped: it sits beside registry.json, under no repo and no .track", () => {
    const previous = process.env.REMOTE_CLI_CONFIG_HOME;
    process.env.REMOTE_CLI_CONFIG_HOME = scratch;
    try {
      const path = resolveSessionLeasePath();
      expect(path.endsWith("session-leases.json")).toBe(true);
      expect(path).toContain(join(".config", "sentropic"));
      expect(path).not.toContain(".track");
      expect(path.startsWith(scratch)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
      else process.env.REMOTE_CLI_CONFIG_HOME = previous;
    }
  });

  it("is shared: a second store instance on the same path sees the lease", () => {
    const clock = { iso: T0 };
    const lease = storeAt(clock).acquire({ sessionId: "job-a", holder: "conductor" });
    const other = new SessionLeaseStore(leasePath, { now: () => plusMinutes(T0, 5) });
    expect(other.forSession("job-a")?.leaseId).toBe(lease.leaseId);
    expect(other.forSession("nobody")).toBeUndefined();
  });

  it("persists a versioned envelope and reads a torn file as no leases", () => {
    const clock = { iso: T0 };
    const store = storeAt(clock);
    store.acquire({ sessionId: "job-a", holder: "conductor" });
    expect(JSON.parse(readFileSync(leasePath, "utf8")).version).toBe(1);

    writeFileSync(leasePath, "{ not json", "utf8");
    expect(store.readAll()).toEqual([]);
    writeFileSync(leasePath, JSON.stringify({ version: 1, leases: [{ junk: true }] }), "utf8");
    expect(store.readAll()).toEqual([]);
  });
});
