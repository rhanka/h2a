import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileOAuthStore } from "../dist/runtime/mcp-http/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../dist/runtime/mcp-http/oauth/single-tenant-provider.js";
import { buildOAuthRoutes } from "../dist/runtime/mcp-http/oauth/hono-oauth-router.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

async function freshApp() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-router-"));
  const store = new FileOAuthStore(join(dir, "oauth.json"));
  await store.load();
  const base = new URL("https://h2a.example.com");
  const oauth = {
    issuerUrl: base,
    publicBaseUrl: base,
    resourceServerUrl: new URL("/mcp", base),
    resourceMetadataUrl: new URL("/.well-known/oauth-protected-resource/mcp", base).href,
    consentSecret: "s3cr3t",
    allowedRedirectUris: [REDIRECT],
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 1209600,
    authCodeTtlSeconds: 60,
    nodeEnv: "production"
  };
  const provider = new SingleTenantOAuthProvider({ store, ...oauth });
  return { dir, store, provider, app: buildOAuthRoutes(provider, oauth) };
}

test("well-known protected-resource advertises the RS + h2a:read scope (no trailing-slash issuer)", async () => {
  const { dir, app } = await freshApp();
  try {
    const res = await app.request("/.well-known/oauth-protected-resource");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resource, "https://h2a.example.com/mcp");
    assert.deepEqual(body.scopes_supported, ["h2a:read"]);
    assert.deepEqual(body.authorization_servers, ["https://h2a.example.com"]); // no trailing slash
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("well-known authorization-server metadata is served", async () => {
  const { dir, app } = await freshApp();
  try {
    const res = await app.request("/.well-known/oauth-authorization-server");
    assert.equal(res.status, 200);
    const meta = await res.json();
    assert.equal(meta.issuer, "https://h2a.example.com");
    assert.ok(meta.token_endpoint && meta.authorization_endpoint && meta.registration_endpoint);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/authorize: missing client_id -> 400; known client GET -> consent form", async () => {
  const { dir, store, provider, app } = await freshApp();
  try {
    assert.equal((await app.request("/authorize")).status, 400);
    await provider.clientsStore.registerClient({ client_id: "c1", redirect_uris: [REDIRECT] });
    const res = await app.request(
      `/authorize?client_id=c1&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=ch&scope=h2a:read`
    );
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Connect to h2a/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
