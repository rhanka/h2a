/**
 * sentropic enrollment — Lot 0: the auth token-file model (D1), server/issuer-bound.
 *
 * Spec §3. The refresh/access tokens live in `~/.sentropic/h2a-auth.json` (0600), namespaced PER
 * SERVER, so a token minted for one sentropic server/issuer is NEVER usable against another (an
 * attacker-supplied `--server` cannot harvest a 39-auth token). Mirrors the atomic-0600 write used
 * by gateway-host/daemon.ts; no network here.
 *
 * The write path is fail-closed storage: it refuses (typed error, nothing written) to touch a
 * file it cannot parse or that is not a per-server map, and it re-checks the exact bytes it
 * merged from before renaming, so a write that lands in the read-modify-write window is never
 * lost.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

/** The auth file exists on disk but cannot be trusted: unreadable, unparseable, or not a
 *  per-server map. Writes refuse instead of destroying it; reads fail closed (undefined). */
export class DamagedAuthFileError extends Error {
  constructor(readonly path: string, options?: { cause?: unknown }) {
    super(`sentropic auth: refusing to touch the auth file, it is unreadable or malformed: ${path}`, options);
    this.name = "DamagedAuthFileError";
  }
}

/** Concurrent writes kept landing inside our merge window; the refusal itself loses nothing. */
export class AuthFileConcurrentWriteError extends Error {
  constructor(readonly path: string, options?: { cause?: unknown }) {
    super(`sentropic auth: the auth file kept changing while merging, refusing to overwrite it: ${path}`, options);
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
    throw new DamagedAuthFileError(path, { cause: e });
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
  } catch (e) {
    throw new DamagedAuthFileError(path, { cause: e });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DamagedAuthFileError(path);
  }
  for (const value of Object.values(parsed)) {
    if (!isStoredToken(value)) throw new DamagedAuthFileError(path);
  }
  return parsed as AuthFile;
}

/** Bounded merging: a permanently contended store fails loudly instead of spinning. */
const MAX_WRITE_MERGE_ATTEMPTS = 8;

/**
 * Atomic write conditional on the exact bytes the merge started from: the tmp file is committed
 * only if the file on disk is still `expected` (or still absent when expected is), so a
 * concurrent write discovered here returns false to be merged again, never clobbered.
 */
function writeUnlessChanged(path: string, next: Buffer, expected: Buffer | undefined): boolean {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, next, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    const current = readRawAuthFile(path);
    const same = current === undefined ? expected === undefined : expected !== undefined && current.equals(expected);
    if (!same) return false;
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
 * is unreadable or not a per-server map, and merges-and-rechecks so a concurrent write is
 * never lost — refusal after the bounded retry window loses nothing, a forced rename would
 * lose theirs.
 */
export function writeAuth(token: SentropicAuthToken, dir?: string): void {
  assertServerBound(token, token.server);
  const path = authFilePath(dir);
  const key = serverKey(token.server);
  for (let attempt = 0; attempt < MAX_WRITE_MERGE_ATTEMPTS; attempt++) {
    const raw = readRawAuthFile(path);
    const file = parseAuthFile(raw, path);
    file[key] = token;
    if (writeUnlessChanged(path, Buffer.from(JSON.stringify(file, null, 2) + "\n", "utf8"), raw)) return;
  }
  throw new AuthFileConcurrentWriteError(path);
}

export function isExpired(token: SentropicAuthToken, now: number = Date.now()): boolean {
  if (!token.expiresAt) return false;
  const t = Date.parse(token.expiresAt);
  // Fails closed: an unparseable date means freshness is UNKNOWN, and unknown never reads as fresh.
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
