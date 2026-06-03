/**
 * EVO-12 hosted MCP — env-driven entrypoint. Reads the deploy env, builds the
 * OAuth provider + the read-only h2a MCP surface, and serves the Hono app over
 * HTTP (@hono/node-server). `buildHostedConfigFromEnv` is the testable core.
 */
import { join } from "node:path";
import { serve } from "@hono/node-server";

import { createMcpServer } from "../mcp/index.js";
import type { McpServer } from "../mcp/server.js";
import { createHostedApp, type HostedAppDeps } from "./app.js";
import { type BrokerLogin, createBrokerLogin } from "./oauth/broker-login.js";
import { type H2AHostedOAuthConfig, oauthConfigFromEnv } from "./oauth/config.js";
import { pkceS256, randomToken } from "./oauth/crypto.js";
import { FileOAuthStore } from "./oauth/file-store.js";
import { exchangeUpstreamCode, type UpstreamFetch } from "./oauth/oidc-rp.js";
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
  // EVO-12 P2 (mode 3, multi-tenant gateway): delegate user login to 39-auth.
  H2A_BROKER_MODE?: string;
  H2A_UPSTREAM_ISSUER?: string;
  H2A_UPSTREAM_AUTHORIZE_URL?: string;
  H2A_UPSTREAM_TOKEN_URL?: string;
  H2A_UPSTREAM_CLIENT_ID?: string;
  H2A_UPSTREAM_CLIENT_SECRET?: string;
  H2A_UPSTREAM_REDIRECT_URI?: string;
  H2A_UPSTREAM_SCOPES?: string;
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
    NODE_ENV: env.NODE_ENV ?? "production",
    // EVO-12 P2 (mode 3): broker passthrough — oauthConfigFromEnv parses these
    // and throws if brokerMode is on but an upstream field is missing.
    ...(env.H2A_BROKER_MODE !== undefined && { H2A_BROKER_MODE: env.H2A_BROKER_MODE }),
    ...(env.H2A_UPSTREAM_ISSUER !== undefined && { H2A_UPSTREAM_ISSUER: env.H2A_UPSTREAM_ISSUER }),
    ...(env.H2A_UPSTREAM_AUTHORIZE_URL !== undefined && {
      H2A_UPSTREAM_AUTHORIZE_URL: env.H2A_UPSTREAM_AUTHORIZE_URL
    }),
    ...(env.H2A_UPSTREAM_TOKEN_URL !== undefined && { H2A_UPSTREAM_TOKEN_URL: env.H2A_UPSTREAM_TOKEN_URL }),
    ...(env.H2A_UPSTREAM_CLIENT_ID !== undefined && { H2A_UPSTREAM_CLIENT_ID: env.H2A_UPSTREAM_CLIENT_ID }),
    ...(env.H2A_UPSTREAM_CLIENT_SECRET !== undefined && {
      H2A_UPSTREAM_CLIENT_SECRET: env.H2A_UPSTREAM_CLIENT_SECRET
    }),
    ...(env.H2A_UPSTREAM_REDIRECT_URI !== undefined && {
      H2A_UPSTREAM_REDIRECT_URI: env.H2A_UPSTREAM_REDIRECT_URI
    }),
    ...(env.H2A_UPSTREAM_SCOPES !== undefined && { H2A_UPSTREAM_SCOPES: env.H2A_UPSTREAM_SCOPES })
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

  // EVO-12 P2 (mode 3, multi-tenant gateway): when broker mode is configured,
  // delegate user login to 39-auth and serve each user their own root.
  let brokerLogin: BrokerLogin | undefined;
  let tenancy: HostedAppDeps["tenancy"] | undefined;
  if (cfg.oauthConfig.brokerMode && cfg.oauthConfig.upstream) {
    const upstream = cfg.oauthConfig.upstream;
    const upstreamFetch: UpstreamFetch = async (url, init) => {
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status, json: () => res.json() };
    };
    brokerLogin = createBrokerLogin({
      config: upstream,
      exchange: (code, codeVerifier) => exchangeUpstreamCode(upstream, { code, codeVerifier }, upstreamFetch),
      baseRoot: cfg.root,
      randomState: () => randomToken(),
      pkce: pkceS256
    });
    tenancy = { baseRoot: cfg.root, createServer: (root) => createMcpServer({ root }) };
  }

  const app = createHostedApp({
    oauthProvider,
    oauthConfig: cfg.oauthConfig,
    h2aMcpServer,
    ...(brokerLogin && { brokerLogin }),
    ...(tenancy && { tenancy })
  });
  const server = serve({ fetch: app.fetch, port: cfg.port });
  return {
    port: cfg.port,
    h2aMcpServer,
    stop: () => {
      (server as { close?: () => void }).close?.();
    }
  };
}
