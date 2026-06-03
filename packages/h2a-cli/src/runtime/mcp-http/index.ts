/**
 * EVO-12 hosted MCP over HTTP + self-AS OAuth (mcp-wave pattern), exposing the
 * h2a read-only tool surface for claude.ai enrollment. Core is dep-free; this
 * lives in @sentropic/h2a-cli.
 */
export {
  H2A_HOSTED_READONLY_TOOLS,
  hostedReadOnlyDescriptors,
  isHostedReadOnlyTool,
  toolTakesPrivateKey
} from "./readonly-allowlist.js";
export { buildHostedMcpServer, dispatchHostedTool } from "./hosted-mcp-server.js";
export { createHostedApp, type HostedAppDeps } from "./app.js";
export {
  startHostedServer,
  buildHostedConfigFromEnv,
  type HostedEnv,
  type HostedConfig,
  type StartedHostedServer
} from "./serve.js";
export { FileOAuthStore } from "./oauth/file-store.js";
export { SingleTenantOAuthProvider } from "./oauth/single-tenant-provider.js";
export { buildOAuthRoutes } from "./oauth/hono-oauth-router.js";
export {
  buildUpstreamAuthorizeUrl,
  exchangeUpstreamCode,
  type H2AUpstreamOidcConfig,
  type UpstreamFetch,
  type UpstreamLogin
} from "./oauth/oidc-rp.js";
export {
  oauthConfigFromEnv,
  H2A_HOSTED_OAUTH_SCOPE,
  type H2AHostedOAuthConfig,
  type H2AHostedOAuthEnv
} from "./oauth/config.js";
