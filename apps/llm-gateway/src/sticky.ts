import { randomBytes } from "node:crypto";

/**
 * Local gateway bearer registry.
 *
 * H2A owns only minting and forwarding this opaque, process-local bearer. It
 * contains no provider credential, account binding, route, model or affinity.
 * Mesh owns every one of those concerns after caller authentication.
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

export async function acquireSession(
  sessionId: string,
  options: AcquireSessionOptions = {},
): Promise<SessionResult> {
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
  return {
    gatewayToken,
    sessionId: entry.sessionId,
    clientSessionId: entry.clientSessionId,
  };
}

export async function lookupToken(
  gatewayToken: string,
): Promise<SessionEntry | undefined> {
  return sessionsByToken.get(gatewayToken);
}

export function lookupSessionById(sessionId: string): SessionEntry | undefined {
  const token = tokensBySession.get(sessionId);
  return token ? sessionsByToken.get(token) : undefined;
}

export function sessionCount(): number {
  return sessionsByToken.size;
}

export function resetSessions(): void {
  sessionsByToken.clear();
  tokensBySession.clear();
}
