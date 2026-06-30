/**
 * EVO-12 hosted MCP HTTP app (Hono) — the self-AS OAuth surface + the
 * bearer-gated Streamable-HTTP MCP endpoint, exposing only the read-only tools.
 * `createHostedApp` is the testable core; the env-driven entrypoint is below.
 */
import { randomUUID } from "node:crypto";
import { StreamableHTTPTransport } from "@hono/mcp";
import { bearerAuth } from "@hono/mcp/auth";
import { type Context, Hono } from "hono";

import type { McpServer } from "../mcp/server.js";
import { buildHostedMcpServer } from "./hosted-mcp-server.js";
import type { BrokerLogin } from "./oauth/broker-login.js";
import { buildBrokerRoutes } from "./oauth/broker-routes.js";
import { H2A_HOSTED_OAUTH_SCOPE, type H2AHostedOAuthConfig } from "./oauth/config.js";
import { buildOAuthRoutes } from "./oauth/hono-oauth-router.js";
import type { SingleTenantOAuthProvider } from "./oauth/single-tenant-provider.js";
import { rootForSub } from "./oauth/tenancy.js";

export interface HostedAppDeps {
  oauthProvider: SingleTenantOAuthProvider;
  oauthConfig: H2AHostedOAuthConfig;
  /** The in-process h2a MCP dispatch (createMcpServer) — its read-only tools are exposed. */
  h2aMcpServer: McpServer;
  /**
   * EVO-12 P2 (mode 3): when `oauthConfig.brokerMode`, the broker login (built
   * from `oauthConfig.upstream`). Its /authorize delegates the user login to
   * 39-auth instead of the consent secret. Omit for single-tenant.
   */
  brokerLogin?: BrokerLogin;
  /**
   * EVO-12 P2 (mode 3, multi-tenant): per-user /mcp serving. When present AND
   * `oauthConfig.brokerMode`, the /mcp handler derives each request's tenant
   * root from the access token's `sub` (rootForSub(baseRoot, sub)) and serves
   * that tenant's h2a dispatch — instead of the single `h2aMcpServer`. Underlying
   * servers are cached per root; a session is pinned to the tenant that opened
   * it (a token for another tenant cannot reuse it). `h2aMcpServer` remains the
   * fallback for any non-broker path.
   */
  tenancy?: {
    baseRoot: string;
    /** Build the in-process h2a dispatch rooted at `root` (e.g. createMcpServer({ root })). */
    createServer: (root: string) => McpServer;
  };
}

interface McpHttpSession {
  transport: StreamableHTTPTransport;
  /** EVO-12 P2: the tenant root this session was opened for (multi-tenant only). */
  tenantRoot?: string;
}

export function createHostedApp(deps: HostedAppDeps): Hono {
  const app = new Hono();
  const wwwAuthenticateHeader = `Bearer error="Unauthorized", error_description="Unauthorized", resource_metadata="${deps.oauthConfig.resourceMetadataUrl}"`;

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", (c) => c.json({ ok: true }));

  // EVO-12 P2 (mode 3): in broker mode, the broker's /authorize + /oidc/callback
  // are registered FIRST (Hono first-match wins) so /authorize delegates to
  // 39-auth; /token, /register, well-known still fall through to buildOAuthRoutes.
  if (deps.oauthConfig.brokerMode && deps.brokerLogin) {
    app.route(
      "/",
      buildBrokerRoutes({
        brokerLogin: deps.brokerLogin,
        // Gate the claude.ai request BEFORE delegating to 39-auth: the broker has
        // no consent secret, so an unregistered redirect_uri / missing PKCE must
        // be rejected here, else an attacker collects the victim's code.
        validateClaudeaiAuthorize: async (claudeai) => {
          if (!claudeai.client_id) return { ok: false, error: "invalid_request", description: "missing client_id" };
          const client = await deps.oauthProvider.clientsStore.getClient(claudeai.client_id);
          if (!client) return { ok: false, error: "invalid_client", description: "unknown client_id" };
          const registered = client.redirect_uris ?? [];
          if (!claudeai.redirect_uri || !registered.includes(claudeai.redirect_uri)) {
            return { ok: false, error: "invalid_request", description: "redirect_uri is not registered for this client" };
          }
          if (claudeai.response_type !== undefined && claudeai.response_type !== "code") {
            return { ok: false, error: "unsupported_response_type", description: "only response_type=code is supported" };
          }
          if (!claudeai.code_challenge || claudeai.code_challenge_method !== "S256") {
            return { ok: false, error: "invalid_request", description: "PKCE code_challenge (S256) is required" };
          }
          return { ok: true };
        },
        issueClaudeaiCode: async (claudeai, ctx) => {
          const client = await deps.oauthProvider.clientsStore.getClient(claudeai.client_id);
          if (!client) throw new Error("unknown client_id");
          // Defense-in-depth: re-check the redirect_uri belongs to the client
          // before minting the code (never trust the carried-through value alone).
          if (!claudeai.redirect_uri || !(client.redirect_uris ?? []).includes(claudeai.redirect_uri)) {
            throw new Error("redirect_uri is not registered for this client");
          }
          // Bind the 39-auth subject to the issued code: it rides code→token so
          // verifyAccessToken restores it and /mcp serves rootForSub(base, sub).
          const code = await deps.oauthProvider.issueAuthorizationCode(client, {
            redirectUri: claudeai.redirect_uri,
            codeChallenge: claudeai.code_challenge ?? "",
            scopes: [H2A_HOSTED_OAUTH_SCOPE],
            ...(claudeai.state ? { state: claudeai.state } : {}),
            ...(ctx.sub ? { sub: ctx.sub } : {})
          });
          const redirect = new URL(claudeai.redirect_uri);
          redirect.searchParams.set("code", code);
          if (claudeai.state) redirect.searchParams.set("state", claudeai.state);
          return redirect.href;
        }
      })
    );
  }

  // OAuth AS + protected-resource metadata (unauthenticated) at the root.
  app.route("/", buildOAuthRoutes(deps.oauthProvider, deps.oauthConfig));

  // Bearer gate for /mcp: valid access token AND the read-only scope.
  const requireAuth = bearerAuth({
    verifyToken: async (token: string): Promise<boolean> => {
      try {
        const info = await deps.oauthProvider.verifyAccessToken(token);
        return info.scopes.includes(H2A_HOSTED_OAUTH_SCOPE);
      } catch {
        return false;
      }
    },
    noAuthenticationHeader: { wwwAuthenticateHeader: () => wwwAuthenticateHeader },
    invalidAuthenticationHeader: { wwwAuthenticateHeader: () => wwwAuthenticateHeader }
  });

  const sessions = new Map<string, McpHttpSession>();

  // EVO-12 P2 (mode 3): per-tenant h2a dispatch, cached by root. The underlying
  // server is reused across sessions/requests of the same tenant; the hosted
  // read-only wrapper is still built per session.
  const multiTenant = Boolean(deps.oauthConfig.brokerMode && deps.tenancy);
  const tenantServers = new Map<string, McpServer>();
  const tenantServerFor = (root: string): McpServer => {
    let server = tenantServers.get(root);
    if (!server) {
      server = deps.tenancy!.createServer(root);
      tenantServers.set(root, server);
    }
    return server;
  };

  /**
   * Resolve the tenant root for a request from its (already bearer-validated)
   * access token. Returns undefined in single-tenant mode. Throws if a broker
   * token carries no `sub` (it is not bound to any tenant → forbidden).
   */
  const resolveTenantRoot = async (c: Context): Promise<string | undefined> => {
    if (!multiTenant) return undefined;
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    const info = await deps.oauthProvider.verifyAccessToken(token);
    const sub = typeof info.extra?.sub === "string" ? info.extra.sub : undefined;
    if (!sub) throw new Error("access token is not bound to a tenant");
    return rootForSub(deps.tenancy!.baseRoot, sub);
  };

  const forbidden = (c: Context) =>
    c.json({ error: "access_denied", error_description: "token is not bound to this tenant" }, 403);

  const mcpHandler = async (c: Context) => {
    let tenantRoot: string | undefined;
    try {
      tenantRoot = await resolveTenantRoot(c);
    } catch {
      return forbidden(c);
    }

    const requestedSessionId = c.req.header("mcp-session-id");
    let session = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

    // A session is pinned to the tenant that opened it: a token for another
    // tenant must not be able to reuse it.
    if (session && session.tenantRoot !== tenantRoot) return forbidden(c);

    if (!session) {
      let created: McpHttpSession | undefined;
      const transport = new StreamableHTTPTransport({
        enableJsonResponse: true,
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          if (created) sessions.set(sessionId, created);
        },
        onsessionclosed: (sessionId) => {
          sessions.delete(sessionId);
        }
      });
      created = { transport, ...(tenantRoot !== undefined && { tenantRoot }) };
      // One SDK server per session, exposing ONLY the read-only allowlist —
      // backed by the tenant's root in multi-tenant mode, else the single server.
      const base = tenantRoot !== undefined ? tenantServerFor(tenantRoot) : deps.h2aMcpServer;
      const server = buildHostedMcpServer(base);
      await server.connect(transport);
      session = created;
    }

    const res = await session.transport.handleRequest(c);
    return res ?? c.body(null, 202);
  };

  // claude.ai connects at the resource-server URL (/mcp); only /mcp is bearer-gated.
  app.all("/mcp", requireAuth, mcpHandler);

  return app;
}
