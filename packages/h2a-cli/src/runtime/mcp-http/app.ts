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
}

interface McpHttpSession {
  transport: StreamableHTTPTransport;
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
        issueClaudeaiCode: async (claudeai, _ctx) => {
          const client = await deps.oauthProvider.clientsStore.getClient(claudeai.client_id);
          if (!client) throw new Error("unknown client_id");
          const code = await deps.oauthProvider.issueAuthorizationCode(client, {
            redirectUri: claudeai.redirect_uri,
            codeChallenge: claudeai.code_challenge ?? "",
            scopes: [H2A_HOSTED_OAUTH_SCOPE],
            ...(claudeai.state ? { state: claudeai.state } : {})
          });
          const redirect = new URL(claudeai.redirect_uri);
          redirect.searchParams.set("code", code);
          if (claudeai.state) redirect.searchParams.set("state", claudeai.state);
          return redirect.href;
          // NOTE: per-user-root /mcp serving (binding _ctx.sub/root through the
          // token → serving that tenant's root) is the seed-gated finale — needs
          // provider token metadata + a live 39-auth client to validate.
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

  const mcpHandler = async (c: Context) => {
    const requestedSessionId = c.req.header("mcp-session-id");
    let session = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

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
      created = { transport };
      // One SDK server per session, exposing ONLY the read-only allowlist.
      const server = buildHostedMcpServer(deps.h2aMcpServer);
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
