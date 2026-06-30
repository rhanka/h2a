import assert from "node:assert/strict";
import test from "node:test";

import { oauthConfigFromEnv } from "../dist/index.js";

const BASE = {
  PUBLIC_BASE_URL: "https://h2a-mcp.sent-tech.ca",
  OAUTH_ISSUER_URL: "https://h2a-mcp.sent-tech.ca",
  OAUTH_ALLOWED_REDIRECT_URIS: "https://claude.ai/api/mcp/auth_callback",
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: 1209600,
  OAUTH_AUTH_CODE_TTL_SECONDS: 60
};

const UPSTREAM = {
  H2A_BROKER_MODE: "true",
  H2A_UPSTREAM_ISSUER: "https://sentropic.sent-tech.ca",
  H2A_UPSTREAM_AUTHORIZE_URL: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/authorize",
  H2A_UPSTREAM_TOKEN_URL: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/token",
  H2A_UPSTREAM_CLIENT_ID: "h2a-gateway",
  H2A_UPSTREAM_CLIENT_SECRET: "s3cr3t",
  H2A_UPSTREAM_REDIRECT_URI: "https://h2a-mcp.sent-tech.ca/oidc/callback"
};

test("default (no broker): brokerMode false, no upstream", () => {
  const cfg = oauthConfigFromEnv(BASE);
  assert.equal(cfg.brokerMode, false);
  assert.equal(cfg.upstream, undefined);
});

test("broker mode: parses the seeded 39-auth upstream config", () => {
  const cfg = oauthConfigFromEnv({ ...BASE, ...UPSTREAM });
  assert.equal(cfg.brokerMode, true);
  assert.equal(cfg.upstream.clientId, "h2a-gateway");
  assert.equal(cfg.upstream.tokenUrl, UPSTREAM.H2A_UPSTREAM_TOKEN_URL);
  assert.deepEqual(cfg.upstream.scopes, ["openid", "profile", "email"]); // default
});

test("broker mode missing an upstream field → throws", () => {
  const { H2A_UPSTREAM_CLIENT_SECRET, ...partial } = UPSTREAM;
  assert.throws(() => oauthConfigFromEnv({ ...BASE, ...partial }), /requires H2A_UPSTREAM_\* \(missing clientSecret\)/);
});
