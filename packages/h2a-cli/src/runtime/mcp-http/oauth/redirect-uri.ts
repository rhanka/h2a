/**
 * EVO-12 hosted OAuth — redirect-uri allow checks (ported from mcp-wave;
 * decoupled from the Wave env type — takes a plain nodeEnv string).
 *
 * claude.ai's connector uses fixed redirect URIs
 * (https://claude.ai|claude.com/api/mcp/auth_callback) — those must be in
 * `allowedRedirectUris`. Loopback is allowed only outside production (local dev).
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function redirectUriAllowed(
  redirectUri: string,
  allowedRedirectUris: readonly string[],
  nodeEnv: string
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  if (allowedRedirectUris.includes(parsed.href)) {
    return true;
  }

  if (nodeEnv !== "production" && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  }

  return false;
}

export function allRedirectUrisAllowed(
  redirectUris: readonly string[],
  allowedRedirectUris: readonly string[],
  nodeEnv: string
): boolean {
  return redirectUris.every((uri) => redirectUriAllowed(uri, allowedRedirectUris, nodeEnv));
}
