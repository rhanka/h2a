/**
 * sentropic enrollment — Lot 0: the auth token-file model (D1), server/issuer-bound.
 *
 * Spec §3. The refresh/access tokens live in `~/.sentropic/h2a-auth.json` (0600), namespaced PER
 * SERVER, so a token minted for one sentropic server/issuer is NEVER usable against another (an
 * attacker-supplied `--server` cannot harvest a 39-auth token). Mirrors the atomic-0600 write used
 * by gateway-host/daemon.ts; no network here.
 *
 * The write path is fail-closed storage. It refuses (typed error, nothing written) to touch a file
 * it cannot parse or that is not a per-server map. Writers are serialized by a writer lock next to
 * the auth file (see `withWriterLock`): a writer that cannot get it in time, or that finds before
 * its rename that it no longer holds it, refuses instead of writing, so a write landing in another
 * writer's read-modify-write window is not lost. Under the lock the merge still re-reads the bytes
 * it started from before renaming: a second line against writers that ignore the lock.
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

export interface SentropicAuthToken {
  /** the sentropic server base URL this token is bound to (routing + anti-exfil key). */
  server: string;
  /** the 39-auth issuer that minted it. */
  issuer: string;
  accessToken: string;
  refreshToken?: string;
  /** ISO expiry of the access token, if known. */
  expiresAt?: string;
  /** the authenticated subject (sub), if known. */
  subject?: string;
}

/** file shape: a per-server map so multiple servers coexist without cross-use. */
type AuthFile = Record<string, SentropicAuthToken>;

/** Why the auth file cannot be trusted: a code, never a byte of the file. */
export type DamagedAuthFileReason = "unreadable" | "unparseable" | "not-a-map" | "malformed-entry";

/** The auth file exists on disk but cannot be trusted: unreadable, unparseable, or not a
 *  per-server map. Writes refuse instead of destroying it; reads fail closed (undefined). The
 *  error carries the path and a reason code only: the JSON.parse SyntaxError quotes the bytes
 *  around the failure (possibly a token), so it is never attached; an fs error (code, syscall,
 *  path) may be. */
export class DamagedAuthFileError extends Error {
  constructor(
    readonly path: string,
    readonly reason: DamagedAuthFileReason,
    options?: { cause?: NodeJS.ErrnoException },
  ) {
    super(`sentropic auth: refusing to touch the auth file (${reason}): ${path}`, options);
    this.name = "DamagedAuthFileError";
  }
}

/** Why a write refused because of another writer. */
export type ConcurrentWriteReason = "lock-busy" | "lock-lost" | "kept-changing";

/** Another writer held the writer lock past the wait budget (`lock-busy`), took it over while this
 *  one was stalled (`lock-lost`), or, ignoring the lock, kept rewriting the file under the merge
 *  (`kept-changing`). Nothing was written: the refusal itself loses nothing. */
export class AuthFileConcurrentWriteError extends Error {
  constructor(
    readonly path: string,
    readonly reason: ConcurrentWriteReason,
  ) {
    super(`sentropic auth: another writer kept the auth file busy (${reason}), refusing to overwrite it: ${path}`);
    this.name = "AuthFileConcurrentWriteError";
  }
}

function sentropicDir(dir?: string): string {
  return dir ?? join(homedir(), ".sentropic");
}

export function authFilePath(dir?: string): string {
  return join(sentropicDir(dir), "h2a-auth.json");
}

/** The fail-closed read for `readAuth`: a damaged or absent file reads as "no token", so one is
 *  never SERVED from it; the damage surfaces on the next writeAuth (typed refusal). */
function readFile(dir?: string): AuthFile {
  const path = authFilePath(dir);
  try {
    return parseAuthFile(readRawAuthFile(path), path);
  } catch {
    return {};
  }
}

/** Exact bytes of the auth file: undefined when absent, typed refusal when unreadable. */
function readRawAuthFile(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DamagedAuthFileError(path, "unreadable", { cause: e as NodeJS.ErrnoException });
  }
}

function isStoredToken(value: unknown): value is SentropicAuthToken {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.server === "string" &&
    typeof t.issuer === "string" &&
    typeof t.accessToken === "string" &&
    (t.refreshToken === undefined || typeof t.refreshToken === "string") &&
    (t.expiresAt === undefined || typeof t.expiresAt === "string") &&
    (t.subject === undefined || typeof t.subject === "string")
  );
}

/** Parse bytes that must be a per-server map of well-formed tokens; anything else is damage,
 *  not an empty store, and is refused with a typed error. */
function parseAuthFile(raw: Buffer | undefined, path: string): AuthFile {
  if (raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    // The SyntaxError is dropped on purpose: its message quotes the file's bytes.
    throw new DamagedAuthFileError(path, "unparseable");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DamagedAuthFileError(path, "not-a-map");
  }
  for (const value of Object.values(parsed)) {
    if (!isStoredToken(value)) throw new DamagedAuthFileError(path, "malformed-entry");
  }
  return parsed as AuthFile;
}

/** Writers wait this long for the lock, then refuse rather than write unlocked. */
const LOCK_WAIT_MS = 2_000;
/** A lock older than this was left by a dead or stuck writer: a held section lasts milliseconds. */
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 5;
const lockWaitCell = new Int32Array(new SharedArrayBuffer(4));

interface WriterLock {
  readonly path: string;
  /** `pid:uuid`, written into the lock: who holds it, and proof that this writer still does. */
  readonly owner: string;
}

/**
 * Run `fn` holding the writer lock: `<auth>.lock`, created O_CREAT|O_EXCL (one winner among the
 * processes, and the containers, sharing the directory) and carrying its owner. Not file-lock.ts's
 * `withFileLock`: that one is best-effort by design and proceeds unlocked when its wait runs out;
 * a token writer refuses instead.
 *
 * - Wait: up to LOCK_WAIT_MS, then AuthFileConcurrentWriteError (`lock-busy`), nothing written.
 * - Stale: a lock older than LOCK_STALE_MS is removed. By age only: a pid says nothing across pid
 *   namespaces (two containers sharing $HOME both run as pid 1).
 * - Ownership: before its rename a writer re-reads the lock and refuses (`lock-lost`) unless it
 *   still holds it, so a writer stalled past LOCK_STALE_MS, whose lock was broken, cannot commit
 *   over its successor; release removes the lock only while it is still ours.
 *
 * Residual, by construction: there is no portable compare-and-swap on a directory entry, so
 * breaking a stale lock is check-then-remove, and writers racing to break the same one can remove
 * a fresh lock; the ownership check turns that into a `lock-lost` refusal. A loss would need a
 * writer that died or froze mid-write for LOCK_STALE_MS plus a microsecond-scale interleaving
 * after an ownership check (a writer frozen between its last check and its rename).
 */
function withWriterLock<T>(authPath: string, fn: (lock: WriterLock) => T): T {
  const lock = acquireWriterLock(authPath);
  try {
    return fn(lock);
  } finally {
    releaseWriterLock(lock);
  }
}

function acquireWriterLock(authPath: string): WriterLock {
  mkdirSync(dirname(authPath), { recursive: true });
  const lock: WriterLock = { path: `${authPath}.lock`, owner: `${process.pid}:${randomUUID()}` };
  const deadline = performance.now() + LOCK_WAIT_MS;
  for (;;) {
    if (tryCreateLock(lock)) return lock;
    breakStaleLock(lock.path);
    if (performance.now() >= deadline) throw new AuthFileConcurrentWriteError(authPath, "lock-busy");
    Atomics.wait(lockWaitCell, 0, 0, LOCK_RETRY_MS); // a synchronous sleep that yields the CPU
  }
}

/** One exclusive-create attempt: true once the lock exists with our owner record in it. */
function tryCreateLock(lock: WriterLock): boolean {
  let fd: number;
  try {
    fd = openSync(lock.path, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
  let open = true;
  try {
    writeFileSync(fd, lock.owner);
    open = false;
    closeSync(fd);
    return true;
  } catch (e) {
    if (open) {
      try {
        closeSync(fd);
      } catch {
        // the write error is the one to report
      }
    }
    rmSync(lock.path, { force: true }); // created exclusively above: ours to remove
    throw e;
  }
}

/** Remove a lock older than LOCK_STALE_MS: its writer died or is stuck. */
function breakStaleLock(lockPath: string): void {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs <= LOCK_STALE_MS) return;
    rmSync(lockPath);
  } catch {
    // released or broken meanwhile, or not removable: the next attempt, then the deadline, decide
  }
}

/** True while the lock file is still the one this writer created. */
function stillHeld(lock: WriterLock): boolean {
  try {
    return readFileSync(lock.path, "utf8") === lock.owner;
  } catch {
    return false;
  }
}

function releaseWriterLock(lock: WriterLock): void {
  // Ours only: a lock broken as stale now belongs to the writer that took it.
  if (!stillHeld(lock)) return;
  try {
    rmSync(lock.path, { force: true });
  } catch {
    // left behind: it goes stale after LOCK_STALE_MS; the write itself is already settled
  }
}

/** Bounded merging: a permanently contended store fails loudly instead of spinning. */
const MAX_WRITE_MERGE_ATTEMPTS = 8;

function sameBytes(current: Buffer | undefined, expected: Buffer | undefined): boolean {
  return current === undefined ? expected === undefined : expected !== undefined && current.equals(expected);
}

/**
 * Commit `next` atomically (0600 tmp + rename) while holding `lock`, and only if the file still
 * holds `expected`, the bytes this attempt merged from (or is still absent when those were):
 * false sends the caller back to merge again over what a writer ignoring the lock left there.
 * Refuses (`lock-lost`) when the lock is no longer ours.
 */
function commitUnlessChanged(path: string, next: Buffer, expected: Buffer | undefined, lock: WriterLock): boolean {
  // Unique per write and created exclusively: no two writers, not even two containers sharing
  // $HOME with the same pid, ever write through the same tmp.
  const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, next);
      fchmodSync(fd, 0o600); // exactly 0600, whatever the umask
    } finally {
      closeSync(fd);
    }
    if (!stillHeld(lock)) throw new AuthFileConcurrentWriteError(path, "lock-lost");
    if (!sameBytes(readRawAuthFile(path), expected)) return false;
    renameSync(tmp, path);
    return true;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Normalize a server URL to a stable namespace key (scheme+host+port, no trailing slash/path). */
export function serverKey(server: string): string {
  try {
    const u = new URL(server);
    return `${u.protocol}//${u.host}`;
  } catch {
    return server.replace(/\/+$/, "");
  }
}

/**
 * The token bound to `server`, or undefined. SECURITY: only ever returns a token whose stored
 * `server` matches the REQUESTED server — the per-server namespace + this check are what stop a
 * token going to the wrong (possibly attacker) server.
 */
export function readAuth(server: string, dir?: string): SentropicAuthToken | undefined {
  const key = serverKey(server);
  const tok = readFile(dir)[key];
  if (!tok) return undefined;
  return serverKey(tok.server) === key ? tok : undefined;
}

/**
 * Persist a token under its own server namespace (0600, atomic). Rejects a self-inconsistent
 * token. STORAGE SAFETY: refuses (typed error, the file is not touched) when the existing file
 * is unreadable or not a per-server map. Concurrent writers are serialized by the writer lock and
 * the merge re-checks its source bytes under it; when the lock cannot be had or was lost, or a
 * writer ignoring it keeps changing the file, writeAuth refuses (AuthFileConcurrentWriteError):
 * a refusal loses nothing, a forced rename would lose theirs.
 */
export function writeAuth(token: SentropicAuthToken, dir?: string): void {
  assertServerBound(token, token.server);
  const path = authFilePath(dir);
  const key = serverKey(token.server);
  withWriterLock(path, (lock) => {
    for (let attempt = 0; attempt < MAX_WRITE_MERGE_ATTEMPTS; attempt++) {
      const raw = readRawAuthFile(path);
      const file = parseAuthFile(raw, path);
      file[key] = token;
      if (commitUnlessChanged(path, Buffer.from(JSON.stringify(file, null, 2) + "\n", "utf8"), raw, lock)) return;
    }
    throw new AuthFileConcurrentWriteError(path, "kept-changing");
  });
}

/** An RFC 3339 date-time with an explicit offset: the `Date.toISOString()` family. V8's
 *  Date.parse alone also reads "garbage 2999", a bare date or an offset-less local time, and
 *  rolls "02-30" or "T24:00" over instead of rejecting them. */
const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Epoch ms of a strict RFC 3339 instant; NaN for anything else, a calendar overflow included. */
function parseInstant(value: string): number {
  const m = RFC3339_INSTANT.exec(value);
  if (!m) return Number.NaN;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return Number.NaN;
  }
  return Date.parse(value);
}

export function isExpired(token: SentropicAuthToken, now: number = Date.now()): boolean {
  // A MISSING expiresAt stays fresh (written contract, gated on the 39-auth profile). A PRESENT
  // one must be a strict instant: "" or a lenient form means freshness is UNKNOWN, and unknown
  // never reads as fresh.
  if (token.expiresAt === undefined) return false;
  const t = parseInstant(token.expiresAt);
  return Number.isNaN(t) ? true : t <= now;
}

/**
 * Throw unless `token` is bound to `requestedServer`. Call BEFORE sending a token anywhere, so a
 * 39-auth token issued for server A is never transmitted to a different `--server`.
 */
export function assertServerBound(token: SentropicAuthToken, requestedServer: string): void {
  if (serverKey(token.server) !== serverKey(requestedServer)) {
    throw new Error(
      `sentropic auth: token is bound to ${serverKey(token.server)}, refusing to use it against ${serverKey(requestedServer)}`,
    );
  }
}
