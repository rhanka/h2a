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
 * - the binding lives next to it (workspace-binding.ts), one file per (server, local workspace):
 *   a routing choice only. The workspace listing (workspaces_list) is read live at each bind or
 *   `workspaces` and never stored: its `publishable` flag is a hint, the resource server
 *   re-checks at every call.
 *
 * REFRESH: discovery for the h2a-cli client advertises offline_access and the refresh_token
 * grant when the AS lets that client refresh; the client then asks for offline_access and the
 * stored refresh token is rotated on every refresh, one refresh at a time across processes (the
 * refresh lock: a second presentation of a rotated token would make the AS revoke the family).
 * Without them the access token is stored with its expiry and an expired session asks for a new
 * login. A refused refresh (invalid_grant: revoked, expired, reuse detected) drops the dead pair
 * and asks for a login.
 */

import {
  AuthFileConcurrentWriteError,
  authFilePath,
  isExpired,
  readAuth,
  removeAuth,
  updateAuth,
  writeAuth,
  type SentropicAuthToken,
} from "./auth-token.js";
import { buildAuthorizeRequest, pkceS256, randomState } from "./enroll-flow.js";
import { HOST_TOOLS, openMcpSession, printableToolName, WORKSPACES_LIST_TOOL, type McpSession } from "./mcp-client.js";
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
import {
  SentropicLoginRequiredError,
  SentropicPublishError,
  SentropicWorkspaceAccessError,
  publicErrorMessage,
  safeErrorCode,
} from "./publish-errors.js";
import { REFRESH_LOCK_BUSY, withRefreshLock } from "./refresh-lock.js";
import {
  assertSentropicWorkspaceId,
  isSentropicWorkspaceId,
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
  /** How long a refresh waits for another process's refresh (refresh lock). */
  readonly refreshLockWaitMs: number;
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
  // Sent although openid is not requested: an id_token the server returns anyway is then
  // checked against it.
  const nonce = randomState();
  let foreignStateReported = false;
  const receiver = await startLoopbackReceiver({
    port: rt.config.redirectPort,
    state,
    issuer: meta.issuer,
    requireIss: meta.issParameterSupported,
    timeoutMs: opts.timeoutSeconds * 1000,
    onForeignState: () => {
      if (foreignStateReported) return;
      foreignStateReported = true;
      rt.log(`${PREFIX} a response with another state reached the sign-in redirect and was ignored (forged or stale); still waiting`);
    },
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
    // The tenant is the access token's: it is the one the resource server reads.
    const access = validateAccessTokenClaims(tokens.accessToken, { issuer: meta.issuer, clientId, resource: rt.config.mcpUrl });
    let email: string | undefined;
    if (tokens.idToken !== undefined) {
      const id = validateIdToken(tokens.idToken, { issuer: meta.issuer, clientId, nonce, now: rt.now() });
      if (id.subject !== access.subject) {
        throw new SentropicPublishError("id_token", "the access token and the id_token name different subjects; nothing was stored");
      }
      email = id.email;
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
      tenantId: access.tenantId,
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

/** The stored token when it was minted by the configured AS; a login prompt otherwise. */
function usableStoredToken(rt: PublishRuntime): SentropicAuthToken {
  const token = storedToken(rt);
  if (token === undefined) throw new SentropicLoginRequiredError(`not logged in to sentropic ${rt.config.environment}`);
  if (token.issuer !== rt.config.issuer) {
    throw new SentropicLoginRequiredError("the stored sentropic token was issued by another authorization server than the configured one");
  }
  return token;
}

/**
 * Refresh the stored pair, one refresh at a time across h2a processes. Under the refresh lock
 * the store is read again: a pair another process rotated meanwhile is used as is, so a rotated
 * refresh token is never presented twice (the AS would detect reuse and revoke the family).
 * When another live process keeps the lock past the wait, its pair is used if fresh by then;
 * otherwise the call is refused without presenting anything.
 */
async function refreshStored(rt: PublishRuntime, token: SentropicAuthToken): Promise<SentropicAuthToken> {
  if (token.refreshToken === undefined) {
    throw new SentropicLoginRequiredError(`the sentropic login expired at ${token.expiresAt ?? "an unknown time"}`);
  }
  const clientId = requireClientId(rt.config);
  const outcome = await withRefreshLock(authFilePath(rt.config.stateDir), rt.refreshLockWaitMs, async () => {
    const current = usableStoredToken(rt);
    if (!needsNewToken(current, rt.now())) return current;
    return refreshUnderLock(rt, current, clientId);
  });
  if (outcome !== REFRESH_LOCK_BUSY) return outcome;
  const current = storedToken(rt);
  if (current !== undefined && current.issuer === rt.config.issuer && !needsNewToken(current, rt.now())) return current;
  throw new SentropicPublishError("token", "another h2a process is refreshing the sentropic session; try again in a moment");
}

/** The refresh_token grant for `token`, the caller holding the refresh lock. */
async function refreshUnderLock(rt: PublishRuntime, token: SentropicAuthToken, clientId: string): Promise<SentropicAuthToken> {
  const used = token.refreshToken;
  if (used === undefined) throw new SentropicLoginRequiredError(`the sentropic login expired at ${token.expiresAt ?? "an unknown time"}`);
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
  const token = usableStoredToken(rt);
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

// ---- workspaces (listing, live) ---------------------------------------------------------------

export type WorkspaceRole = "viewer" | "commenter" | "editor" | "admin";
const ROLES: ReadonlySet<string> = new Set<WorkspaceRole>(["viewer", "commenter", "editor", "admin"]);

/** One workspace of the listing, as the resource server reports it NOW. Never stored. */
export interface WorkspaceEntry {
  readonly workspaceRef: string;
  /** Server-chosen text, without control or bidirectional formatting characters. */
  readonly name: string;
  readonly role: WorkspaceRole;
  /** A hint for choosing: the resource server re-checks at every publish. */
  readonly publishable: boolean;
}

interface Directory {
  /** undefined: the resource server does not offer workspaces_list (absent from tools/list). */
  readonly entries: readonly WorkspaceEntry[] | undefined;
  /** Entries dropped as malformed. */
  readonly ignored: number;
}

const MAX_NAME_CHARS = 128;

/** A server-chosen name fit for a terminal: control, format (bidi) and line/paragraph separators replaced. */
export function printableWorkspaceName(name: string): string {
  const chars = Array.from(name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "?"));
  return chars.length > MAX_NAME_CHARS ? `${chars.slice(0, MAX_NAME_CHARS - 1).join("")}…` : chars.join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDirectory(payload: Record<string, unknown> | undefined): { entries: WorkspaceEntry[]; ignored: number } {
  const list = payload?.workspaces;
  if (!Array.isArray(list)) throw new SentropicPublishError("mcp", "workspaces_list returned no workspace list");
  const entries: WorkspaceEntry[] = [];
  let ignored = 0;
  for (const item of list) {
    if (
      isRecord(item) &&
      typeof item.workspaceRef === "string" &&
      isSentropicWorkspaceId(item.workspaceRef) &&
      typeof item.name === "string" &&
      typeof item.role === "string" &&
      ROLES.has(item.role) &&
      typeof item.publishable === "boolean"
    ) {
      entries.push({
        workspaceRef: item.workspaceRef,
        name: printableWorkspaceName(item.name),
        role: item.role as WorkspaceRole,
        publishable: item.publishable,
      });
    } else {
      ignored++;
    }
  }
  return { entries, ignored };
}

/**
 * One LIVE read of the listing. workspaces_list is called only when tools/list names it — its
 * absence is never inferred from the shape of an error. Nothing of the answer is kept.
 */
async function readDirectory(session: McpSession, workspaceRef: string | undefined): Promise<Directory> {
  const tools = await session.listTools(workspaceRef);
  if (!tools.includes(WORKSPACES_LIST_TOOL)) return { entries: undefined, ignored: 0 };
  const result = await session.callTool({ name: WORKSPACES_LIST_TOOL, arguments: {}, workspaceRef });
  if (result.isError) {
    throw new SentropicPublishError("mcp", `workspaces_list failed on the resource server (${safeErrorCode(result.payload?.error)})`);
  }
  return parseDirectory(result.payload);
}

function sessionFor(rt: PublishRuntime, token: SentropicAuthToken): Promise<McpSession> {
  return openMcpSession({ fetch: rt.fetch, mcpUrl: rt.config.mcpUrl, token, clientVersion: rt.clientVersion });
}

/** The binding was made by the account AND in the tenant of `token`. */
function bindingBelongsTo(binding: WorkspaceBinding, token: SentropicAuthToken): boolean {
  return binding.subject === token.subject && binding.tenantId === accessClaims(token).tenantId;
}

function boundByAnotherAccount(): SentropicPublishError {
  return new SentropicPublishError(
    "binding",
    "this workspace was bound by another account or in another tenant than the one logged in: bind it again " +
      "(`h2a sentropic workspaces` lists the candidates, then `h2a sentropic bind <workspace-id>`)",
  );
}

export interface WorkspacesListing {
  readonly workspaces: readonly WorkspaceEntry[];
  readonly ignored: number;
  /** The workspace bound here, when that binding belongs to the logged-in account and tenant. */
  readonly boundWorkspaceRef: string | undefined;
  /** A binding exists here but was made by another account or in another tenant. */
  readonly foreignBinding: boolean;
  readonly subject: string | undefined;
  readonly tenantId: string | undefined;
}

/** The workspaces this account can read now (workspaces_list), read live, never stored. */
export async function listWorkspaces(rt: PublishRuntime, localWorkspace: string | undefined): Promise<WorkspacesListing> {
  const token = await ensureFreshToken(rt);
  let binding: WorkspaceBinding | undefined;
  try {
    binding = readWorkspaceBinding(rt, localWorkspace);
  } catch {
    binding = undefined; // a damaged binding is reported by `status`; the listing does not need it
  }
  const own = binding !== undefined && bindingBelongsTo(binding, token) ? binding : undefined;
  const directory = await readDirectory(await sessionFor(rt, token), own?.workspaceId);
  if (directory.entries === undefined) {
    throw new SentropicPublishError(
      "mcp",
      "the resource server does not offer workspaces_list yet: bind with the explicit sentropic workspace id " +
        "(`h2a sentropic bind <workspace-id>`); the server checks it at publish",
    );
  }
  return {
    workspaces: directory.entries,
    ignored: directory.ignored,
    boundWorkspaceRef: own?.workspaceId,
    foreignBinding: binding !== undefined && own === undefined,
    subject: token.subject,
    tenantId: accessClaims(token).tenantId,
  };
}

// ---- binding ----------------------------------------------------------------------------------

export interface BindResult {
  readonly binding: WorkspaceBinding;
  /** The listing entry the bind was checked against; undefined when workspaces_list is not offered. */
  readonly checked: WorkspaceEntry | undefined;
}

/**
 * Bind this local workspace to the sentropic workspace the human names. When the resource
 * server offers workspaces_list, the id must be listed for this account and publishable;
 * otherwise the bind is recorded unchecked (the server stays the authority at publish). The
 * listing serves this decision only and is not kept.
 */
export async function bindWorkspace(
  rt: PublishRuntime,
  p: { localWorkspace: string | undefined; workspaceId: string },
): Promise<BindResult> {
  const workspaceId = assertSentropicWorkspaceId(p.workspaceId);
  if (p.localWorkspace === undefined) {
    throw new SentropicPublishError(
      "binding",
      "this directory is not inside a git workspace: h2a identifies a workspace by its git history",
    );
  }
  const token = await ensureFreshToken(rt);
  const claims = accessClaims(token);
  const directory = await readDirectory(await sessionFor(rt, token), workspaceId);
  let checked: WorkspaceEntry | undefined;
  if (directory.entries !== undefined) {
    checked = directory.entries.find((entry) => entry.workspaceRef === workspaceId);
    if (checked === undefined) {
      throw new SentropicPublishError(
        "binding",
        `workspace ${workspaceId} is not one this account can read${claims.tenantId !== undefined ? ` in tenant ${claims.tenantId}` : ""}: ` +
          "run `h2a sentropic workspaces` to list them; nothing was bound",
      );
    }
    if (!checked.publishable) {
      throw new SentropicPublishError(
        "binding",
        `workspace ${workspaceId} (${checked.name}) is not publishable for this account (role ${checked.role}; ` +
          "publishing needs the editor or admin role on an approved membership): nothing was bound",
      );
    }
  }
  const binding: WorkspaceBinding = {
    localWorkspace: p.localWorkspace,
    server: rt.config.server,
    workspaceId,
    ...(claims.tenantId !== undefined ? { tenantId: claims.tenantId } : {}),
    ...(token.subject !== undefined ? { subject: token.subject } : {}),
    boundAt: iso(rt.now()),
  };
  writeBinding(binding, rt.config.stateDir);
  return { binding, checked };
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

/**
 * `tools/list` for the workspace bound here (printable names). A binding made by another account
 * or tenant is refused before any call; a bound workspace for which the server lists no publish
 * tool (the account lost it since the bind) is reported with the way back (`workspaces`).
 */
export async function listPublishTools(
  rt: PublishRuntime,
  localWorkspace: string | undefined,
): Promise<{ tools: string[]; workspaceId: string | undefined }> {
  const token = await ensureFreshToken(rt);
  const binding = readWorkspaceBinding(rt, localWorkspace);
  if (binding !== undefined && !bindingBelongsTo(binding, token)) throw boundByAnotherAccount();
  const tools = await (await sessionFor(rt, token)).listTools(binding?.workspaceId);
  if (binding !== undefined && tools.every((name) => HOST_TOOLS.has(name))) {
    throw new SentropicWorkspaceAccessError(binding.workspaceId, "no_tools");
  }
  return { tools: tools.map(printableToolName), workspaceId: binding?.workspaceId };
}

/** Short form of a local ws: identity for display. */
export function shortWorkspace(id: string): string {
  return id.length > 15 ? `${id.slice(0, 11)}…${id.slice(-4)}` : id;
}

