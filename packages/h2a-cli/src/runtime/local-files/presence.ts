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
  isH2ASession,
  isSessionExpired,
  pickFreshSessions,
  type H2ASession,
  type H2ASessionState
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
  patch: { heartbeatAt?: string; state?: H2ASessionState }
): H2ASession | undefined {
  const existing = readPresence(root, sessionId);
  if (!existing) return undefined;
  if (
    patch.state !== undefined &&
    !H2A_SESSION_STATES.includes(patch.state)
  ) {
    throw new TypeError(`updatePresence: unknown session state "${patch.state}"`);
  }
  const next: H2ASession = {
    ...existing,
    ...(patch.heartbeatAt ? { heartbeatAt: patch.heartbeatAt } : {}),
    ...(patch.state ? { state: patch.state } : {})
  };
  writePresence(root, next);
  return next;
}
