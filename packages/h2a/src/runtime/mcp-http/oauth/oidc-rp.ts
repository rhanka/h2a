/**
 * EVO-12 P2 (mode 3, gateway broker) — upstream OIDC Relying Party for 39-auth.
 *
 * The hosted shim keeps the DCR + token surface claude.ai needs (self-AS), but
 * delegates the USER login to 39-auth (the sentropic OIDC IdP, live at
 * `…/api/v1/auth/oauth/authorize`): redirect to its `/authorize`, then exchange
 * the code at `/token` and read the authenticated `sub`. The `sub` is what the
 * gateway maps to a per-user h2a root (multi-tenant).
 *
 * Pure + fetch-injected → unit-testable against a mock IdP. The real client
 * (client_id/secret) is seeded operator-side in 39-auth (no DCR there); that
 * seed is the live-integration point, not a code dependency.
 */
export interface H2AUpstreamOidcConfig {
  /** 39-auth issuer (informational / id_token `iss` check later). */
  readonly issuer: string;
  /** 39-auth authorization endpoint (e.g. …/api/v1/auth/oauth/authorize). */
  readonly authorizeUrl: string;
  /** 39-auth token endpoint (e.g. …/api/v1/auth/oauth/token). */
  readonly tokenUrl: string;
  /** This gateway's seeded client id at 39-auth. */
  readonly clientId: string;
  /** This gateway's client secret (k8s Secret). */
  readonly clientSecret: string;
  /** The gateway's callback URL registered at 39-auth. */
  readonly redirectUri: string;
  /** Scopes to request (openid required for `sub`). */
  readonly scopes: readonly string[];
}

/** Minimal fetch shape (injected for tests; global fetch satisfies it). */
export type UpstreamFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface UpstreamLogin {
  /** The authenticated user — the gateway's per-tenant key. */
  readonly sub: string;
  readonly idToken: string;
  readonly accessToken?: string;
}

/** Build the 39-auth `/authorize` URL to redirect the user to (authorization_code + PKCE). */
export function buildUpstreamAuthorizeUrl(
  config: H2AUpstreamOidcConfig,
  params: { state: string; codeChallenge: string }
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

/** Read `sub` from an id_token payload. The token came from our authenticated
 * server-to-server exchange with 39-auth (TLS + client_secret), so the payload
 * is trusted here; verifying the EdDSA signature against 39-auth JWKS is the
 * hardening step (needs JWKS publicly reachable). */
function subFromIdToken(idToken: string): string {
  const parts = idToken.split(".");
  if (parts.length < 2) throw new Error("malformed id_token");
  let payload: { sub?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: unknown };
  } catch {
    throw new Error("unparseable id_token payload");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("id_token has no sub");
  }
  return payload.sub;
}

/** Exchange an authorization_code (+ PKCE verifier) at 39-auth for the user's `sub`. */
export async function exchangeUpstreamCode(
  config: H2AUpstreamOidcConfig,
  params: { code: string; codeVerifier: string },
  fetchImpl: UpstreamFetch
): Promise<UpstreamLogin> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: params.codeVerifier
  }).toString();
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: `Basic ${basic}`
    },
    body
  });
  if (!res.ok) throw new Error(`upstream token exchange failed: HTTP ${res.status}`);
  const tok = (await res.json()) as { id_token?: unknown; access_token?: unknown };
  if (typeof tok.id_token !== "string") throw new Error("upstream token response missing id_token");
  return {
    sub: subFromIdToken(tok.id_token),
    idToken: tok.id_token,
    ...(typeof tok.access_token === "string" ? { accessToken: tok.access_token } : {})
  };
}
