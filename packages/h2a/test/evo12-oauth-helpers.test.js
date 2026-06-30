import assert from "node:assert/strict";
import test from "node:test";

import { randomToken, sha256Hex, timingSafeEqualString } from "../dist/runtime/mcp-http/oauth/crypto.js";
import { allRedirectUrisAllowed, redirectUriAllowed } from "../dist/runtime/mcp-http/oauth/redirect-uri.js";
import { oauthConfigFromEnv, parseOAuthCsv } from "../dist/runtime/mcp-http/oauth/config.js";

test("crypto: tokens are random base64url, sha256 is stable, compare is constant-time-correct", () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.equal(sha256Hex("x"), sha256Hex("x"));
  assert.equal(timingSafeEqualString("secret", "secret"), true);
  assert.equal(timingSafeEqualString("secret", "other"), false);
});

test("redirect-uri: claude.ai callbacks pass when allowlisted; unknown rejected; loopback only off-prod", () => {
  const allowed = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];
  assert.equal(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback", allowed, "production"), true);
  assert.equal(redirectUriAllowed("https://evil.example/cb", allowed, "production"), false);
  // loopback allowed in dev, refused in prod
  assert.equal(redirectUriAllowed("http://localhost:6274/cb", allowed, "development"), true);
  assert.equal(redirectUriAllowed("http://localhost:6274/cb", allowed, "production"), false);
  assert.equal(redirectUriAllowed("not a url", allowed, "development"), false);
  assert.equal(allRedirectUrisAllowed(allowed, allowed, "production"), true);
  assert.equal(allRedirectUrisAllowed([...allowed, "https://evil/cb"], allowed, "production"), false);
});

test("config: derives issuer/resource/metadata URLs + parses redirect CSV", () => {
  assert.deepEqual(parseOAuthCsv(" a , b ,, c "), ["a", "b", "c"]);
  const cfg = oauthConfigFromEnv({
    PUBLIC_BASE_URL: "https://h2a.example.com",
    OAUTH_ISSUER_URL: "https://h2a.example.com",
    OAUTH_ALLOWED_REDIRECT_URIS: "https://claude.ai/api/mcp/auth_callback",
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
    OAUTH_REFRESH_TOKEN_TTL_SECONDS: 1209600,
    OAUTH_AUTH_CODE_TTL_SECONDS: 60,
    NODE_ENV: "production"
  });
  assert.equal(cfg.resourceServerUrl.href, "https://h2a.example.com/mcp");
  assert.equal(cfg.resourceMetadataUrl, "https://h2a.example.com/.well-known/oauth-protected-resource/mcp");
  assert.equal(cfg.allowedRedirectUris[0], "https://claude.ai/api/mcp/auth_callback");
  assert.equal(cfg.nodeEnv, "production");
  assert.equal(cfg.consentSecret, "local-dev-consent"); // default when unset
});
