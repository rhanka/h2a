import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

import {
  H2A_SESSION_DEFAULT_EXPIRY_MS,
  H2A_SESSION_STATES,
  H2A_WORK_STATUSES,
  isH2ASession,
  isSessionExpired,
  pickFreshSessions,
  type H2ALaunchContext,
  type H2ASession,
  type H2ASessionState,
  type H2AWorkStatus
} from "@sentropic/h2a";

import {
  localStorePaths,
  presenceFile,
  type LocalStorePaths
} from "./paths.js";

export interface PresenceWriteResult {
  /** Absolute path of the presence file on disk. */
  readonly path: string;
}

function ensurePresenceDir(paths: LocalStorePaths): void {
  mkdirSync(paths.presence, { recursive: true });
}

/**
 * Atomically write a session's presence file under `<root>/.h2a/presence/`.
 * Uses a temp file + rename so concurrent readers always see a complete
 * JSON document (the session owns its own file, so writer contention is
 * not expected, but we keep the rename anyway for partial-write safety).
 */
export function writePresence(
  root: string,
  session: H2ASession
): PresenceWriteResult {
  if (!isH2ASession(session)) {
    throw new TypeError("writePresence: argument is not a valid H2ASession");
  }
  const paths = localStorePaths(root);
  ensurePresenceDir(paths);
  const finalPath = presenceFile(paths, session.sessionId);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(tmpPath, "wx");
  try {
    writeFileSync(fd, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, finalPath);
  return { path: finalPath };
}

/** Read a presence file by session id. Returns undefined if absent or malformed. */
export function readPresence(
  root: string,
  sessionId: string
): H2ASession | undefined {
  const paths = localStorePaths(root);
  const file = presenceFile(paths, sessionId);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  if (raw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!isH2ASession(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Delete a presence file. Idempotent: missing file is not an error.
 */
export function deletePresence(root: string, sessionId: string): void {
  const paths = localStorePaths(root);
  const file = presenceFile(paths, sessionId);
  try {
    unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

export interface ListPresenceOptions {
  /** Reference instant; defaults to Date.now(). */
  readonly now?: number;
  /** Expiry window in ms; defaults to H2A_SESSION_DEFAULT_EXPIRY_MS. */
  readonly expiryMs?: number;
  /** Include expired sessions (default false). */
  readonly includeExpired?: boolean;
}

/**
 * Read all presence files under `<root>/.h2a/presence/`, filter out malformed
 * files, and (by default) drop sessions whose heartbeat is older than
 * `expiryMs`. Sweep expired files from disk as a side-effect.
 */
export function listPresence(
  root: string,
  options: ListPresenceOptions = {}
): H2ASession[] {
  const paths = localStorePaths(root);
  let entries: string[];
  try {
    entries = readdirSync(paths.presence);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const now = options.now ?? Date.now();
  const expiryMs = options.expiryMs ?? H2A_SESSION_DEFAULT_EXPIRY_MS;
  const all: H2ASession[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const sid = entry.slice(0, -".json".length);
    const session = readPresence(root, sid);
    if (!session) {
      // Stale or malformed — best-effort cleanup
      try {
        unlinkSync(join(paths.presence, entry));
      } catch {
        // ignore
      }
      continue;
    }
    all.push(session);
  }
  if (options.includeExpired) return all;
  const fresh = pickFreshSessions(all, { now, expiryMs });
  // Sweep newly-expired files
  for (const session of all) {
    if (!isSessionExpired(session, { now, expiryMs })) continue;
    try {
      unlinkSync(presenceFile(paths, session.sessionId));
    } catch {
      // ignore
    }
  }
  return fresh;
}

/**
 * Mutate a session's `heartbeatAt` (or `state`) on disk by reading,
 * patching, and re-writing. The session owns its file so this is safe
 * without a lock for V1 (DEC-051 acknowledges this constraint).
 */
export function updatePresence(
  root: string,
  sessionId: string,
  patch: {
    heartbeatAt?: string;
    state?: H2ASessionState;
    workStatus?: H2AWorkStatus;
    launchContext?: H2ALaunchContext;
    lastMcpActivityAt?: string;
  }
): H2ASession | undefined {
  const existing = readPresence(root, sessionId);
  if (!existing) return undefined;
  if (
    patch.state !== undefined &&
    !H2A_SESSION_STATES.includes(patch.state)
  ) {
    throw new TypeError(`updatePresence: unknown session state "${patch.state}"`);
  }
  if (
    patch.workStatus !== undefined &&
    !H2A_WORK_STATUSES.includes(patch.workStatus)
  ) {
    throw new TypeError(`updatePresence: unknown work status "${patch.workStatus}"`);
  }
  const next: H2ASession = {
    ...existing,
    ...(patch.heartbeatAt ? { heartbeatAt: patch.heartbeatAt } : {}),
    ...(patch.state ? { state: patch.state } : {}),
    ...(patch.workStatus ? { workStatus: patch.workStatus } : {}),
    ...(patch.launchContext ? { launchContext: patch.launchContext } : {}),
    ...(patch.lastMcpActivityAt
      ? { lastMcpActivityAt: patch.lastMcpActivityAt }
      : {})
  };
  writePresence(root, next);
  return next;
}

/**
 * Default liveness probe: signal-0 to `pid`. `EPERM` means the process exists
 * but we lack permission (alive); `ESRCH` means no such process (dead).
 */
function defaultPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Reap presence files for the SAME `instance` whose owning process is provably
 * dead — the "false-live" left behind when a host (Claude Code / Codex) drops
 * the MCP stdio connection WITHOUT signalling the child: the process lingered
 * and its blind heartbeat kept the presence "live", so peers kept routing to an
 * agent that could no longer answer. A fresh `mcp-serve` boot calls this at
 * auto-open to clear the stale presence of a previous connection of the SAME
 * agent.
 *
 * Reaps an entry iff ALL hold:
 *  - same `instance` (an instance never migrates machines — it is keyed on the
 *    provider conversation — so the local pid probe is valid);
 *  - a DIFFERENT `sessionId` than `keepSessionId` (never reap the caller);
 *  - a numeric `pid` that `isAlive` reports dead.
 *
 * Best-effort: never throws. `isAlive` is injectable for deterministic tests.
 *
 * @returns the sessionIds that were reaped.
 */
export function reapDeadInstancePresence(
  root: string,
  instance: string,
  keepSessionId: string,
  isAlive: (pid: number) => boolean = defaultPidAlive
): string[] {
  let all: H2ASession[];
  try {
    all = listPresence(root, { includeExpired: true });
  } catch {
    return [];
  }
  const reaped: string[] = [];
  for (const session of all) {
    if (session.instance !== instance) continue;
    if (session.sessionId === keepSessionId) continue;
    const pid = (session as { pid?: number }).pid;
    if (typeof pid !== "number") continue;
    if (isAlive(pid)) continue;
    try {
      deletePresence(root, session.sessionId);
      reaped.push(session.sessionId);
    } catch {
      // best-effort: a delete race is harmless (another booter reaped it)
    }
  }
  return reaped;
}

/**
 * Host-wide janitor: reap EVERY presence file whose owning process is provably
 * dead, regardless of instance. The safest possible reap — a dead process
 * cannot own a live session — but it assumes presence pids are local to this
 * machine (true for a single-host bus). On a bus shared across machines, scope
 * with `reapDeadInstancePresence` instead, since a remote pid would read as
 * dead here. Best-effort: never throws. `isAlive` is injectable for tests.
 *
 * @returns the reaped sessionIds (and, for reporting, their instances).
 */
export function reapAllDeadPresence(
  root: string,
  isAlive: (pid: number) => boolean = defaultPidAlive
): Array<{ sessionId: string; instance: string; pid: number }> {
  let all: H2ASession[];
  try {
    all = listPresence(root, { includeExpired: true });
  } catch {
    return [];
  }
  const reaped: Array<{ sessionId: string; instance: string; pid: number }> = [];
  for (const session of all) {
    const pid = (session as { pid?: number }).pid;
    if (typeof pid !== "number") continue;
    if (isAlive(pid)) continue;
    try {
      deletePresence(root, session.sessionId);
      reaped.push({ sessionId: session.sessionId, instance: session.instance, pid });
    } catch {
      // best-effort
    }
  }
  return reaped;
}
