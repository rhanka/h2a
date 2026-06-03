import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHostedApp, oauthConfigFromEnv, rootForSub, safePathSegment } from "../dist/index.js";
import { FileOAuthStore } from "../dist/runtime/mcp-http/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../dist/runtime/mcp-http/oauth/single-tenant-provider.js";

// EVO-12 P2 (mode 3) finale: the per-user /mcp serving. A real flow — issue a
// code carrying the 39-auth `sub`, exchange it for a token, hit /mcp with that
// token — must serve the tenant root rootForSub(baseRoot, sub), and a token for
// another tenant must NOT be able to reuse a session opened by the first.

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const BASE_ROOT = "/var/lib/h2a/root";
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

function mcpServerStub(root) {
  return { root, listTools: () => [], callTool: () => ({ ok: true }), sessions: {}, notifications: {} };
}

function initBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }
  });
}

function mcpInit(token, sessionId) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return { method: "POST", headers, body: initBody() };
}

/** Build a provider + a hosted app whose tenancy.createServer is spied on. */
async function setup(dir) {
  const store = new FileOAuthStore(join(dir, "oauth.json"));
  await store.load();
  const base = new URL(BROKER_ENV.PUBLIC_BASE_URL);
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
    refreshTokenTtlSeconds: 1209600
  });
  await provider.clientsStore.registerClient({ client_id: "cl1", redirect_uris: [REDIRECT] });

  const createdRoots = [];
  const oauthConfig = oauthConfigFromEnv(BROKER_ENV);
  const app = createHostedApp({
    oauthProvider: provider,
    oauthConfig,
    h2aMcpServer: mcpServerStub("SINGLE"),
    tenancy: {
      baseRoot: BASE_ROOT,
      createServer: (root) => {
        createdRoots.push(root);
        return mcpServerStub(root);
      }
    }
  });
  return { provider, app, createdRoots, store };
}

/** Issue a code carrying `sub`, exchange it → access token. */
async function tokenForSub(provider, sub) {
  const client = await provider.clientsStore.getClient("cl1");
  const code = await provider.issueAuthorizationCode(client, {
    redirectUri: REDIRECT,
    codeChallenge: "cc",
    scopes: [],
    sub
  });
  const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
  return tokens.access_token;
}

test("token minted with sub → verifyAccessToken restores it; /mcp serves rootForSub(base, sub)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-tenant-mcp-"));
  try {
    const { provider, app, createdRoots } = await setup(dir);
    const token = await tokenForSub(provider, "user-42");

    // sub rides code→token and is restored at verify time.
    const info = await provider.verifyAccessToken(token);
    assert.equal(info.extra.sub, "user-42");

    const res = await app.request("/mcp", mcpInit(token));
    assert.ok(res.status < 400, `initialize ok (got ${res.status})`);
    const expectedRoot = rootForSub(BASE_ROOT, "user-42");
    assert.deepEqual(createdRoots, [expectedRoot], "the per-tenant server was built at the user's root");
    assert.ok(expectedRoot.endsWith(safePathSegment("user-42")), "root is under the sanitized tenant segment");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("distinct subs → distinct tenant roots (server cached per root)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-tenant-mcp2-"));
  try {
    const { provider, app, createdRoots } = await setup(dir);
    const t42 = await tokenForSub(provider, "user-42");
    const t99 = await tokenForSub(provider, "user-99");

    await app.request("/mcp", mcpInit(t42));
    await app.request("/mcp", mcpInit(t99));
    // a second new session for user-42 reuses the cached root server (no rebuild)
    await app.request("/mcp", mcpInit(t42));

    assert.deepEqual(
      createdRoots,
      [rootForSub(BASE_ROOT, "user-42"), rootForSub(BASE_ROOT, "user-99")],
      "one server per distinct root; user-42 served from cache the second time"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a token with no sub (non-broker token) is forbidden on the multi-tenant /mcp", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-tenant-mcp3-"));
  try {
    const { provider, app, createdRoots } = await setup(dir);
    const client = await provider.clientsStore.getClient("cl1");
    // a code/token issued WITHOUT a sub (e.g. the legacy single-tenant path)
    const code = await provider.issueAuthorizationCode(client, {
      redirectUri: REDIRECT,
      codeChallenge: "cc",
      scopes: []
    });
    const { access_token } = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);

    const res = await app.request("/mcp", mcpInit(access_token));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "access_denied");
    assert.deepEqual(createdRoots, [], "no tenant server is built for an unbound token");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a session opened by one tenant cannot be reused with another tenant's token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-tenant-mcp4-"));
  try {
    const { provider, app } = await setup(dir);
    const t42 = await tokenForSub(provider, "user-42");
    const t99 = await tokenForSub(provider, "user-99");

    const opened = await app.request("/mcp", mcpInit(t42));
    const sessionId = opened.headers.get("mcp-session-id");
    assert.ok(sessionId, "session id issued");

    // same session id, different tenant's token → forbidden
    const hijack = await app.request("/mcp", mcpInit(t99, sessionId));
    assert.equal(hijack.status, 403);
    assert.equal((await hijack.json()).error, "access_denied");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
