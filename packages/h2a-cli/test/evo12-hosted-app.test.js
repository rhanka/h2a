import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMcpServer } from "../dist/index.js";
import { dispatchHostedTool } from "../dist/runtime/mcp-http/hosted-mcp-server.js";
import { createHostedApp } from "../dist/runtime/mcp-http/app.js";
import { FileOAuthStore } from "../dist/runtime/mcp-http/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../dist/runtime/mcp-http/oauth/single-tenant-provider.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function h2aServer() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-hosted-"));
  return { dir, server: createMcpServer({ root: join(dir, ".h2a") }) };
}

test("dispatchHostedTool: a read-only tool runs; a signing tool is refused (never reachable)", () => {
  const { dir, server } = h2aServer();
  try {
    const ok = dispatchHostedTool(server, "h2a_discover_instances", {});
    assert.notEqual(ok.isError, true, "read-only tool should succeed");
    assert.equal(ok.content[0].type, "text");

    const refused = dispatchHostedTool(server, "h2a_sign", { instance: "x", privateKeyPem: "leak" });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /not exposed on the hosted read-only surface/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function hostedApp() {
  const { dir, server } = h2aServer();
  const base = new URL("https://h2a.example.com");
  const oauthConfig = {
    issuerUrl: base, publicBaseUrl: base, resourceServerUrl: new URL("/mcp", base),
    resourceMetadataUrl: new URL("/.well-known/oauth-protected-resource/mcp", base).href,
    consentSecret: "s3cr3t", enrollmentEnabled: false, allowedRedirectUris: [REDIRECT],
    accessTokenTtlSeconds: 3600, refreshTokenTtlSeconds: 1209600, authCodeTtlSeconds: 60, nodeEnv: "production"
  };
  const store = new FileOAuthStore(join(dir, "oauth.json"));
  const oauthProvider = new SingleTenantOAuthProvider({ store, ...oauthConfig });
  return { dir, app: createHostedApp({ oauthProvider, oauthConfig, h2aMcpServer: server }) };
}

test("hosted app: /mcp without bearer -> 401; /healthz -> 200; OAuth metadata mounted", async () => {
  const { dir, app } = hostedApp();
  try {
    const noAuth = await app.request("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(noAuth.status, 401);
    assert.equal(
      noAuth.headers.get("www-authenticate"),
      'Bearer error="Unauthorized", error_description="Unauthorized", resource_metadata="https://h2a.example.com/.well-known/oauth-protected-resource/mcp"'
    );

    assert.equal((await app.request("/healthz")).status, 200);

    const meta = await app.request("/.well-known/oauth-authorization-server");
    assert.equal(meta.status, 200);
    assert.equal((await meta.json()).issuer, "https://h2a.example.com");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hosted app: remote enrollment endpoints are disabled unless explicitly enabled", async () => {
  const { dir, app } = hostedApp();
  try {
    const dcr = await app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [REDIRECT] })
    });
    assert.equal(dcr.status, 403);
    assert.equal((await dcr.json()).error, "enrollment_disabled");

    const authorize = await app.request("/authorize?client_id=client-1");
    assert.equal(authorize.status, 403);
    assert.equal((await authorize.json()).error, "enrollment_disabled");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
