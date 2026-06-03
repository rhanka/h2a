import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBrokerLogin, createHostedApp, oauthConfigFromEnv } from "../dist/index.js";
import { FileOAuthStore } from "../dist/runtime/mcp-http/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../dist/runtime/mcp-http/oauth/single-tenant-provider.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const BROKER_ENV = {
  PUBLIC_BASE_URL: "https://h2a-mcp.sent-tech.ca",
  OAUTH_ISSUER_URL: "https://h2a-mcp.sent-tech.ca",
  OAUTH_ALLOWED_REDIRECT_URIS: REDIRECT,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: 1209600,
  OAUTH_AUTH_CODE_TTL_SECONDS: 60,
  H2A_BROKER_MODE: "true",
  H2A_UPSTREAM_ISSUER: "https://sentropic.sent-tech.ca",
  H2A_UPSTREAM_AUTHORIZE_URL: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/authorize",
  H2A_UPSTREAM_TOKEN_URL: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/token",
  H2A_UPSTREAM_CLIENT_ID: "h2a-gateway",
  H2A_UPSTREAM_CLIENT_SECRET: "s3cr3t",
  H2A_UPSTREAM_REDIRECT_URI: "https://h2a-mcp.sent-tech.ca/oidc/callback"
};

const mcpStub = { listTools: () => [], callTool: () => ({}), sessions: {}, notifications: {} };

test("broker-mode hosted app: /authorize → 39-auth; /oidc/callback → claude.ai code issued via the provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-brokerapp-"));
  try {
    const store = new FileOAuthStore(join(dir, "oauth.json"));
    await store.load();
    const base = new URL("https://h2a-mcp.sent-tech.ca");
    const provider = new SingleTenantOAuthProvider({
      store,
      nodeEnv: "production",
      issuerUrl: base,
      publicBaseUrl: base,
      resourceServerUrl: new URL("/mcp", base),
      consentSecret: "unused-in-broker",
      allowedRedirectUris: [REDIRECT],
      authCodeTtlSeconds: 60,
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 1209600,
      nowSeconds: () => 1000
    });
    await provider.clientsStore.registerClient({ client_id: "cl1", redirect_uris: [REDIRECT] });

    const oauthConfig = oauthConfigFromEnv(BROKER_ENV);
    assert.equal(oauthConfig.brokerMode, true);
    let n = 0;
    const brokerLogin = createBrokerLogin({
      config: oauthConfig.upstream,
      exchange: async (code) => {
        assert.equal(code, "upcode");
        return { sub: "user-5", idToken: "x.y.z" };
      },
      baseRoot: "/var/lib/h2a/root",
      randomState: () => `st-${++n}`,
      pkce: () => ({ verifier: "v", challenge: "c" }),
      now: () => 1
    });

    const app = createHostedApp({ oauthProvider: provider, oauthConfig, h2aMcpServer: mcpStub, brokerLogin });

    // /authorize → 302 to 39-auth (NOT the consent form)
    const a = await app.request(
      `/authorize?client_id=cl1&redirect_uri=${encodeURIComponent(REDIRECT)}&state=cl&code_challenge=cc`
    );
    assert.equal(a.status, 302);
    const up = new URL(a.headers.get("location"));
    assert.equal(up.origin + up.pathname, oauthConfig.upstream.authorizeUrl);
    const upState = up.searchParams.get("state");
    assert.ok(upState);

    // /oidc/callback → exchange → issue claude.ai code → 302 back to claude.ai
    const cb = await app.request(`/oidc/callback?code=upcode&state=${upState}`);
    assert.equal(cb.status, 302);
    const back = new URL(cb.headers.get("location"));
    assert.equal(back.origin + back.pathname, REDIRECT);
    const code = back.searchParams.get("code");
    assert.ok(code, "claude.ai authorization code issued");
    assert.equal(back.searchParams.get("state"), "cl");

    // the code is a real stored code (issued via the provider)
    const rec = await store.getAuthorizationCode(code, 1000);
    assert.ok(rec, "issued code is persisted in the store");
    assert.equal(rec.clientId, "cl1");

    // /token + /register still fall through to the standard routes (well-known present)
    const wk = await app.request("/.well-known/oauth-authorization-server");
    assert.equal(wk.status, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
