/**
 * EVO-12 hosted OAuth — authorization-server + protected-resource routes
 * (ported from mcp-wave). Standard endpoints (DCR, token+PKCE, revoke,
 * well-known metadata) come from `@hono/mcp/auth`; only `/authorize` is custom
 * (operator consent secret gate, single-tenant). resourceName = "h2a".
 */
import {
  authenticateClient,
  clientRegistrationHandler,
  createOAuthMetadata,
  revokeHandler,
  tokenHandler,
  wellKnownRouter
} from "@hono/mcp/auth";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { OAuthError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { Hono } from "hono";

import { H2A_HOSTED_OAUTH_SCOPE as OAUTH_SCOPE, type H2AHostedOAuthConfig } from "./config.js";
import type { SingleTenantOAuthProvider } from "./single-tenant-provider.js";

export function buildOAuthRoutes(provider: SingleTenantOAuthProvider, oauth: H2AHostedOAuthConfig): Hono {
  const sdkProvider = provider as unknown as OAuthServerProvider;
  const clientsStore = provider.clientsStore as unknown as OAuthRegisteredClientsStore;
  const router = new Hono();

  // RFC 8414: issuer identifier must equal the metadata-URL value (no trailing
  // slash) — a URL object would normalize to a trailing slash that claude.ai rejects.
  const issuer = oauth.issuerUrl.href.replace(/\/+$/, "");

  const oauthMetadata = createOAuthMetadata({
    provider: sdkProvider,
    issuerUrl: issuer,
    baseUrl: oauth.publicBaseUrl,
    scopesSupported: [OAUTH_SCOPE]
  });

  router.route(
    "/",
    wellKnownRouter({
      oauthMetadata,
      resourceServerUrl: oauth.resourceServerUrl,
      scopesSupported: [OAUTH_SCOPE],
      resourceName: "h2a"
    })
  );

  // Also serve PRM at the unsuffixed path (the bearerAuth 401 advertises it there).
  router.get("/.well-known/oauth-protected-resource", (c) =>
    c.json({
      resource: oauth.resourceServerUrl.href,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      scopes_supported: [OAUTH_SCOPE],
      resource_name: "h2a"
    })
  );

  router.post("/register", clientRegistrationHandler({ clientsStore }));
  router.post("/token", authenticateClient({ clientsStore }), tokenHandler(sdkProvider));
  router.post("/revoke", authenticateClient({ clientsStore }), revokeHandler(sdkProvider));

  router.on(["GET", "POST"], "/authorize", async (c) => {
    c.header("Cache-Control", "no-store");
    const raw =
      c.req.method === "POST"
        ? ((await c.req.parseBody()) as Record<string, string>)
        : (c.req.query() as Record<string, string>);

    const clientId = raw["client_id"];
    if (!clientId) {
      return c.json({ error: "invalid_request", error_description: "missing client_id" }, 400);
    }
    const client = await provider.clientsStore.getClient(clientId);
    if (!client) {
      return c.json({ error: "invalid_client", error_description: "unknown client_id" }, 400);
    }

    const redirectUri = raw["redirect_uri"] ?? client.redirect_uris[0] ?? "";
    const scopeRaw = raw["scope"];
    const stateRaw = raw["state"];
    const resourceRaw = raw["resource"];
    const params: AuthorizationParams = {
      redirectUri,
      codeChallenge: raw["code_challenge"] ?? "",
      ...(scopeRaw !== undefined && { scopes: scopeRaw.split(" ") }),
      ...(stateRaw !== undefined && { state: stateRaw }),
      ...(resourceRaw !== undefined && { resource: new URL(resourceRaw) })
    };

    try {
      const consentSecret = raw["consent_secret"];
      const outcome = await provider.authorizeRequest(client, params, {
        method: c.req.method,
        ...(consentSecret !== undefined && { consentSecret })
      });
      if (outcome.kind === "consent") {
        return c.html(outcome.html, outcome.status);
      }
      return c.redirect(outcome.location, 302);
    } catch (e) {
      const err = e instanceof OAuthError ? e : new ServerError("Internal Server Error");
      return c.json(err.toResponseObject(), err instanceof ServerError ? 500 : 400);
    }
  });

  return router;
}
