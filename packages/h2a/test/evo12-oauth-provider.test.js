import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileOAuthStore } from "../dist/runtime/mcp-http/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../dist/runtime/mcp-http/oauth/single-tenant-provider.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function freshProvider() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-oauthp-"));
  const store = new FileOAuthStore(join(dir, "oauth.json"));
  const base = new URL("https://h2a.example.com");
  const provider = new SingleTenantOAuthProvider({
    store,
    nodeEnv: "production",
    issuerUrl: base,
    publicBaseUrl: base,
    resourceServerUrl: new URL("/mcp", base),
    consentSecret: "s3cr3t",
    allowedRedirectUris: [REDIRECT],
    authCodeTtlSeconds: 60,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 1209600,
    nowSeconds: () => 1000
  });
  return { dir, store, provider };
}

async function load(store) {
  await store.load();
}

test("DCR: allowlisted redirect registers; non-allowlisted is rejected", async () => {
  const { dir, store, provider } = freshProvider();
  try {
    await load(store);
    const c = await provider.clientsStore.registerClient({ client_id: "c1", redirect_uris: [REDIRECT] });
    assert.equal(c.scope, "h2a:read");
    assert.deepEqual(c.grant_types, ["authorization_code", "refresh_token"]);
    await assert.rejects(
      () => provider.clientsStore.registerClient({ client_id: "c2", redirect_uris: ["https://evil/cb"] }),
      /not allowed/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("authorize: GET -> consent; wrong secret -> 401; correct -> redirect with code; full token flow", async () => {
  const { dir, store, provider } = freshProvider();
  try {
    await load(store);
    const client = await provider.clientsStore.registerClient({ client_id: "c1", redirect_uris: [REDIRECT] });
    const params = { redirectUri: REDIRECT, codeChallenge: "ch", scopes: ["h2a:read"], state: "st" };

    const get = await provider.authorizeRequest(client, params, { method: "GET" });
    assert.equal(get.kind, "consent");
    assert.equal(get.status, 200);
    assert.match(get.html, /Connect to h2a/);

    const bad = await provider.authorizeRequest(client, params, { method: "POST", consentSecret: "nope" });
    assert.equal(bad.status, 401);

    const ok = await provider.authorizeRequest(client, params, { method: "POST", consentSecret: "s3cr3t" });
    assert.equal(ok.kind, "redirect");
    const code = new URL(ok.location).searchParams.get("code");
    assert.ok(code);
    assert.equal(new URL(ok.location).searchParams.get("state"), "st");

    // exchange code -> tokens (single-use)
    const tokens = await provider.exchangeAuthorizationCode(client, code);
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.scope, "h2a:read");
    assert.ok(tokens.access_token && tokens.refresh_token);
    await assert.rejects(() => provider.exchangeAuthorizationCode(client, code), /invalid|used/);

    // verify access token
    const info = await provider.verifyAccessToken(tokens.access_token);
    assert.equal(info.clientId, "c1");
    assert.deepEqual(info.scopes, ["h2a:read"]);

    // refresh -> new tokens, old refresh revoked
    const refreshed = await provider.exchangeRefreshToken(client, tokens.refresh_token);
    assert.ok(refreshed.access_token);
    await assert.rejects(() => provider.exchangeRefreshToken(client, tokens.refresh_token), /invalid|expired/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope enforcement: only h2a:read is accepted", async () => {
  const { dir, store, provider } = freshProvider();
  try {
    await load(store);
    const client = await provider.clientsStore.registerClient({ client_id: "c1", redirect_uris: [REDIRECT] });
    await assert.rejects(
      () =>
        provider.authorizeRequest(
          client,
          { redirectUri: REDIRECT, codeChallenge: "ch", scopes: ["h2a:write"] },
          { method: "POST", consentSecret: "s3cr3t" }
        ),
      /scope/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
