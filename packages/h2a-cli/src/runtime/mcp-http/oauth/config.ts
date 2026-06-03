/**
 * EVO-12 hosted OAuth — runtime config (ported from mcp-wave; decoupled from
 * the Wave env type — takes a plain input object so it is unit-testable).
 *
 * Scope is read-only (`h2a:read`) — the hosted surface exposes only read tools
 * (DEC-116 key custody; see ../readonly-allowlist).
 */

import type { H2AUpstreamOidcConfig } from "./oidc-rp.js";

export const H2A_HOSTED_OAUTH_SCOPE = "h2a:read";

export interface H2AHostedOAuthEnv {
  PUBLIC_BASE_URL: string;
  OAUTH_ISSUER_URL: string;
  OAUTH_CONSENT_SECRET?: string;
  OAUTH_ALLOWED_REDIRECT_URIS: string;
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: number;
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: number;
  OAUTH_AUTH_CODE_TTL_SECONDS: number;
  H2A_HOSTED_ENROLLMENT_ENABLED?: string;
  NODE_ENV?: string;
  // EVO-12 P2 (mode 3) — broker: delegate user login to 39-auth instead of the
  // single-tenant consent secret. Enabled by H2A_BROKER_MODE=true; the rest are
  // the seeded 39-auth client + endpoints (required when broker mode is on).
  H2A_BROKER_MODE?: string;
  H2A_UPSTREAM_ISSUER?: string;
  H2A_UPSTREAM_AUTHORIZE_URL?: string;
  H2A_UPSTREAM_TOKEN_URL?: string;
  H2A_UPSTREAM_CLIENT_ID?: string;
  H2A_UPSTREAM_CLIENT_SECRET?: string;
  H2A_UPSTREAM_REDIRECT_URI?: string;
  H2A_UPSTREAM_SCOPES?: string;
}

export interface H2AHostedOAuthConfig {
  issuerUrl: URL;
  publicBaseUrl: URL;
  resourceServerUrl: URL;
  resourceMetadataUrl: string;
  consentSecret: string;
  enrollmentEnabled: boolean;
  allowedRedirectUris: readonly string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  authCodeTtlSeconds: number;
  nodeEnv: string;
  /** EVO-12 P2: broker mode (delegate login to 39-auth). */
  brokerMode: boolean;
  /** The seeded 39-auth RP config — present iff broker mode. */
  upstream?: H2AUpstreamOidcConfig;
}

export function parseOAuthCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseHostedEnrollmentEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function oauthConfigFromEnv(env: H2AHostedOAuthEnv): H2AHostedOAuthConfig {
  const publicBaseUrl = new URL(env.PUBLIC_BASE_URL);
  const issuerUrl = new URL(env.OAUTH_ISSUER_URL);
  const enrollmentEnabled = parseHostedEnrollmentEnabled(env.H2A_HOSTED_ENROLLMENT_ENABLED);
  if (enrollmentEnabled && !env.OAUTH_CONSENT_SECRET) {
    throw new Error("OAUTH_CONSENT_SECRET is required when H2A_HOSTED_ENROLLMENT_ENABLED=true");
  }
  const brokerMode = env.H2A_BROKER_MODE === "true";
  const upstream = brokerMode ? upstreamFromEnv(env) : undefined;
  return {
    issuerUrl,
    publicBaseUrl,
    resourceServerUrl: new URL("/mcp", publicBaseUrl),
    resourceMetadataUrl: new URL("/.well-known/oauth-protected-resource/mcp", publicBaseUrl).href,
    consentSecret: env.OAUTH_CONSENT_SECRET ?? "local-dev-consent",
    enrollmentEnabled,
    allowedRedirectUris: parseOAuthCsv(env.OAUTH_ALLOWED_REDIRECT_URIS),
    accessTokenTtlSeconds: env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: env.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    authCodeTtlSeconds: env.OAUTH_AUTH_CODE_TTL_SECONDS,
    nodeEnv: env.NODE_ENV ?? "development",
    brokerMode,
    ...(upstream ? { upstream } : {})
  };
}

/** Parse the seeded 39-auth RP config from env; throws if a field is missing. */
function upstreamFromEnv(env: H2AHostedOAuthEnv): H2AUpstreamOidcConfig {
  const required = {
    issuer: env.H2A_UPSTREAM_ISSUER,
    authorizeUrl: env.H2A_UPSTREAM_AUTHORIZE_URL,
    tokenUrl: env.H2A_UPSTREAM_TOKEN_URL,
    clientId: env.H2A_UPSTREAM_CLIENT_ID,
    clientSecret: env.H2A_UPSTREAM_CLIENT_SECRET,
    redirectUri: env.H2A_UPSTREAM_REDIRECT_URI
  };
  for (const [key, value] of Object.entries(required)) {
    if (!value) throw new Error(`H2A_BROKER_MODE=true requires H2A_UPSTREAM_* (missing ${key})`);
  }
  return {
    issuer: required.issuer as string,
    authorizeUrl: required.authorizeUrl as string,
    tokenUrl: required.tokenUrl as string,
    clientId: required.clientId as string,
    clientSecret: required.clientSecret as string,
    redirectUri: required.redirectUri as string,
    scopes: env.H2A_UPSTREAM_SCOPES ? parseOAuthCsv(env.H2A_UPSTREAM_SCOPES) : ["openid", "profile", "email"]
  };
}
