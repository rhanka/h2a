/**
 * Configuration of the sentropic publish client, by NAME only (environment variables).
 *
 * Only `preprod` exists: it is the one sentropic environment that serves the MCP resource
 * server and the `immo:artifacts:*` scopes today (prod answers 404 on the MCP path). Its
 * authorization server and resource server URLs are public endpoints, not secrets, so they are
 * the defaults; each can be overridden by name. The OAuth client id has NO default: the public
 * CLI client is registered on the sentropic authorization server, and its id is configured
 * here once known. Nothing in this module is a secret, and no secret is ever read from it.
 */

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { serverKey } from "./auth-token.js";
import { SentropicPublishError } from "./publish-errors.js";

export const SENTROPIC_ENVIRONMENTS = {
  preprod: {
    issuer: "https://preprod.auth.sent-tech.ca",
    mcpUrl: "https://preprod.sentropic.sent-tech.ca/api/v1/mcp",
  },
} as const;

export type SentropicEnvironmentName = keyof typeof SENTROPIC_ENVIRONMENTS;

/** Every configuration name the client reads. */
export const SENTROPIC_ENV_VARS = {
  environment: "H2A_SENTROPIC_ENV",
  issuer: "H2A_SENTROPIC_ISSUER",
  mcpUrl: "H2A_SENTROPIC_MCP_URL",
  clientId: "H2A_SENTROPIC_CLIENT_ID",
  redirectPort: "H2A_SENTROPIC_REDIRECT_PORT",
  home: "H2A_SENTROPIC_HOME",
} as const;

export interface SentropicPublishConfig {
  readonly environment: SentropicEnvironmentName;
  /** The authorization server issuer (RFC 8414), without a trailing slash. */
  readonly issuer: string;
  /** The MCP endpoint, which is also the RFC 8707 resource: the access-token audience. */
  readonly mcpUrl: string;
  /** Token-store namespace + anti-exfil key: the resource server origin (serverKey). */
  readonly server: string;
  /** The public OAuth client id, when configured. */
  readonly clientId: string | undefined;
  /** Fixed loopback redirect port, or 0 for an ephemeral one (RFC 8252 §7.3). */
  readonly redirectPort: number;
  /** Where the token store and the bindings live (default ~/.sentropic). */
  readonly stateDir: string;
}

type Env = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

const CLIENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function configError(message: string): SentropicPublishError {
  return new SentropicPublishError("config", message);
}

/**
 * An endpoint that will receive a code, a verifier or a token: https, or plain http only on a
 * loopback host (a local development server); no credentials, query or fragment. `label` names
 * the setting in the error — the value itself is never echoed.
 */
export function assertSafeEndpoint(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw configError(`${label} is not an absolute URL`);
  }
  if (url.username || url.password) throw configError(`${label} must not carry credentials`);
  if (url.hash || url.search) throw configError(`${label} must not carry a query or a fragment`);
  const loopbackHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw configError(`${label} must be an https URL (plain http only on 127.0.0.1/localhost)`);
  }
  return url;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Resolve the configuration from the environment, by name; throws a config error on a bad value. */
export function resolvePublishConfig(env: Env, home: string = homedir()): SentropicPublishConfig {
  const environment = nonEmpty(env[SENTROPIC_ENV_VARS.environment]) ?? "preprod";
  if (environment !== "preprod") {
    throw configError(
      `${SENTROPIC_ENV_VARS.environment}: unknown sentropic environment; only preprod serves the MCP resource server today`,
    );
  }
  const defaults = SENTROPIC_ENVIRONMENTS[environment];

  const issuerUrl = assertSafeEndpoint(
    nonEmpty(env[SENTROPIC_ENV_VARS.issuer]) ?? defaults.issuer,
    SENTROPIC_ENV_VARS.issuer,
  );
  const mcpUrl = assertSafeEndpoint(
    nonEmpty(env[SENTROPIC_ENV_VARS.mcpUrl]) ?? defaults.mcpUrl,
    SENTROPIC_ENV_VARS.mcpUrl,
  );

  const clientId = nonEmpty(env[SENTROPIC_ENV_VARS.clientId]);
  if (clientId !== undefined && !CLIENT_ID.test(clientId)) {
    throw configError(`${SENTROPIC_ENV_VARS.clientId} is not a plain OAuth client id`);
  }

  const rawPort = nonEmpty(env[SENTROPIC_ENV_VARS.redirectPort]);
  let redirectPort = 0;
  if (rawPort !== undefined) {
    redirectPort = /^\d{1,5}$/u.test(rawPort) ? Number(rawPort) : Number.NaN;
    if (!(redirectPort >= 1024 && redirectPort <= 65535)) {
      throw configError(`${SENTROPIC_ENV_VARS.redirectPort} must be a port between 1024 and 65535`);
    }
  }

  const stateDir = nonEmpty(env[SENTROPIC_ENV_VARS.home]) ?? join(home, ".sentropic");
  if (!isAbsolute(stateDir)) throw configError(`${SENTROPIC_ENV_VARS.home} must be an absolute path`);

  const mcp = trimTrailingSlashes(mcpUrl.toString());
  return {
    environment,
    issuer: trimTrailingSlashes(issuerUrl.toString()),
    mcpUrl: mcp,
    server: serverKey(mcp),
    clientId,
    redirectPort,
    stateDir,
  };
}

/** The configured client id, or a config error naming the variable to set. */
export function requireClientId(config: SentropicPublishConfig): string {
  if (config.clientId === undefined) {
    throw configError(
      `no OAuth client is configured for sentropic ${config.environment}: set ${SENTROPIC_ENV_VARS.clientId} ` +
        "to the public client id registered for the h2a CLI on the sentropic authorization server",
    );
  }
  return config.clientId;
}
