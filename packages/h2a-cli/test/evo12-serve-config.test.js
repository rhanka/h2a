import assert from "node:assert/strict";
import test from "node:test";
import { buildHostedConfigFromEnv } from "../dist/runtime/mcp-http/serve.js";

test("buildHostedConfigFromEnv: requires PUBLIC_BASE_URL, defaults claude.ai redirects + port", () => {
  assert.throws(() => buildHostedConfigFromEnv({}), /PUBLIC_BASE_URL/);
  const cfg = buildHostedConfigFromEnv({ PUBLIC_BASE_URL: "https://h2a.example.com", OAUTH_CONSENT_SECRET: "s" });
  assert.equal(cfg.port, 8787);
  assert.equal(cfg.oauthConfig.resourceServerUrl.href, "https://h2a.example.com/mcp");
  assert.equal(cfg.oauthConfig.enrollmentEnabled, false);
  assert.deepEqual(cfg.oauthConfig.allowedRedirectUris, [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback"
  ]);
});

test("buildHostedConfigFromEnv: hosted enrollment is explicit opt-in and requires an operator secret", () => {
  assert.throws(
    () => buildHostedConfigFromEnv({
      PUBLIC_BASE_URL: "https://h2a.example.com",
      H2A_HOSTED_ENROLLMENT_ENABLED: "true"
    }),
    /OAUTH_CONSENT_SECRET/
  );

  const cfg = buildHostedConfigFromEnv({
    PUBLIC_BASE_URL: "https://h2a.example.com",
    H2A_HOSTED_ENROLLMENT_ENABLED: "true",
    OAUTH_CONSENT_SECRET: "operator-secret"
  });
  assert.equal(cfg.oauthConfig.enrollmentEnabled, true);
  assert.equal(cfg.oauthConfig.consentSecret, "operator-secret");
});
