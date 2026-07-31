/**
 * MACHINE-SCOPED session lease store.
 *
 * WHY THIS EXISTS. Nine subcontractor sessions, verifiably FINISHED, held 4 325
 * minutes of concurrency slot for 61.4 minutes of real work (ratio 1:70). The
 * pool stood at 15 of 12 — over cap, with zero of them working. It was never
 * scarce; it was hoarded.
 *
 * THE DISTINCTION THAT DECIDES THE DESIGN: those sessions were not DEAD, they
 * were FINISHED — a live process that no longer works (the composer back on its
 * placeholder, "Worked for X" on screen). Death and inactivity are DISJOINT
 * modes. A lock released on process death would have freed NONE of them, and
 * neither does `sweepStaleJobs` (delegate.ts), which skips anything `isJobLive`.
 * This store covers INACTIVITY: a finished-but-alive session stops beating, so
 * `now − heartbeatAt > ttlMs` declares it abandoned after 30 minutes instead of
 * 994.
 *
 * THE PATTERN IS `packages/track/src/lease/store.ts`; the LOCATION is not.
 * Track's store is REPO-scoped (`.track/leases.json`). The concurrency pool is
 * MACHINE-scoped: sessions from h2a-Impots, h2a-geo, h2a-immo, h2a-kog and
 * h2a-openerp all consume it, so a lease filed in one repo's `.track/` cannot
 * arbitrate a resource several repos contend for. It also would make pool
 * correctness depend on repo identity, which DERIVES. So the file sits beside
 * `registry.json` in the h2a config dir — the same machine-scoped home the
 * session registry already uses, under NO `.track/` and under no repo.
 *
 * WHAT IS BORROWED FROM TRACK, VERBATIM IN SPIRIT:
 *  - abandonment is CLOCKLESS, COMPUTED BY THE READER: the caller injects `now`
 *    and a lease is abandoned iff `now − heartbeatAt > ttlMs`. The store holds
 *    no clock of its own — `now` is a REQUIRED constructor dependency here
 *    (stricter than track, which defaults it), so no code path can stamp a
 *    timestamp from an implicit clock;
 *  - one ACTIVE lease per subject (here: per session id);
 *  - each acquisition mints a fresh, unguessable `token`; only the holder
 *    presenting the matching token may heartbeat, observe or release.
 *
 * WHAT THE TOKEN DOES AND DOES NOT GUARANTEE. It is a GENERATION guard, not a
 * secret: it is persisted in the same file, so any local process that can read
 * the store can read it. What it structurally prevents is a stale holder — one
 * that slept through its own abandonment — renewing or releasing the lease that
 * REPLACED its own. That property is enforced by the code and tested; secrecy
 * against a local reader is not claimed.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveConfigDir } from "./config.js";
import { withFileLock } from "./file-lock.js";

/**
 * Default lease TTL. 30 minutes, the same figure track settled on: long enough
 * that a session pausing between two tool calls is never mistaken for finished,
 * short enough that a finished-but-alive session frees its slot within one
 * working bout instead of the 994 minutes measured on the worst hoarder.
 */
export const DEFAULT_SESSION_LEASE_TTL_MS = 30 * 60_000;

/**
 * The CPU rate (ms of CPU per second of wall clock, over a pane's whole process
 * TREE) at or above which a session counts as WORKING and its lease is beaten.
 *
 * MEASURED on this workstation, 2026-07-30: 64 panes across 59 tmux sessions,
 * one 150 s window, same /proc arithmetic as `proc-cpu.ts`, each pane classified
 * by what its TUI showed at BOTH ends of the window:
 *
 *   idle-but-alive   n=59   median 12 ms/s   p95 23 ms/s   max 53 ms/s
 *   working          n=2    142 and 146 ms/s
 *
 * 75 ms/s sits in the empty band between the two: above EVERY idle sample
 * observed, well under the working ones. What the measurement does NOT
 * establish, and this comment will not pretend it does: the working mode rests
 * on two panes, and a session that works while burning little CPU — one long
 * network wait, one tool call every ten minutes — reads as finished-but-alive
 * here. That is survivable only because the decision this constant drives is
 * whether to BEAT, never whether to kill: a session judged idle is merely
 * PROPOSED for reclamation to a human or conductor, who can still see it.
 */
export const DEFAULT_WORKING_CPU_MS_PER_SECOND = 75;

/** A CPU observation of the session's pane process tree, at a point in time. */
export interface SessionCpuSample {
  /** Cumulative CPU (ms) of the pane's whole process tree — `paneTreeCpuMs`. */
  cpuMs: number;
  /** ISO-8601 instant the sample was taken (caller-injected clock). */
  sampledAt: string;
}

/**
 * A lease on one SESSION's concurrency slot. Persisted verbatim in
 * `session-leases.json`. Abandonment is NOT a stored field: it is computed by
 * the reader against an injected `now`.
 */
export interface SessionLease {
  leaseId: string;
  /** Registry entry id of the leased session (a job id / session id). */
  sessionId: string;
  /** Who holds the slot — the launching surface or the supervising pass. */
  holder: string;
  /** Informational provenance: the repo/cwd the session was launched from. The
   *  lease is NOT scoped by it — the pool is machine-wide. */
  workspace?: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  ttlMs: number;
  /** Per-acquisition generation guard (see the module header). */
  token: string;
  /** Last CPU observation — the evidence the beat decision is derived from. */
  sample?: SessionCpuSample;
}

/** Rejected lease operation (wrong token, absent lease, subject already held). */
export class SessionLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionLeaseError";
  }
}

/**
 * Is `lease` abandoned at `now`? PURE and CLOCKLESS: abandoned iff
 * `now − heartbeatAt > ttlMs`. The single abandonment predicate — reused by the
 * acquire guard, by the reclaim report, and by callers deciding what to show.
 */
export function isSessionLeaseAbandoned(lease: SessionLease, now: string): boolean {
  return Date.parse(now) - Date.parse(lease.heartbeatAt) > lease.ttlMs;
}

/**
 * CPU rate (ms of CPU per second of wall clock) between the lease's last
 * observation and `cpuMsNow` taken at `now`. Undefined when there is no prior
 * sample, when the elapsed window is not positive, or when the counter went
 * BACKWARDS (the pane's tree was replaced — a relaunch, or PID reuse): a
 * negative delta is not a rate, and must never be read as "idle". PURE.
 */
export function cpuRateMsPerSecond(
  lease: SessionLease,
  cpuMsNow: number,
  now: string,
): number | undefined {
  const previous = lease.sample;
  if (previous === undefined) return undefined;
  const elapsedMs = Date.parse(now) - Date.parse(previous.sampledAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return undefined;
  const deltaMs = cpuMsNow - previous.cpuMs;
  if (deltaMs < 0) return undefined;
  return (deltaMs / elapsedMs) * 1000;
}

/**
 * What a supervising pass should do with one lease, given a fresh CPU reading.
 * PURE — the probe is the caller's effect, the decision is testable here.
 *
 *  - `beat`     — the tree burned CPU at or above `workingRateMsPerSecond`: the
 *                 session is WORKING, renew its lease.
 *  - `observe`  — alive but under the bar (finished-but-alive), or no prior
 *                 sample to compare against: record the reading WITHOUT renewing,
 *                 so the TTL keeps running and the next pass has a baseline.
 *  - `unknown`  — no CPU reading at all (pane gone or unreadable). We do NOT
 *                 beat: an unreadable pane is not proof of work. We also do not
 *                 release: this store never decides a session is dead.
 */
export type SessionBeatAction = "beat" | "observe" | "unknown";

export interface SessionBeatDecision {
  action: SessionBeatAction;
  /** The computed rate when one could be computed (diagnostics + reporting). */
  rateMsPerSecond?: number;
  reason: "working" | "under-threshold" | "no-baseline" | "no-cpu-reading";
}

export function decideSessionBeat(input: {
  lease: SessionLease;
  /** Fresh `paneTreeCpuMs` reading, or undefined when the pane cannot be read. */
  cpuMsNow: number | undefined;
  now: string;
  workingRateMsPerSecond?: number;
}): SessionBeatDecision {
  if (input.cpuMsNow === undefined) {
    return { action: "unknown", reason: "no-cpu-reading" };
  }
  const rate = cpuRateMsPerSecond(input.lease, input.cpuMsNow, input.now);
  if (rate === undefined) {
    return { action: "observe", reason: "no-baseline" };
  }
  const bar = input.workingRateMsPerSecond ?? DEFAULT_WORKING_CPU_MS_PER_SECOND;
  return rate >= bar
    ? { action: "beat", rateMsPerSecond: rate, reason: "working" }
    : { action: "observe", rateMsPerSecond: rate, reason: "under-threshold" };
}

/** One abandoned lease, described so a caller can decide whether to reclaim it. */
export interface SessionReclaimProposal {
  sessionId: string;
  holder: string;
  /** How long the lease has gone unbeaten at `now` (ms). */
  idleMs: number;
  ttlMs: number;
  heartbeatAt: string;
  /** CPU rate over the whole unbeaten window, when a sample exists (ms/s). */
  lastRateMsPerSecond?: number;
}

/**
 * The abandoned leases at `now`, as PROPOSALS. This function proposes; it never
 * executes and never signals a process. A lease still inside its TTL — i.e. one
 * that still beats — is structurally excluded: the only filter is
 * `isSessionLeaseAbandoned`, so a beating session can never appear here. PURE.
 */
export function reclaimProposals(
  leases: ReadonlyArray<SessionLease>,
  now: string,
): SessionReclaimProposal[] {
  const nowMs = Date.parse(now);
  return leases
    .filter((lease) => isSessionLeaseAbandoned(lease, now))
    .map((lease) => {
      const idleMs = nowMs - Date.parse(lease.heartbeatAt);
      const proposal: SessionReclaimProposal = {
        sessionId: lease.sessionId,
        holder: lease.holder,
        idleMs,
        ttlMs: lease.ttlMs,
        heartbeatAt: lease.heartbeatAt,
      };
      return proposal;
    })
    .sort((a, b) => b.idleMs - a.idleMs);
}

/**
 * What a supervising pass must do with each recorded lease, BEFORE any probe.
 * The registry state decides; the CPU probe only happens for `probe` steps.
 *
 *  - `release` — the session reached a terminal state, so its slot is already
 *    free: the lease must not outlive it.
 *  - `probe`   — the session is still running: read its pane's CPU and let
 *    `decideSessionBeat` rule.
 *  - `leave`   — the lease names a session the registry does not know. We do NOT
 *    release it: a missing or unreadable registry would otherwise wipe the
 *    leases of sessions that ARE working. It ages out and gets reported.
 */
export type LeaseSupervisionStep =
  | { sessionId: string; action: "release"; reason: "terminal" }
  | { sessionId: string; action: "probe"; tmuxSession?: string }
  | { sessionId: string; action: "leave"; reason: "unregistered" };

/** The registry facts this planner needs — structural, so no registry import. */
export interface LeasedSessionState {
  id: string;
  jobState?: string;
  tmuxSession?: string;
}

export function planLeaseSupervision(
  leases: ReadonlyArray<SessionLease>,
  sessions: ReadonlyArray<LeasedSessionState>,
): LeaseSupervisionStep[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return leases.map((lease) => {
    const session = byId.get(lease.sessionId);
    if (session === undefined) {
      return { sessionId: lease.sessionId, action: "leave", reason: "unregistered" };
    }
    if (session.jobState === "done" || session.jobState === "failed") {
      return { sessionId: lease.sessionId, action: "release", reason: "terminal" };
    }
    return {
      sessionId: lease.sessionId,
      action: "probe",
      ...(session.tmuxSession !== undefined ? { tmuxSession: session.tmuxSession } : {}),
    };
  });
}

/** Machine-scoped path of the session-lease side-store (beside `registry.json`). */
export function resolveSessionLeasePath(): string {
  return join(resolveConfigDir(), "session-leases.json");
}

/**
 * The session-lease side-store. Every mutation runs under the store's OWN
 * lockfile (never the registry's) and is written atomically (tmp + rename).
 *
 * `now` is a REQUIRED dependency: the store stamps `acquiredAt`/`heartbeatAt`/
 * `expiresAt` from it, and holds no clock of its own. Abandonment is still the
 * READER's call — `abandoned(now)` takes the instant explicitly, with no default.
 */
export class SessionLeaseStore {
  private readonly clock: () => string;
  private readonly newId: () => string;

  constructor(
    private readonly leasesPath: string,
    deps: { now: () => string; newId?: () => string },
  ) {
    this.clock = deps.now;
    this.newId = deps.newId ?? (() => randomBytes(12).toString("hex"));
  }

  /** Every recorded lease (live OR abandoned — liveness is the reader's call). */
  readAll(): SessionLease[] {
    return readLeaseFile(this.leasesPath);
  }

  /** The lease recorded for a session, live or abandoned, if any. */
  forSession(sessionId: string): SessionLease | undefined {
    return this.readAll().find((lease) => lease.sessionId === sessionId);
  }

  /** The leases abandoned at `now` (explicit instant — the store adds no clock). */
  abandoned(now: string): SessionLease[] {
    return this.readAll().filter((lease) => isSessionLeaseAbandoned(lease, now));
  }

  /**
   * Take the slot for `sessionId`. Rejects when a LIVE lease already covers it
   * (one active lease per session). An ABANDONED prior lease does not block: the
   * new acquisition replaces it and mints a FRESH token, so the previous holder
   * can never beat or release what replaced its lease. An initial `cpuMs`
   * baseline may be supplied so the first supervising pass can compute a rate.
   */
  acquire(input: {
    sessionId: string;
    holder: string;
    workspace?: string;
    ttlMs?: number;
    cpuMs?: number;
  }): SessionLease {
    return withFileLock(this.leasesPath, () => {
      const all = readLeaseFile(this.leasesPath);
      const now = this.clock();
      const existing = all.find((lease) => lease.sessionId === input.sessionId);
      if (existing !== undefined && !isSessionLeaseAbandoned(existing, now)) {
        throw new SessionLeaseError(
          `session-lease: ${input.sessionId} is already held by ${existing.holder} (one active lease per session)`,
        );
      }
      const ttlMs = input.ttlMs ?? DEFAULT_SESSION_LEASE_TTL_MS;
      const lease: SessionLease = {
        leaseId: this.newId(),
        sessionId: input.sessionId,
        holder: input.holder,
        ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
        ttlMs,
        token: this.newId(),
        ...(input.cpuMs !== undefined
          ? { sample: { cpuMs: input.cpuMs, sampledAt: now } }
          : {}),
      };
      const next = all.filter((l) => l.sessionId !== input.sessionId);
      next.push(lease);
      writeLeaseFile(this.leasesPath, next);
      return lease;
    });
  }

  /**
   * Renew a lease — the holder's assertion that the session is WORKING. Only the
   * matching token is accepted. Resets the reader's abandonment window and, when
   * `cpuMs` is supplied, records the reading the assertion was based on.
   */
  heartbeat(input: { sessionId: string; token: string; cpuMs?: number }): SessionLease {
    return this.mutate(input.sessionId, input.token, "heartbeat", (lease) => {
      const now = this.clock();
      return {
        ...lease,
        heartbeatAt: now,
        expiresAt: new Date(Date.parse(now) + lease.ttlMs).toISOString(),
        ...(input.cpuMs !== undefined
          ? { sample: { cpuMs: input.cpuMs, sampledAt: now } }
          : {}),
      };
    });
  }

  /**
   * Record a CPU reading WITHOUT renewing the lease.
   *
   * This is what keeps the abandonment clock honest. A session that worked hard
   * and then finished would, on the next pass, still show a high AVERAGE rate
   * since its last beat and win itself another renewal it no longer deserves.
   * Observing separates the two acts: the baseline moves, the TTL does not.
   */
  observe(input: { sessionId: string; token: string; cpuMs: number }): SessionLease {
    return this.mutate(input.sessionId, input.token, "observe", (lease) => ({
      ...lease,
      sample: { cpuMs: input.cpuMs, sampledAt: this.clock() },
    }));
  }

  /** Give the slot back. Only the matching token is accepted. */
  release(input: { sessionId: string; token: string }): void {
    withFileLock(this.leasesPath, () => {
      const all = readLeaseFile(this.leasesPath);
      const idx = all.findIndex((lease) => lease.sessionId === input.sessionId);
      if (idx === -1) {
        throw new SessionLeaseError(
          `session-lease: no lease to release for ${input.sessionId}`,
        );
      }
      if (all[idx]!.token !== input.token) {
        throw new SessionLeaseError(
          `session-lease: release token mismatch for ${input.sessionId} — only the holder may release`,
        );
      }
      all.splice(idx, 1);
      writeLeaseFile(this.leasesPath, all);
    });
  }

  /** Shared token-guarded read-modify-write for `heartbeat` and `observe`. */
  private mutate(
    sessionId: string,
    token: string,
    verb: string,
    apply: (lease: SessionLease) => SessionLease,
  ): SessionLease {
    return withFileLock(this.leasesPath, () => {
      const all = readLeaseFile(this.leasesPath);
      const idx = all.findIndex((lease) => lease.sessionId === sessionId);
      if (idx === -1) {
        throw new SessionLeaseError(`session-lease: no lease to ${verb} for ${sessionId}`);
      }
      const lease = all[idx]!;
      if (lease.token !== token) {
        throw new SessionLeaseError(
          `session-lease: ${verb} token mismatch for ${sessionId} — only the holder may ${verb}`,
        );
      }
      const next = apply(lease);
      all[idx] = next;
      writeLeaseFile(this.leasesPath, all);
      return next;
    });
  }
}

/** Shape guard — a torn or hand-edited row must not poison the whole store. */
function isSessionLease(value: unknown): value is SessionLease {
  if (typeof value !== "object" || value === null) return false;
  const lease = value as Partial<SessionLease>;
  return (
    typeof lease.leaseId === "string" &&
    typeof lease.sessionId === "string" &&
    typeof lease.holder === "string" &&
    typeof lease.acquiredAt === "string" &&
    typeof lease.heartbeatAt === "string" &&
    typeof lease.token === "string" &&
    typeof lease.ttlMs === "number"
  );
}

/**
 * Read + parse the store. A missing, empty or garbled file degrades to `[]` —
 * the side-store is advisory, and a read must never throw into a launch path.
 * The consequence is stated plainly: a corrupt store forgets every lease, which
 * makes slots look FREE (admits work), never held.
 */
function readLeaseFile(leasesPath: string): SessionLease[] {
  if (!existsSync(leasesPath)) return [];
  try {
    const raw = readFileSync(leasesPath, "utf8").trim();
    if (raw === "") return [];
    const parsed = JSON.parse(raw) as { leases?: unknown };
    const leases = parsed?.leases;
    if (!Array.isArray(leases)) return [];
    return leases.filter(isSessionLease);
  } catch {
    return [];
  }
}

/** Atomic write: tmp file in the same dir, then rename (as the registry does). */
function writeLeaseFile(leasesPath: string, leases: SessionLease[]): void {
  mkdirSync(dirname(leasesPath), { recursive: true });
  const tmp = `${leasesPath}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify({ version: 1, leases }, null, 2)}\n`, "utf8");
  renameSync(tmp, leasesPath);
}
