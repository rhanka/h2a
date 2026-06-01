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
import { H2A_HOSTED_OAUTH_SCOPE, type H2AHostedOAuthConfig } from "./oauth/config.js";
import { buildOAuthRoutes } from "./oauth/hono-oauth-router.js";
import type { SingleTenantOAuthProvider } from "./oauth/single-tenant-provider.js";

export interface HostedAppDeps {
  oauthProvider: SingleTenantOAuthProvider;
  oauthConfig: H2AHostedOAuthConfig;
  /** The in-process h2a MCP dispatch (createMcpServer) — its read-only tools are exposed. */
  h2aMcpServer: McpServer;
}

interface McpHttpSession {
  transport: StreamableHTTPTransport;
}

export function createHostedApp(deps: HostedAppDeps): Hono {
  const app = new Hono();
  const wwwAuthenticateHeader = `Bearer error="Unauthorized", error_description="Unauthorized", resource_metadata="${deps.oauthConfig.resourceMetadataUrl}"`;

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", (c) => c.json({ ok: true }));

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
