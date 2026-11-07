/**
 * The sentropic publish client: sign in (authorization_code + PKCE S256, loopback redirect),
 * keep the session (expiry, refresh-token rotation when the server issues refresh tokens), bind
 * the local h2a workspace to one sentropic workspace, sign out, and prove the MCP path.
 *
 * STORAGE (no second store):
 * - the token pair lives in the shared sentropic token store (auth-token.ts: per-server
 *   namespace keyed by the resource server origin, 0600, atomic, fail-closed). The record keeps
 *   its existing shape — server, issuer, accessToken, refreshToken?, expiresAt, subject — and
 *   this client always writes an expiresAt. Rotation is a compare-and-set on the refresh token
 *   (updateAuth), so a pair another process already rotated is never overwritten, and the old
 *   refresh token is never kept.
 * - the binding lives next to it (workspace-binding.ts), one file per (server, local workspace).
 *
 * The sentropic authorization server issues no refresh token today (no refresh_token grant,
 * no offline_access in discovery): the access token is stored with its expiry and an expired
 * session asks the human to log in again. When the server advertises both, the client asks for
 * offline_access and the stored refresh token is rotated on every refresh; a refused refresh
 * (invalid_grant: revoked, expired, reuse detected) drops the dead pair and asks for a login.
 */

import {
  AuthFileConcurrentWriteError,
  isExpired,
  readAuth,
  removeAuth,
  updateAuth,
  writeAuth,
  type SentropicAuthToken,
} from "./auth-token.js";
import { buildAuthorizeRequest, pkceS256, randomState } from "./enroll-flow.js";
import { mcpListTools } from "./mcp-client.js";
import {
  decodeJwtPayload,
  discoverAuthorizationServer,
  exchangeAuthorizationCode,
  expiryOf,
  refreshTokenGrant,
  requestedScopes,
  revokeToken,
  startLoopbackReceiver,
  TokenEndpointError,
  validateAccessTokenClaims,
  validateIdToken,
  type FetchLike,
} from "./oauth-pkce.js";
import { assertSafeEndpoint, requireClientId, type SentropicPublishConfig } from "./publish-config.js";
import { SentropicLoginRequiredError, SentropicPublishError, publicErrorMessage } from "./publish-errors.js";
import {
  assertSentropicWorkspaceId,
  readBinding,
  removeBinding,
  writeBinding,
  type WorkspaceBinding,
} from "./workspace-binding.js";

/** A token expiring within this margin is treated as expired before use. */
export const EXPIRY_MARGIN_MS = 60_000;

export interface PublishRuntime {
  readonly config: SentropicPublishConfig;
  readonly fetch: FetchLike;
  readonly now: () => number;
  /** One progress/information line for the human (stderr). Never receives a secret. */
  readonly log: (line: string) => void;
  readonly clientVersion: string;
}

const PREFIX = "[h2a] sentropic:";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Strict freshness for USE: an expiry inside the margin, or one the store cannot read as a strict
 * RFC 3339 instant (isExpired), is expired — and so is a MISSING expiry here, although the store
 * reads it as fresh: this client always writes one, so a record without it is not one of ours.
 */
export function needsNewToken(token: SentropicAuthToken, now: number): boolean {
  return token.expiresAt === undefined || isExpired(token, now + EXPIRY_MARGIN_MS);
}

function storedToken(rt: PublishRuntime): SentropicAuthToken | undefined {
  return readAuth(rt.config.server, rt.config.stateDir);
}

/** The non-secret claims of the stored access token, for display and binding. */
function accessClaims(token: SentropicAuthToken): { tenantId?: string; scope?: string; clientId?: string } {
  const claims = decodeJwtPayload(token.accessToken);
  const out: { tenantId?: string; scope?: string; clientId?: string } = {};
  if (typeof claims?.tid === "string" && claims.tid) out.tenantId = claims.tid;
  if (typeof claims?.scope === "string") out.scope = claims.scope;
  if (typeof claims?.client_id === "string") out.clientId = claims.client_id;
  return out;
}

// ---- login ------------------------------------------------------------------------------------

export interface LoginOptions {
  /** undefined = do not launch a browser (--no-browser); the URL is printed either way. */
  readonly openBrowser: ((url: string) => boolean) | undefined;
  readonly tenant?: string;
  readonly timeoutSeconds: number;
  /** ask for a refresh token when the server offers one (default true). */
  readonly refresh: boolean;
}

export interface LoginResult {
  readonly subject: string;
  readonly email: string | undefined;
  readonly tenantId: string | undefined;
  readonly expiresAt: string;
  readonly refreshable: boolean;
  readonly grantedScope: string | undefined;
}

const TENANT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export async function login(rt: PublishRuntime, opts: LoginOptions): Promise<LoginResult> {
  const clientId = requireClientId(rt.config);
  if (opts.tenant !== undefined && !TENANT.test(opts.tenant)) {
    throw new SentropicPublishError("usage", "--tenant must be a plain organization id");
  }
  const meta = await discoverAuthorizationServer(rt.config.issuer, rt.fetch, clientId);
  const scopes = requestedScopes(meta, { refresh: opts.refresh });
  if (meta.scopesSupported.length > 0) {
    const missing = scopes.filter((scope) => !meta.scopesSupported.includes(scope));
    if (missing.length > 0) {
      throw new SentropicPublishError(
        "discovery",
        `the authorization server does not offer the scopes publishing needs: ${missing.join(" ")}`,
      );
    }
  }

  const state = randomState();
  const nonce = randomState();
  const receiver = await startLoopbackReceiver({
    port: rt.config.redirectPort,
    state,
    issuer: meta.issuer,
    requireIss: meta.issParameterSupported,
    timeoutMs: opts.timeoutSeconds * 1000,
  });
  try {
    const request = buildAuthorizeRequest(
      {
        authorizeUrl: meta.authorizationEndpoint,
        clientId,
        redirectUri: receiver.redirectUri,
        scope: scopes.join(" "),
        nonce,
        resource: rt.config.mcpUrl,
        ...(opts.tenant !== undefined ? { extraParams: { tenant: opts.tenant } } : {}),
      },
      pkceS256(),
      state,
    );
    let opened = false;
    if (opts.openBrowser) {
      try {
        opened = opts.openBrowser(request.url);
      } catch {
        opened = false;
      }
    }
    rt.log(`${PREFIX} sign in to ${meta.issuer} (sentropic ${rt.config.environment})`);
    rt.log(opened ? `${PREFIX} if the browser did not open, visit this URL:` : `${PREFIX} open this URL in a browser:`);
    rt.log(request.url);
    rt.log(`${PREFIX} waiting up to ${opts.timeoutSeconds} s for the browser to come back to ${receiver.redirectUri}`);

    const code = await receiver.code;
    const tokens = await exchangeAuthorizationCode(rt.fetch, meta, {
      clientId,
      code,
      redirectUri: receiver.redirectUri,
      verifier: request.verifier,
      resource: rt.config.mcpUrl,
    });
    // openid is not requested: the account is the access token's subject, its claims checked
    // for consistency (issuer, client, audience). An id_token sent anyway must be this login's.
    const access = validateAccessTokenClaims(tokens.accessToken, { issuer: meta.issuer, clientId, resource: rt.config.mcpUrl });
    let email: string | undefined;
    let tenantId = access.tenantId;
    if (tokens.idToken !== undefined) {
      const id = validateIdToken(tokens.idToken, { issuer: meta.issuer, clientId, nonce, now: rt.now() });
      if (id.subject !== access.subject) {
        throw new SentropicPublishError("id_token", "the access token and the id_token name different subjects; nothing was stored");
      }
      email = id.email;
      tenantId ??= id.tenantId;
    }
    const expiresAtMs = expiryOf(tokens, rt.now());
    if (expiresAtMs === undefined) {
      throw new SentropicPublishError("token", "the token response carries no expiry; nothing was stored");
    }
    const record: SentropicAuthToken = {
      server: rt.config.server,
      issuer: meta.issuer,
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
      expiresAt: iso(expiresAtMs),
      subject: access.subject,
    };
    // A new login replaces the whole pair for this server: an older refresh token is not kept.
    writeAuth(record, rt.config.stateDir);
    return {
      subject: access.subject,
      email,
      tenantId,
      expiresAt: record.expiresAt!,
      refreshable: record.refreshToken !== undefined,
      grantedScope: tokens.scope,
    };
  } finally {
    await receiver.close();
  }
}

// ---- session ----------------------------------------------------------------------------------

export interface SessionView {
  readonly loggedIn: boolean;
  readonly subject: string | undefined;
  readonly tenantId: string | undefined;
  readonly scope: string | undefined;
  readonly expiresAt: string | undefined;
  readonly expired: boolean;
  readonly refreshable: boolean;
  /** the stored token was minted by another authorization server than the configured one. */
  readonly foreignIssuer: boolean;
}

/** The local session, read-only, no network. Never returns a token. */
export function readSession(rt: PublishRuntime): SessionView {
  const token = storedToken(rt);
  if (token === undefined) {
    return {
      loggedIn: false, subject: undefined, tenantId: undefined, scope: undefined,
      expiresAt: undefined, expired: false, refreshable: false, foreignIssuer: false,
    };
  }
  const claims = accessClaims(token);
  return {
    loggedIn: true,
    subject: token.subject,
    tenantId: claims.tenantId,
    scope: claims.scope,
    expiresAt: token.expiresAt,
    expired: token.expiresAt === undefined || isExpired(token, rt.now()),
    refreshable: token.refreshToken !== undefined,
    foreignIssuer: token.issuer !== rt.config.issuer,
  };
}

async function withStoreRetry<T>(write: () => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return write();
    } catch (error) {
      if (!(error instanceof AuthFileConcurrentWriteError) || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

async function refreshStored(rt: PublishRuntime, token: SentropicAuthToken): Promise<SentropicAuthToken> {
  const used = token.refreshToken;
  if (used === undefined) throw new SentropicLoginRequiredError(`the sentropic login expired at ${token.expiresAt ?? "an unknown time"}`);
  const clientId = requireClientId(rt.config);
  const meta = await discoverAuthorizationServer(token.issuer, rt.fetch, clientId);
  let tokens;
  try {
    tokens = await refreshTokenGrant(rt.fetch, meta, { clientId, refreshToken: used, resource: rt.config.mcpUrl });
  } catch (error) {
    if (error instanceof TokenEndpointError && error.refused) {
      // The refresh token is dead (revoked, expired, reuse detected): drop the pair unless
      // another writer already replaced it, and use theirs when it is fresh.
      const after = await withStoreRetry(() =>
        updateAuth(rt.config.server, (current) => (current?.refreshToken === used ? undefined : current), rt.config.stateDir),
      );
      if (after !== undefined && !needsNewToken(after, rt.now())) return after;
      throw new SentropicLoginRequiredError(
        `the authorization server refused the refresh (${error.oauthError}): the sentropic session is over`,
      );
    }
    throw error;
  }
  const expiresAtMs = expiryOf(tokens, rt.now());
  if (expiresAtMs === undefined) throw new SentropicPublishError("token", "the refreshed token carries no expiry; it was not stored");
  const rotated: SentropicAuthToken = {
    server: token.server,
    issuer: token.issuer,
    accessToken: tokens.accessToken,
    // Rotation: the new refresh token replaces the old one; the old one is never kept, even
    // when the server returns none (the next expiry then asks for a login).
    ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
    expiresAt: iso(expiresAtMs),
    ...(token.subject !== undefined ? { subject: token.subject } : {}),
  };
  const stored = await withStoreRetry(() =>
    updateAuth(rt.config.server, (current) => (current?.refreshToken === used ? rotated : current), rt.config.stateDir),
  );
  if (stored === rotated) return rotated;
  // Another writer replaced the pair meanwhile (its own rotation, a new login, a logout).
  if (stored !== undefined && !needsNewToken(stored, rt.now())) return stored;
  throw new SentropicLoginRequiredError("the sentropic session changed while it was being refreshed");
}

/** A token fit to send now: the stored one when fresh, else refreshed (rotation), else a login prompt. */
export async function ensureFreshToken(rt: PublishRuntime): Promise<SentropicAuthToken> {
  const token = storedToken(rt);
  if (token === undefined) throw new SentropicLoginRequiredError(`not logged in to sentropic ${rt.config.environment}`);
  if (token.issuer !== rt.config.issuer) {
    throw new SentropicLoginRequiredError("the stored sentropic token was issued by another authorization server than the configured one");
  }
  if (!needsNewToken(token, rt.now())) return token;
  return refreshStored(rt, token);
}

// ---- logout -----------------------------------------------------------------------------------

export interface LogoutResult {
  readonly wasLoggedIn: boolean;
  /** "revoked" | "no-endpoint" | "failed" | "skipped" */
  readonly server: "revoked" | "no-endpoint" | "failed" | "skipped";
}

export async function logout(rt: PublishRuntime, opts: { localOnly: boolean }): Promise<LogoutResult> {
  const token = storedToken(rt);
  if (token === undefined) return { wasLoggedIn: false, server: "skipped" };
  let server: LogoutResult["server"] = "skipped";
  if (!opts.localOnly) {
    try {
      // The token goes back only to the authorization server that minted it.
      assertSafeEndpoint(token.issuer, "the issuer of the stored token");
      const meta = await discoverAuthorizationServer(token.issuer, rt.fetch, rt.config.clientId);
      if (meta.revocationEndpoint === undefined) {
        server = "no-endpoint";
        rt.log(`${PREFIX} the authorization server offers no revocation endpoint: the token stays valid there until ${token.expiresAt ?? "it expires"}`);
      } else {
        if (token.refreshToken !== undefined) {
          await revokeToken(rt.fetch, meta.revocationEndpoint, { clientId: rt.config.clientId, token: token.refreshToken, hint: "refresh_token" });
        }
        await revokeToken(rt.fetch, meta.revocationEndpoint, { clientId: rt.config.clientId, token: token.accessToken, hint: "access_token" });
        server = "revoked";
      }
    } catch (error) {
      server = "failed";
      rt.log(
        `${PREFIX} server revocation failed (${publicErrorMessage(error)}); ` +
          `the token is removed locally and stays valid on the server until ${token.expiresAt ?? "it expires"}`,
      );
    }
  }
  await withStoreRetry(() => removeAuth(rt.config.server, rt.config.stateDir));
  return { wasLoggedIn: true, server };
}

// ---- binding ----------------------------------------------------------------------------------

export async function bindWorkspace(
  rt: PublishRuntime,
  p: { localWorkspace: string | undefined; workspaceId: string; verify: boolean },
): Promise<WorkspaceBinding> {
  const workspaceId = assertSentropicWorkspaceId(p.workspaceId);
  if (p.localWorkspace === undefined) {
    throw new SentropicPublishError(
      "binding",
      "this directory is not inside a git workspace: h2a identifies a workspace by its git history",
    );
  }
  let token = storedToken(rt);
  if (token === undefined) throw new SentropicLoginRequiredError(`not logged in to sentropic ${rt.config.environment}`);
  if (p.verify) {
    token = await ensureFreshToken(rt);
    // Throws unless the resource server accepts this workspace for this account.
    await mcpListTools({ fetch: rt.fetch, mcpUrl: rt.config.mcpUrl, token, workspaceId, clientVersion: rt.clientVersion });
  }
  const claims = accessClaims(token);
  const binding: WorkspaceBinding = {
    localWorkspace: p.localWorkspace,
    server: rt.config.server,
    workspaceId,
    ...(claims.tenantId !== undefined ? { tenantId: claims.tenantId } : {}),
    ...(token.subject !== undefined ? { subject: token.subject } : {}),
    boundAt: iso(rt.now()),
  };
  writeBinding(binding, rt.config.stateDir);
  return binding;
}

export function unbindWorkspace(rt: PublishRuntime, localWorkspace: string | undefined): boolean {
  if (localWorkspace === undefined) {
    throw new SentropicPublishError("binding", "this directory is not inside a git workspace");
  }
  return removeBinding(rt.config.server, localWorkspace, rt.config.stateDir);
}

export function readWorkspaceBinding(rt: PublishRuntime, localWorkspace: string | undefined): WorkspaceBinding | undefined {
  return localWorkspace === undefined ? undefined : readBinding(rt.config.server, localWorkspace, rt.config.stateDir);
}

// ---- MCP probe --------------------------------------------------------------------------------

export async function listPublishTools(
  rt: PublishRuntime,
  localWorkspace: string | undefined,
): Promise<{ tools: string[]; workspaceId: string | undefined }> {
  const token = await ensureFreshToken(rt);
  const binding = readWorkspaceBinding(rt, localWorkspace);
  const tools = await mcpListTools({
    fetch: rt.fetch,
    mcpUrl: rt.config.mcpUrl,
    token,
    ...(binding !== undefined ? { workspaceId: binding.workspaceId } : {}),
    clientVersion: rt.clientVersion,
  });
  return { tools, workspaceId: binding?.workspaceId };
}

/** Short form of a local ws: identity for display. */
export function shortWorkspace(id: string): string {
  return id.length > 15 ? `${id.slice(0, 11)}…${id.slice(-4)}` : id;
}

