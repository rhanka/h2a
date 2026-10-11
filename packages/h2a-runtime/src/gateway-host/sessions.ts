// Retained h2a adapter — owner decision 2026-10-03 (sessions h2a kept until convergence with sentropic workspace/session notions)
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sentropicDir, writePrivateMetadata } from "./config-file.js";

/**
 * Local gateway bearer registry.
 *
 * H2A owns only minting and forwarding this opaque, process-local bearer. It
 * contains no provider credential, account binding, route, model or affinity.
 * Mesh owns every one of those concerns after caller authentication.
 *
 * The registry persists to disk so a gateway restart (or an h2a upgrade, which
 * restarts the gateway) keeps every live session's bearer valid: an old token
 * still authenticates after boot, and re-acquiring the same sessionId returns
 * the same token instead of minting a replacement. Owner decision 2026-10-10:
 * restarts must never invalidate live sessions.
 */
export interface SessionEntry {
  readonly sessionId: string;
  readonly gatewayToken: string;
  readonly clientSessionId: string;
  readonly workspaceId?: string;
  readonly profile?: string;
  readonly createdAt: string;
}

export interface AcquireSessionOptions {
  readonly clientSessionId?: string;
  readonly workspaceId?: string;
  readonly profile?: string;
}

export interface SessionResult {
  readonly gatewayToken: string;
  readonly sessionId: string;
  readonly clientSessionId: string;
}

const sessionsByToken = new Map<string, SessionEntry>();
const tokensBySession = new Map<string, string>();

const newGatewayToken = (): string => `gw-v2-${randomBytes(32).toString("base64url")}`;

/**
 * Persisted store shape. Written atomically (0600, tmp+rename) after every
 * mint and reset; hydrated lazily on first access so any caller (host, daemon,
 * doctor) sees the same restored state without an explicit boot hook.
 */
const gatewaySessionsStorePath = (): string =>
  join(sentropicDir(), "llm-mesh-gateway-sessions.json");

let storeHydrated = false;

const validEntry = (value: unknown): value is SessionEntry =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SessionEntry).sessionId === "string" &&
  (value as SessionEntry).sessionId.length > 0 &&
  typeof (value as SessionEntry).gatewayToken === "string" &&
  (value as SessionEntry).gatewayToken.length > 0 &&
  typeof (value as SessionEntry).clientSessionId === "string" &&
  typeof (value as SessionEntry).createdAt === "string";

function ensureStoreHydrated(): void {
  if (storeHydrated) return;
  storeHydrated = true;
  const path = gatewaySessionsStorePath();
  if (!existsSync(path)) return;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("store is not a JSON array");
    for (const entry of parsed) {
      if (!validEntry(entry)) continue;
      if (sessionsByToken.has(entry.gatewayToken)) continue;
      sessionsByToken.set(entry.gatewayToken, entry);
      const existingToken = tokensBySession.get(entry.sessionId);
      if (existingToken === undefined) tokensBySession.set(entry.sessionId, entry.gatewayToken);
    }
  } catch (error) {
    // Fail-soft: an unreadable or corrupt store never blocks the boot; the
    // registry simply starts empty and mints fresh tokens as needed.
    process.stderr.write(
      `[gateway-host] session bearer store unreadable (${(error as Error).message}); starting empty\n`,
    );
  }
}

function persistStore(): void {
  try {
    writePrivateMetadata(gatewaySessionsStorePath(), [...sessionsByToken.values()]);
  } catch (error) {
    // Persistence is best-effort for the running process: a failed write is
    // logged but never blocks minting or serving.
    process.stderr.write(
      `[gateway-host] session bearer store write failed (${(error as Error).message})\n`,
    );
  }
}

export async function acquireSession(
  sessionId: string,
  options: AcquireSessionOptions = {},
): Promise<SessionResult> {
  ensureStoreHydrated();
  const cleanSessionId = sessionId.trim();
  if (!cleanSessionId) throw new Error("sessionId (string) required");
  const existingToken = tokensBySession.get(cleanSessionId);
  if (existingToken) {
    const existing = sessionsByToken.get(existingToken);
    if (existing) {
      return {
        gatewayToken: existing.gatewayToken,
        sessionId: existing.sessionId,
        clientSessionId: existing.clientSessionId,
      };
    }
  }
  const gatewayToken = newGatewayToken();
  const entry: SessionEntry = {
    sessionId: cleanSessionId,
    gatewayToken,
    clientSessionId: options.clientSessionId?.trim() || cleanSessionId,
    ...(options.workspaceId?.trim() ? { workspaceId: options.workspaceId.trim() } : {}),
    ...(options.profile?.trim() ? { profile: options.profile.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  sessionsByToken.set(gatewayToken, entry);
  tokensBySession.set(cleanSessionId, gatewayToken);
  persistStore();
  return {
    gatewayToken,
    sessionId: entry.sessionId,
    clientSessionId: entry.clientSessionId,
  };
}

export async function lookupToken(
  gatewayToken: string,
): Promise<SessionEntry | undefined> {
  ensureStoreHydrated();
  return sessionsByToken.get(gatewayToken);
}

export function lookupSessionById(sessionId: string): SessionEntry | undefined {
  ensureStoreHydrated();
  const token = tokensBySession.get(sessionId);
  return token ? sessionsByToken.get(token) : undefined;
}

export function sessionCount(): number {
  ensureStoreHydrated();
  return sessionsByToken.size;
}

/** Public registry view for sessions that have not acquired a route yet. */
export function listPublicSessions(): Omit<SessionEntry, "gatewayToken">[] {
  ensureStoreHydrated();
  return [...sessionsByToken.values()].map(({ gatewayToken: _bearer, ...session }) => session);
}

export function resetSessions(): void {
  ensureStoreHydrated();
  sessionsByToken.clear();
  tokensBySession.clear();
  persistStore();
}
