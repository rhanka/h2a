/**
 * EVO-12 hosted OAuth — runtime config (ported from mcp-wave; decoupled from
 * the Wave env type — takes a plain input object so it is unit-testable).
 *
 * Scope is read-only (`h2a:read`) — the hosted surface exposes only read tools
 * (DEC-116 key custody; see ../readonly-allowlist).
 */

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
    nodeEnv: env.NODE_ENV ?? "development"
  };
}
