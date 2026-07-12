/**
 * sentropic enrollment — Lot 0: the auth token-file model (D1), server/issuer-bound.
 *
 * Spec §3. The refresh/access tokens live in `~/.sentropic/h2a-auth.json` (0600), namespaced PER
 * SERVER, so a token minted for one sentropic server/issuer is NEVER usable against another (an
 * attacker-supplied `--server` cannot harvest a 39-auth token). Mirrors the atomic-0600 write used
 * by llm-mesh.ts; no network here.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

function sentropicDir(dir?: string): string {
  return dir ?? join(homedir(), ".sentropic");
}

export function authFilePath(dir?: string): string {
  return join(sentropicDir(dir), "h2a-auth.json");
}

function readFile(dir?: string): AuthFile {
  try {
    return JSON.parse(readFileSync(authFilePath(dir), "utf8")) as AuthFile;
  } catch {
    return {};
  }
}

function writeFileAtomic(value: AuthFile, dir?: string): void {
  const path = authFilePath(dir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
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

/** Persist a token under its own server namespace (0600, atomic). Rejects a self-inconsistent token. */
export function writeAuth(token: SentropicAuthToken, dir?: string): void {
  assertServerBound(token, token.server);
  const file = readFile(dir);
  file[serverKey(token.server)] = token;
  writeFileAtomic(file, dir);
}

export function isExpired(token: SentropicAuthToken, now: number = Date.now()): boolean {
  if (!token.expiresAt) return false;
  const t = Date.parse(token.expiresAt);
  return Number.isNaN(t) ? false : t <= now;
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
