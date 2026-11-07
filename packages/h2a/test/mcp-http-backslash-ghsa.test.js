import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { serve } from "@hono/node-server";

import { createMcpServer } from "../dist/index.js";
import { createHostedApp } from "../dist/runtime/mcp-http/app.js";
import { FileOAuthStore } from "../dist/runtime/mcp-http/oauth/file-store.js";
import { SingleTenantOAuthProvider } from "../dist/runtime/mcp-http/oauth/single-tenant-provider.js";
import {
  encodedBackslashTargets,
  freePort,
  rawBackslashTargets,
  rawRequest
} from "./helpers/ghsa-backslash-corpus.js";

/**
 * GHSA-jpvv-r467-5p4w — the hosted MCP surface (EVO-12) is served by
 * @hono/node-server: only /mcp is bearer-gated (the OAuth-issued access
 * token with the h2a read scope), while /healthz, /readyz and the OAuth
 * metadata are public. Before 2.1.6 the adapter ran any request-target that
 * failed its strict validation through the WHATWG URL parser: "\" became
 * "/" and ".." segments were collapsed, so `GET /healthz\..\mcp` reached the
 * bearer gate as `/mcp` — path rules written on the public prefix were
 * bypassed by rewriting. The patched adapter refuses raw-backslash targets
 * with 400 before routing.
 *
 * The app is the SAME hosted app the product composes (createHostedApp with
 * a FileOAuthStore-backed single-tenant provider); there is one deliberate
 * deviation: the test serves it on 127.0.0.1 instead of the product's
 * all-interfaces bind (startHostedServer is a k8s pod entrypoint), because
 * the corpus targets the ADAPTER contract, which is bind-independent.
 */

const PUBLIC_PREFIX = "/healthz";
const PROTECTED_TARGETS = ["/mcp", "/.well-known/oauth-authorization-server"];

function hostedApp() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-hosted-ghsa-"));
  const server = createMcpServer({ root: join(dir, ".h2a") });
  const base = new URL("https://h2a.example.com");
  const oauthConfig = {
    issuerUrl: base, publicBaseUrl: base, resourceServerUrl: new URL("/mcp", base),
    resourceMetadataUrl: new URL("/.well-known/oauth-protected-resource/mcp", base).href,
    consentSecret: "s3cr3t", enrollmentEnabled: false, allowedRedirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    accessTokenTtlSeconds: 3600, refreshTokenTtlSeconds: 1209600, authCodeTtlSeconds: 60, nodeEnv: "production"
  };
  const store = new FileOAuthStore(join(dir, "oauth.json"));
  const oauthProvider = new SingleTenantOAuthProvider({ store, ...oauthConfig });
  const app = createHostedApp({ oauthProvider, oauthConfig, h2aMcpServer: server });
  return { dir, app };
}

async function withServedHostedApp(run) {
  const { dir, app } = hostedApp();
  const port = await freePort();
  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
  try {
    await run(port);
  } finally {
    await new Promise((resolve) => { (server).close(() => resolve()); });
    rmSync(dir, { recursive: true, force: true });
  }
}

test("hosted MCP: raw-backslash request targets are refused 400 at the adapter boundary", async () => {
  await withServedHostedApp(async (port) => {
    for (const target of rawBackslashTargets(PUBLIC_PREFIX, PROTECTED_TARGETS)) {
      const response = await rawRequest(port, target, { method: "GET" });
      // On the vulnerable adapter (2.1.5) the WHATWG rewrite routes
      // /healthz\..\mcp straight into the bearer-gated /mcp route (401 with
      // a www-authenticate challenge — proof the protected namespace was
      // reached from behind the public prefix). This expectation was RED
      // there: the rewritten request was routed, not refused.
      assert.equal(response.status, 400, `target ${JSON.stringify(target)} must be refused by the server`);
      assert.ok(
        !response.headers["www-authenticate"],
        `target ${JSON.stringify(target)} must not reach the bearer gate`
      );
    }
  });
});

test("hosted MCP: encoded-backslash traversal never reaches a protected route (404, no content)", async () => {
  await withServedHostedApp(async (port) => {
    for (const target of encodedBackslashTargets(PUBLIC_PREFIX, PROTECTED_TARGETS)) {
      const response = await rawRequest(port, target, { method: "GET" });
      assert.equal(response.status, 404, `target ${JSON.stringify(target)} must not be resolved into a protected route`);
      assert.ok(!response.body.includes("issuer"), `target ${JSON.stringify(target)} must not leak OAuth metadata`);
    }
  });
});

test("hosted MCP: the bearer gate refuses the whole corpus (own path guarding)", async () => {
  await withServedHostedApp(async (port) => {
    const headers = { "content-type": "application/json" };
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const rawTargets = rawBackslashTargets(PUBLIC_PREFIX, ["/mcp"]);
    const encodedTargets = encodedBackslashTargets(PUBLIC_PREFIX, ["/mcp"]);
    for (const target of [...rawTargets, ...encodedTargets]) {
      const response = await rawRequest(port, target, { method: "POST", headers, body });
      // Refused in one of three ways: adapter boundary (400, raw backslash
      // on the patched adapter), bearer gate (401 with a www-authenticate
      // challenge, what the vulnerable adapter's rewrite produced for
      // /healthz\..\mcp), or no route (404). Never an MCP session response.
      assert.ok(
        [400, 401, 404].includes(response.status),
        `tokenless POST ${JSON.stringify(target)} must be refused, got ${response.status}`
      );
      assert.ok(!response.body.includes("jsonrpc"), `POST ${JSON.stringify(target)} must not open an MCP session`);
    }
    // Control path: the bearer gate still fires on the canonical target.
    const canonical = await rawRequest(port, "/mcp", { method: "POST", headers, body });
    assert.equal(canonical.status, 401, "tokenless POST /mcp must be refused 401");
  });
});
