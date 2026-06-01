/**
 * EVO-12 hosted MCP — env-driven entrypoint. Reads the deploy env, builds the
 * OAuth provider + the read-only h2a MCP surface, and serves the Hono app over
 * HTTP (@hono/node-server). `buildHostedConfigFromEnv` is the testable core.
 */
import { join } from "node:path";
import { serve } from "@hono/node-server";

import { createMcpServer } from "../mcp/index.js";
import type { McpServer } from "../mcp/server.js";
import { createHostedApp } from "./app.js";
import { type H2AHostedOAuthConfig, oauthConfigFromEnv } from "./oauth/config.js";
import { FileOAuthStore } from "./oauth/file-store.js";
import { SingleTenantOAuthProvider } from "./oauth/single-tenant-provider.js";

export interface HostedEnv {
  PUBLIC_BASE_URL?: string;
  OAUTH_ISSUER_URL?: string;
  OAUTH_ALLOWED_REDIRECT_URIS?: string;
  OAUTH_CONSENT_SECRET?: string;
  OAUTH_ACCESS_TOKEN_TTL_SECONDS?: string;
  OAUTH_REFRESH_TOKEN_TTL_SECONDS?: string;
  OAUTH_AUTH_CODE_TTL_SECONDS?: string;
  H2A_HOSTED_ENROLLMENT_ENABLED?: string;
  OAUTH_STORE_PATH?: string;
  H2A_ROOT?: string;
  PORT?: string;
  NODE_ENV?: string;
}

const DEFAULT_CLAUDE_REDIRECTS =
  "https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback";

export interface HostedConfig {
  oauthConfig: H2AHostedOAuthConfig;
  storePath: string;
  root: string;
  port: number;
}

/** Pure: validate + derive the hosted config from env (defaults claude.ai redirects). */
export function buildHostedConfigFromEnv(env: HostedEnv): HostedConfig {
  const publicBaseUrl = env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL is required");
  const root = env.H2A_ROOT ?? join(process.cwd(), ".h2a");
  const oauthConfig = oauthConfigFromEnv({
    PUBLIC_BASE_URL: publicBaseUrl,
    OAUTH_ISSUER_URL: env.OAUTH_ISSUER_URL ?? publicBaseUrl,
    OAUTH_ALLOWED_REDIRECT_URIS: env.OAUTH_ALLOWED_REDIRECT_URIS ?? DEFAULT_CLAUDE_REDIRECTS,
    ...(env.OAUTH_CONSENT_SECRET !== undefined && { OAUTH_CONSENT_SECRET: env.OAUTH_CONSENT_SECRET }),
    ...(env.H2A_HOSTED_ENROLLMENT_ENABLED !== undefined && {
      H2A_HOSTED_ENROLLMENT_ENABLED: env.H2A_HOSTED_ENROLLMENT_ENABLED
    }),
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: Number(env.OAUTH_ACCESS_TOKEN_TTL_SECONDS ?? 3600),
    OAUTH_REFRESH_TOKEN_TTL_SECONDS: Number(env.OAUTH_REFRESH_TOKEN_TTL_SECONDS ?? 1_209_600),
    OAUTH_AUTH_CODE_TTL_SECONDS: Number(env.OAUTH_AUTH_CODE_TTL_SECONDS ?? 60),
    NODE_ENV: env.NODE_ENV ?? "production"
  });
  return {
    oauthConfig,
    storePath: env.OAUTH_STORE_PATH ?? join(root, "oauth-clients.json"),
    root,
    port: Number(env.PORT ?? 8787)
  };
}

export interface StartedHostedServer {
  port: number;
  h2aMcpServer: McpServer;
  stop(): void;
}

export async function startHostedServer(env: HostedEnv = process.env): Promise<StartedHostedServer> {
  const cfg = buildHostedConfigFromEnv(env);
  const store = new FileOAuthStore(cfg.storePath);
  await store.load();
  const oauthProvider = new SingleTenantOAuthProvider({ store, ...cfg.oauthConfig });
  const h2aMcpServer = createMcpServer({ root: cfg.root });
  const app = createHostedApp({ oauthProvider, oauthConfig: cfg.oauthConfig, h2aMcpServer });
  const server = serve({ fetch: app.fetch, port: cfg.port });
  return {
    port: cfg.port,
    h2aMcpServer,
    stop: () => {
      (server as { close?: () => void }).close?.();
    }
  };
}
