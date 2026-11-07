/**
 * OAuth authorization_code + PKCE S256 for a PUBLIC native client over a loopback redirect
 * (RFC 8252 §7.3), against the sentropic authorization server — plus the refresh_token grant
 * (rotation) and RFC 7009 revocation when the server offers them.
 *
 * What the client checks, and why:
 * - discovery (RFC 8414): the document must name the configured issuer exactly (mix-up), and
 *   every endpoint that receives a code, a verifier or a token must be https (plain http only
 *   on loopback) on the issuer's origin; S256 must be advertised.
 * - the loopback receiver binds 127.0.0.1 only, on an ephemeral port unless one is configured,
 *   serves exactly ONE callback on `/callback` for the exact `Host: 127.0.0.1:<port>` (another
 *   path or a rebound Host is a 404 that consumes nothing), then closes. On that callback it
 *   checks the RFC 9207 `iss` (required when the server advertises it), then `state` in
 *   constant time, and only then reads `code` or `error` — an error is reported by its CODE,
 *   never by its description.
 * - the code is exchanged at once (the sentropic code lives 60 s) with the same redirect_uri,
 *   the verifier, and the RFC 8707 resource (sealed at authorize time server-side).
 * - the id_token is required (openid is always requested) and its iss, aud, exp, sub and the
 *   NONCE of this login are checked. Its signature is not verified: OIDC Core §3.1.3.7 lets a
 *   code-flow client rely on the TLS connection to the token endpoint instead.
 *
 * Nothing here ever logs or puts into an error a code, a verifier, a token, a response body or
 * an error_description (see publish-errors.ts).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { verifyCallbackState } from "./enroll-flow.js";
import { assertSafeEndpoint } from "./publish-config.js";
import { SentropicPublishError, safeErrorCode, type SentropicPublishErrorCode } from "./publish-errors.js";

export type FetchLike = typeof fetch;

/** The scopes the publish client asks for. openid carries the nonce check (id_token). */
export const PUBLISH_SCOPES: readonly string[] = Object.freeze([
  "openid",
  "email",
  "immo:artifacts:read",
  "immo:artifacts:write",
  "mcp:discover",
  "mcp:resources:read",
  "mcp:tools:invoke",
]);

export interface AuthorizationServerMetadata {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string | undefined;
  readonly scopesSupported: readonly string[];
  readonly grantTypesSupported: readonly string[];
  /** RFC 9207: the server puts `iss` on every authorization response. */
  readonly issParameterSupported: boolean;
}

const MAX_BODY_BYTES = 1 << 20;
const HTTP_TIMEOUT_MS = 30_000;
const CLOCK_SKEW_SECONDS = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Read a body as text, at most `limit` bytes; undefined when larger or unreadable. Never throws. */
export async function readBoundedText(res: Response, limit = MAX_BODY_BYTES): Promise<string | undefined> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A JSON object body, or undefined. The parse error (which quotes bytes) is swallowed. */
export async function readJsonObject(res: Response): Promise<Record<string, unknown> | undefined> {
  const text = await readBoundedText(res);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * fetch without following redirects (a redirected POST could carry a code or a token to
 * another host), with a timeout, and with a failure that names the step only — a network
 * error message can quote the URL, and the URL is not ours to print.
 */
export async function sendRequest(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  step: string,
  code: SentropicPublishErrorCode,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  } catch {
    throw new SentropicPublishError(code, `${step}: the request failed (network error or timeout)`);
  }
}

/** RFC 8414 §3.1: the well-known segment goes between the host and the issuer's path. */
export function discoveryUrl(issuer: string): string {
  const u = new URL(issuer);
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/u, "");
  return `${u.origin}/.well-known/oauth-authorization-server${path}`;
}

function endpointOnIssuerOrigin(value: unknown, issuerOrigin: string, name: string): string {
  if (typeof value !== "string") {
    throw new SentropicPublishError("discovery", `the authorization server metadata has no ${name}`);
  }
  let url: URL;
  try {
    url = assertSafeEndpoint(value, `the ${name} of the authorization server`);
  } catch {
    throw new SentropicPublishError(
      "discovery",
      `the ${name} of the authorization server is not an https URL without query or fragment`,
    );
  }
  if (url.origin !== issuerOrigin) {
    throw new SentropicPublishError("discovery", `the ${name} is not on the issuer's origin ${issuerOrigin}; refusing it`);
  }
  return url.toString();
}

/** Fetch and validate the authorization server metadata of `issuer`. */
export async function discoverAuthorizationServer(
  issuer: string,
  fetchImpl: FetchLike,
): Promise<AuthorizationServerMetadata> {
  const url = discoveryUrl(issuer);
  const res = await sendRequest(fetchImpl, url, { headers: { accept: "application/json" } }, "authorization server discovery", "discovery");
  const doc = res.ok ? await readJsonObject(res) : undefined;
  if (!res.ok || doc === undefined) {
    throw new SentropicPublishError("discovery", `authorization server discovery failed (HTTP ${res.status}) at ${url}`);
  }
  if (doc.issuer !== issuer) {
    throw new SentropicPublishError(
      "discovery",
      `the discovery document at ${url} names another issuer than ${issuer}; refusing it (RFC 8414 §3.3)`,
    );
  }
  const origin = new URL(issuer).origin;
  const challengeMethods = stringArray(doc.code_challenge_methods_supported);
  if (!challengeMethods.includes("S256")) {
    throw new SentropicPublishError("discovery", "the authorization server does not advertise PKCE S256");
  }
  const responseTypes = doc.response_types_supported === undefined ? ["code"] : stringArray(doc.response_types_supported);
  if (!responseTypes.includes("code")) {
    throw new SentropicPublishError("discovery", "the authorization server does not offer the authorization code flow");
  }
  return {
    issuer,
    authorizationEndpoint: endpointOnIssuerOrigin(doc.authorization_endpoint, origin, "authorization_endpoint"),
    tokenEndpoint: endpointOnIssuerOrigin(doc.token_endpoint, origin, "token_endpoint"),
    revocationEndpoint:
      doc.revocation_endpoint === undefined
        ? undefined
        : endpointOnIssuerOrigin(doc.revocation_endpoint, origin, "revocation_endpoint"),
    scopesSupported: stringArray(doc.scopes_supported),
    grantTypesSupported:
      doc.grant_types_supported === undefined ? ["authorization_code", "implicit"] : stringArray(doc.grant_types_supported),
    issParameterSupported: doc.authorization_response_iss_parameter_supported === true,
  };
}

/** The scopes of a login: the publish set, plus offline_access only when refresh is offered. */
export function requestedScopes(meta: AuthorizationServerMetadata, opts: { refresh: boolean }): string[] {
  const offline =
    opts.refresh && meta.scopesSupported.includes("offline_access") && meta.grantTypesSupported.includes("refresh_token");
  return [...PUBLISH_SCOPES, ...(offline ? ["offline_access"] : [])];
}

// ---- loopback receiver ------------------------------------------------------------------------

export interface LoopbackReceiver {
  /** `http://127.0.0.1:<port>/callback` — the redirect_uri of this login. */
  readonly redirectUri: string;
  /** The authorization code of the one callback this receiver serves. */
  readonly code: Promise<string>;
  close(): Promise<void>;
}

export interface LoopbackOptions {
  /** 0 = ephemeral. */
  readonly port: number;
  readonly state: string;
  readonly issuer: string;
  readonly requireIss: boolean;
  readonly timeoutMs: number;
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  connection: "close",
} as const;

function page(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, PAGE_HEADERS);
  res.end(`<!doctype html><meta charset="utf-8"><title>h2a</title><p>${text}</p>\n`);
}

/** Start the loopback receiver for one login. Binds 127.0.0.1 only. */
export async function startLoopbackReceiver(opts: LoopbackOptions): Promise<LoopbackReceiver> {
  let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined;
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // The login awaits `code` only after the browser is pointed at the server; a rejection that
  // lands first (a fast timeout) must not surface as an unhandled rejection meanwhile.
  code.catch(() => undefined);

  let served = false;
  let port = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (served) return page(res, 410, "h2a: this sign-in is already finished.");
    if (req.headers.host !== `127.0.0.1:${port}`) return page(res, 404, "Not found.");
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method !== "GET" || url.pathname !== "/callback") return page(res, 404, "Not found.");

    // This IS the callback: it is served once, whatever its outcome.
    served = true;
    const fail = (message: string): void => {
      page(res, 400, "h2a: sign-in refused. Return to the terminal for the reason.");
      settle?.reject(new SentropicPublishError("callback", message));
      void stop();
    };
    const params = url.searchParams;
    const iss = params.get("iss");
    if (iss !== null && iss !== opts.issuer) {
      return fail(`the authorization response comes from another issuer than ${opts.issuer} (RFC 9207 mix-up); nothing was exchanged`);
    }
    if (iss === null && opts.requireIss) {
      return fail("the authorization response carries no iss although the server advertises it (RFC 9207); nothing was exchanged");
    }
    if (!verifyCallbackState(opts.state, params.get("state") ?? "")) {
      return fail("the authorization response state does not match this login (forged or stale); nothing was exchanged");
    }
    const error = params.get("error");
    if (error !== null) {
      return fail(`the authorization server refused the sign-in (${safeErrorCode(error)})`);
    }
    const value = params.get("code");
    if (!value) return fail("the authorization response carries no code");
    page(res, 200, "h2a: sign-in complete. You can close this tab and return to the terminal.");
    settle?.resolve(value);
    void stop();
  });

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
  };

  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(new SentropicPublishError("callback", `cannot listen on 127.0.0.1:${opts.port} for the sign-in redirect`)),
    );
    server.listen(opts.port, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  timer = setTimeout(() => {
    if (served) return;
    served = true;
    settle?.reject(
      new SentropicPublishError(
        "timeout",
        `no sign-in response arrived on ${redirectUri} within ${Math.round(opts.timeoutMs / 1000)} s; ` +
          "if the browser showed an authorization server error, the redirect URI is probably not registered " +
          "for this client (it must accept http://127.0.0.1:<port>/callback)",
      ),
    );
    void stop();
  }, opts.timeoutMs);
  timer.unref();

  return { redirectUri, code, close: stop };
}

// ---- token endpoint ---------------------------------------------------------------------------

export interface TokenSet {
  readonly accessToken: string;
  readonly expiresInSeconds: number | undefined;
  readonly refreshToken: string | undefined;
  readonly idToken: string | undefined;
  readonly scope: string | undefined;
}

/** A refusal by the token endpoint: the HTTP status and the OAuth error CODE only. */
export class TokenEndpointError extends SentropicPublishError {
  constructor(readonly status: number, readonly oauthError: string) {
    super("token", `the token endpoint refused the request (HTTP ${status}, ${oauthError})`);
    this.name = "TokenEndpointError";
  }

  /** The grant itself is dead (invalid_grant, revoked, reuse detected…), as opposed to an outage. */
  get refused(): boolean {
    return this.status === 400 || this.status === 401;
  }
}

async function tokenRequest(fetchImpl: FetchLike, endpoint: string, form: URLSearchParams): Promise<TokenSet> {
  const res = await sendRequest(
    fetchImpl,
    endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form.toString(),
    },
    "token endpoint",
    "token",
  );
  const doc = await readJsonObject(res);
  if (!res.ok) throw new TokenEndpointError(res.status, safeErrorCode(doc?.error));
  if (doc === undefined) throw new SentropicPublishError("token", "the token endpoint returned an unreadable response; nothing was stored");
  const accessToken = doc.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new SentropicPublishError("token", "the token endpoint response carries no access_token; nothing was stored");
  }
  const tokenType = typeof doc.token_type === "string" ? doc.token_type.toLowerCase() : "";
  if (tokenType !== "bearer") {
    throw new SentropicPublishError(
      "token",
      `the token endpoint issued a ${tokenType === "dpop" ? "DPoP-bound" : "non-Bearer"} token; this client sends Bearer tokens only (the client must not be registered DPoP-bound)`,
    );
  }
  const expiresIn =
    typeof doc.expires_in === "number" && Number.isFinite(doc.expires_in) && doc.expires_in > 0 ? doc.expires_in : undefined;
  return {
    accessToken,
    expiresInSeconds: expiresIn,
    refreshToken: typeof doc.refresh_token === "string" && doc.refresh_token.length > 0 ? doc.refresh_token : undefined,
    idToken: typeof doc.id_token === "string" && doc.id_token.length > 0 ? doc.id_token : undefined,
    scope: typeof doc.scope === "string" ? doc.scope : undefined,
  };
}

export function exchangeAuthorizationCode(
  fetchImpl: FetchLike,
  meta: AuthorizationServerMetadata,
  p: { clientId: string; code: string; redirectUri: string; verifier: string; resource: string },
): Promise<TokenSet> {
  return tokenRequest(
    fetchImpl,
    meta.tokenEndpoint,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
      code_verifier: p.verifier,
      resource: p.resource,
    }),
  );
}

export function refreshTokenGrant(
  fetchImpl: FetchLike,
  meta: AuthorizationServerMetadata,
  p: { clientId: string; refreshToken: string; resource: string },
): Promise<TokenSet> {
  return tokenRequest(
    fetchImpl,
    meta.tokenEndpoint,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: p.refreshToken,
      client_id: p.clientId,
      resource: p.resource,
    }),
  );
}

/** RFC 7009 revocation of one token. Throws on a non-2xx answer (status only). */
export async function revokeToken(
  fetchImpl: FetchLike,
  endpoint: string,
  p: { clientId: string | undefined; token: string; hint: "access_token" | "refresh_token" },
): Promise<void> {
  const form = new URLSearchParams({ token: p.token, token_type_hint: p.hint });
  if (p.clientId !== undefined) form.set("client_id", p.clientId);
  const res = await sendRequest(
    fetchImpl,
    endpoint,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() },
    "token revocation",
    "token",
  );
  await readBoundedText(res);
  if (!res.ok) throw new SentropicPublishError("token", `the revocation endpoint answered HTTP ${res.status}`);
}

// ---- JWT claims (read, never trusted for authorization) --------------------------------------

/** The payload of a compact JWS, or undefined. Never throws, never quotes the token. */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface IdTokenClaims {
  readonly subject: string;
  readonly tenantId: string | undefined;
  readonly email: string | undefined;
}

function idTokenError(message: string): SentropicPublishError {
  return new SentropicPublishError("id_token", `${message}; nothing was stored`);
}

/** Check the id_token of THIS login: iss, aud, azp, exp, sub, and the nonce. */
export function validateIdToken(
  idToken: string,
  expected: { issuer: string; clientId: string; nonce: string; now: number },
): IdTokenClaims {
  const claims = decodeJwtPayload(idToken);
  if (claims === undefined) throw idTokenError("the id_token is not a readable JWT");
  if (claims.iss !== expected.issuer) throw idTokenError("the id_token was issued by another issuer");
  const audiences = typeof claims.aud === "string" ? [claims.aud] : stringArray(claims.aud);
  if (!audiences.includes(expected.clientId)) throw idTokenError("the id_token is not addressed to this client");
  if (claims.azp !== undefined && claims.azp !== expected.clientId) throw idTokenError("the id_token names another authorized party");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= expected.now / 1000) {
    throw idTokenError("the id_token is expired");
  }
  if (typeof claims.nonce !== "string" || !verifyCallbackState(expected.nonce, claims.nonce)) {
    throw idTokenError("the id_token nonce does not match this login (replayed or mixed-up response)");
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) throw idTokenError("the id_token carries no subject");
  return {
    subject: claims.sub,
    tenantId: typeof claims.tid === "string" && claims.tid.length > 0 ? claims.tid : undefined,
    email: typeof claims.email === "string" && claims.email.length > 0 ? claims.email : undefined,
  };
}

/**
 * Absolute expiry in ms: expires_in relative to OUR clock (RFC 6749 §5.1 — relative on purpose,
 * immune to clock skew), else the access token's `exp`. Undefined when neither is known: the
 * caller refuses such a token rather than storing one that would read as fresh forever.
 */
export function expiryOf(tokens: TokenSet, now: number): number | undefined {
  if (tokens.expiresInSeconds !== undefined) return now + tokens.expiresInSeconds * 1000;
  const exp = decodeJwtPayload(tokens.accessToken)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
}
