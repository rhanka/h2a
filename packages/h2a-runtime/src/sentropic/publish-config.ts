/**
 * Configuration of the sentropic publish client: a declarative list of named OAuth/MCP
 * federations in the runtime's user config (`~/.config/sentropic/h2a/config.json`, read-only for
 * agents), plus environment variable overrides and the `--federation <name>` CLI flag.
 *
 * `preprod` remains a built-in default entry so behaviour without a user configuration file is
 * unchanged. Every declared entry is validated with {@link assertSafeEndpoint} (https, or plain
 * http on loopback only; no credentials, query or fragment) before any network call, and
 * authorization-server discovery checks exact issuer matching, endpoints on the issuer origin,
 * and PKCE S256 advertisement.
 *
 * Precedence (selection and per-federation parameters):
 *   1. CLI flag (`--federation <name>`, or `--preprod` alias for `preprod`)
 *   2. Environment variables (`H2A_SENTROPIC_FEDERATION` / `H2A_SENTROPIC_ENV`, and endpoint/client overrides)
 *   3. User config default (`sentropic.defaultFederation` in `config.json`)
 *   4. Built-in default (`preprod`)
 *
 * Nothing in this module is a secret, and no secret is ever read from or written to it.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { federationKey, serverKey, type SentropicFederationScope } from "./auth-token.js";
import { SentropicPublishError } from "./publish-errors.js";

export const SENTROPIC_BUILTIN_FEDERATION = "preprod";

export const SENTROPIC_ENVIRONMENTS = {
  preprod: {
    issuer: "https://preprod.auth.sent-tech.ca",
    mcpUrl: "https://preprod.sentropic.sent-tech.ca/api/v1/mcp",
  },
} as const;

export type SentropicEnvironmentName = keyof typeof SENTROPIC_ENVIRONMENTS;

/** Every environment variable the client reads. */
export const SENTROPIC_ENV_VARS = {
  federation: "H2A_SENTROPIC_FEDERATION",
  environment: "H2A_SENTROPIC_ENV",
  issuer: "H2A_SENTROPIC_ISSUER",
  mcpUrl: "H2A_SENTROPIC_MCP_URL",
  clientId: "H2A_SENTROPIC_CLIENT_ID",
  redirectPort: "H2A_SENTROPIC_REDIRECT_PORT",
  home: "H2A_SENTROPIC_HOME",
  config: "H2A_SENTROPIC_CONFIG",
} as const;

/** One federation entry as written in the user configuration file (read-only for agents). */
export interface SentropicFederationDeclaration {
  readonly name: string;
  /** Authorization server issuer (RFC 8414). */
  readonly issuer: string;
  /** MCP resource server endpoint (RFC 8707 audience). */
  readonly mcpUrl: string;
  /** Public OAuth client id registered on the authorization server. */
  readonly clientId: string;
  /** Optional fixed loopback redirect port (1024..65535); omitted for an ephemeral port. */
  readonly redirectPort?: number | undefined;
  /** Optional human-readable label. */
  readonly label?: string | undefined;
}

/** Validated federation entry in the resolved catalog. */
export interface SentropicFederationEntry {
  readonly name: string;
  readonly issuer: string;
  readonly mcpUrl: string;
  readonly server: string;
  readonly clientId: string | undefined;
  readonly redirectPort: number;
  readonly label: string | undefined;
  readonly builtIn: boolean;
}

/** Declarative `sentropic` section in the runtime's user config (`config.json`). */
export interface SentropicUserConfig {
  readonly defaultFederation?: string | undefined;
  readonly federations?: readonly SentropicFederationDeclaration[] | undefined;
}

/** Validated federation catalog (built-in `preprod` + user-declared federations). */
export interface SentropicFederationCatalog {
  readonly defaultFederation: string;
  readonly federations: readonly SentropicFederationEntry[];
}

export interface SentropicPublishConfig {
  /** Selected federation name (e.g. `preprod` or a declared federation from user config). */
  readonly federation: string;
  /** Alias for `federation` (backward compatibility). */
  readonly environment: string;
  /** Optional human-readable label from the federation declaration. */
  readonly label?: string | undefined;
  /** The authorization server issuer (RFC 8414), without a trailing slash. */
  readonly issuer: string;
  /** The MCP endpoint, which is also the RFC 8707 resource: the access-token audience. */
  readonly mcpUrl: string;
  /** The issuer declared on the federation entry itself (before env overrides). */
  readonly declaredIssuer: string;
  /** The MCP endpoint declared on the federation entry itself (before env overrides). */
  readonly declaredMcpUrl: string;
  /** True when the entry is the built-in `preprod` entry (not declared in user config). */
  readonly builtIn: boolean;
  /** Token-store namespace + anti-exfil key: the resource server origin (serverKey). */
  readonly server: string;
  /** Composite federation key (`federation|issuer|resource`) isolating token-store and binding slots. */
  readonly storeKey: string;
  /** Resource server origins (`serverKey`) declared on other federations in the catalog. */
  readonly otherDeclaredServers?: ReadonlySet<string> | undefined;
  /** Authorization server origins (`serverKey`) declared on other federations in the catalog. */
  readonly otherDeclaredIssuers?: ReadonlySet<string> | undefined;
  /** MCP URLs of other declared federations sharing the same resource-server origin. */
  readonly otherSameOriginMcpUrls?: ReadonlySet<string> | undefined;
  /** The public OAuth client id, when configured. */
  readonly clientId: string | undefined;
  /** Fixed loopback redirect port, or 0 for an ephemeral one (RFC 8252 §7.3). */
  readonly redirectPort: number;
  /** Where the token store and the bindings live (default ~/.sentropic). */
  readonly stateDir: string;
}

export function configAuthScope(
  config: SentropicPublishConfig,
  expectedSubject?: string,
): SentropicFederationScope {
  return {
    federation: config.federation,
    issuer: config.issuer,
    resource: config.mcpUrl,
    ...(config.otherSameOriginMcpUrls !== undefined ? { otherResources: config.otherSameOriginMcpUrls } : {}),
    ...(expectedSubject !== undefined ? { expectedSubject } : {}),
  };
}

export interface ResolvePublishConfigOptions {
  /** Explicit `--federation <name>` CLI flag. */
  readonly federation?: string | undefined;
  /** `--preprod` CLI alias for `--federation preprod`. */
  readonly preprod?: boolean | undefined;
  /** Pre-loaded user config object (for unit tests); read from disk when omitted. */
  readonly userConfig?: unknown;
}

type Env = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

const CLIENT_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const FEDERATION_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const UNSAFE_LABEL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function configError(message: string): SentropicPublishError {
  return new SentropicPublishError("config", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFederationName(name: string): boolean {
  return FEDERATION_NAME.test(name);
}

export function assertFederationName(name: string, setting = "federation name"): string {
  if (!isFederationName(name)) {
    throw configError(`${setting} must be a plain identifier (letters, digits, . _ : -, at most 64 characters)`);
  }
  return name;
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

const BUILTIN_PREPROD_ENTRY: SentropicFederationEntry = Object.freeze({
  name: SENTROPIC_BUILTIN_FEDERATION,
  issuer: SENTROPIC_ENVIRONMENTS.preprod.issuer,
  mcpUrl: SENTROPIC_ENVIRONMENTS.preprod.mcpUrl,
  server: serverKey(SENTROPIC_ENVIRONMENTS.preprod.mcpUrl),
  clientId: undefined,
  redirectPort: 0,
  label: undefined,
  builtIn: true,
});

/** Validate one federation declaration from user config. */
export function validateFederationEntry(raw: unknown, index = 0): SentropicFederationEntry {
  const slot = `federations[${index}]`;
  if (!isRecord(raw)) throw configError(`${slot} must be an object`);
  const rawName = typeof raw.name === "string" ? nonEmpty(raw.name) : undefined;
  if (rawName === undefined) throw configError(`${slot}.name is required`);
  const name = assertFederationName(rawName, `${slot}.name`);

  const prefix = `federation "${name}"`;
  const rawIssuer = typeof raw.issuer === "string" ? nonEmpty(raw.issuer) : undefined;
  if (rawIssuer === undefined) throw configError(`${prefix} issuer is required`);
  const issuerUrl = assertSafeEndpoint(rawIssuer, `${prefix} issuer`);

  const rawMcpUrl = typeof raw.mcpUrl === "string" ? nonEmpty(raw.mcpUrl) : undefined;
  if (rawMcpUrl === undefined) throw configError(`${prefix} mcpUrl is required`);
  const mcpUrl = assertSafeEndpoint(rawMcpUrl, `${prefix} mcpUrl`);

  const rawClientId = typeof raw.clientId === "string" ? nonEmpty(raw.clientId) : undefined;
  if (rawClientId === undefined || !CLIENT_ID.test(rawClientId)) {
    throw configError(`${prefix} clientId is not a plain OAuth client id`);
  }

  let redirectPort = 0;
  if (raw.redirectPort !== undefined) {
    if (
      typeof raw.redirectPort !== "number" ||
      !Number.isInteger(raw.redirectPort) ||
      raw.redirectPort < 1024 ||
      raw.redirectPort > 65535
    ) {
      throw configError(`${prefix} redirectPort must be an integer port between 1024 and 65535`);
    }
    redirectPort = raw.redirectPort;
  }

  let label: string | undefined;
  if (raw.label !== undefined) {
    if (typeof raw.label !== "string") throw configError(`${prefix} label must be a string`);
    const trimmedLabel = raw.label.trim();
    if (!trimmedLabel || trimmedLabel.length > 128 || UNSAFE_LABEL_CHARS.test(trimmedLabel)) {
      throw configError(`${prefix} label must be a non-empty printable string (at most 128 characters, no control/bidi characters)`);
    }
    label = trimmedLabel;
  }

  const mcp = trimTrailingSlashes(mcpUrl.toString());
  return {
    name,
    issuer: trimTrailingSlashes(issuerUrl.toString()),
    mcpUrl: mcp,
    server: serverKey(mcp),
    clientId: rawClientId,
    redirectPort,
    label,
    builtIn: false,
  };
}

/**
 * Parse and validate the declarative federation catalog from the runtime's user config object.
 * Accepts either `{ sentropic: { defaultFederation, federations } }` or top-level
 * `{ defaultFederation, federations }`. Built-in `preprod` remains present unless overridden by
 * an entry named `"preprod"`.
 */
export function parseSentropicUserConfig(raw: unknown): SentropicFederationCatalog {
  if (raw === undefined || raw === null) {
    return { defaultFederation: SENTROPIC_BUILTIN_FEDERATION, federations: [BUILTIN_PREPROD_ENTRY] };
  }
  if (!isRecord(raw)) throw configError("the user configuration must be a JSON object");

  let section: Record<string, unknown> = raw;
  if (raw.sentropic !== undefined) {
    if (!isRecord(raw.sentropic)) throw configError("sentropic configuration in config.json must be an object");
    section = raw.sentropic;
  }

  const declared: SentropicFederationEntry[] = [];
  const seen = new Set<string>();
  if (section.federations !== undefined) {
    if (!Array.isArray(section.federations)) {
      throw configError("sentropic.federations in config.json must be an array");
    }
    for (let i = 0; i < section.federations.length; i++) {
      const entry = validateFederationEntry(section.federations[i], i);
      if (seen.has(entry.name)) {
        throw configError(`duplicate federation name in configuration: ${entry.name}`);
      }
      seen.add(entry.name);
      declared.push(entry);
    }
  }

  const federations: SentropicFederationEntry[] = seen.has(SENTROPIC_BUILTIN_FEDERATION)
    ? declared
    : [BUILTIN_PREPROD_ENTRY, ...declared];

  let defaultFederation = SENTROPIC_BUILTIN_FEDERATION;
  if (section.defaultFederation !== undefined) {
    if (typeof section.defaultFederation !== "string") {
      throw configError("defaultFederation in config.json must be a string");
    }
    const trimmed = nonEmpty(section.defaultFederation);
    if (trimmed === undefined) throw configError("defaultFederation in config.json must not be empty");
    defaultFederation = assertFederationName(trimmed, "defaultFederation");
    if (!federations.some((entry) => entry.name === defaultFederation)) {
      const known = federations.map((entry) => entry.name).join(", ");
      throw configError(`defaultFederation "${defaultFederation}" is not declared (known federations: ${known})`);
    }
  }

  return { defaultFederation, federations };
}

function resolveUserConfigFilePath(env: Env, home?: string): string {
  const explicit = nonEmpty(env[SENTROPIC_ENV_VARS.config]);
  if (explicit !== undefined) {
    if (!isAbsolute(explicit)) throw configError(`${SENTROPIC_ENV_VARS.config} must be an absolute path`);
    return explicit;
  }
  const baseHome = nonEmpty(env.REMOTE_CLI_CONFIG_HOME) ?? home ?? nonEmpty(env[SENTROPIC_ENV_VARS.home]) ?? homedir();
  const sentropicConfigRoot = join(baseHome, ".config", "sentropic");
  const canonicalDir = join(sentropicConfigRoot, "h2a");
  if (existsSync(canonicalDir)) return join(canonicalDir, "config.json");
  const legacyFile = join(sentropicConfigRoot, "remote-cli", "config.json");
  if (existsSync(legacyFile)) return legacyFile;
  return join(canonicalDir, "config.json");
}

/** Read and validate the declarative federation catalog from the user's `config.json`. */
export function readSentropicUserConfig(env: Env, home?: string): SentropicFederationCatalog {
  const path = resolveUserConfigFilePath(env, home);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return parseSentropicUserConfig(undefined);
    }
    throw configError(`the user configuration file is unreadable: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Drop the SyntaxError: V8 quotes the bytes around the parse failure.
    throw configError(`the user configuration file is not valid JSON: ${path}`);
  }
  return parseSentropicUserConfig(parsed);
}

function parseRedirectPortEnv(rawPort: string | undefined): number | undefined {
  if (rawPort === undefined) return undefined;
  const port = /^\d{1,5}$/u.test(rawPort) ? Number(rawPort) : Number.NaN;
  if (!(port >= 1024 && port <= 65535)) {
    throw configError(`${SENTROPIC_ENV_VARS.redirectPort} must be a port between 1024 and 65535`);
  }
  return port;
}

function buildConfigForEntry(
  entry: SentropicFederationEntry,
  catalog: readonly SentropicFederationEntry[],
  stateDir: string,
  env: Env,
  applyEnvOverrides: boolean,
): SentropicPublishConfig {
  const issuerSource = applyEnvOverrides ? (nonEmpty(env[SENTROPIC_ENV_VARS.issuer]) ?? entry.issuer) : entry.issuer;
  const mcpSource = applyEnvOverrides ? (nonEmpty(env[SENTROPIC_ENV_VARS.mcpUrl]) ?? entry.mcpUrl) : entry.mcpUrl;
  const issuerUrl = assertSafeEndpoint(issuerSource, SENTROPIC_ENV_VARS.issuer);
  const mcpUrl = assertSafeEndpoint(mcpSource, SENTROPIC_ENV_VARS.mcpUrl);

  const envClientId = applyEnvOverrides ? nonEmpty(env[SENTROPIC_ENV_VARS.clientId]) : undefined;
  if (envClientId !== undefined && !CLIENT_ID.test(envClientId)) {
    throw configError(`${SENTROPIC_ENV_VARS.clientId} is not a plain OAuth client id`);
  }
  const clientId = envClientId ?? entry.clientId;

  const envPort = applyEnvOverrides ? parseRedirectPortEnv(nonEmpty(env[SENTROPIC_ENV_VARS.redirectPort])) : undefined;
  const redirectPort = envPort ?? entry.redirectPort;

  const normalizedIssuer = trimTrailingSlashes(issuerUrl.toString());
  const mcp = trimTrailingSlashes(mcpUrl.toString());
  const server = serverKey(mcp);

  const otherDeclaredServers = new Set<string>();
  const otherDeclaredIssuers = new Set<string>();
  const otherSameOriginMcpUrls = new Set<string>();
  for (const other of catalog) {
    if (other.name === entry.name) continue;
    otherDeclaredServers.add(other.server);
    otherDeclaredIssuers.add(serverKey(other.issuer));
    if (other.server === server) {
      otherSameOriginMcpUrls.add(other.mcpUrl);
    }
  }

  return {
    federation: entry.name,
    environment: entry.name,
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    issuer: normalizedIssuer,
    mcpUrl: mcp,
    declaredIssuer: entry.issuer,
    declaredMcpUrl: entry.mcpUrl,
    builtIn: entry.builtIn,
    server,
    storeKey: federationKey({ federation: entry.name, issuer: normalizedIssuer, resource: mcp }),
    otherDeclaredServers,
    otherDeclaredIssuers,
    otherSameOriginMcpUrls,
    clientId,
    redirectPort,
    stateDir,
  };
}

export interface ResolvedFederationSet {
  readonly active: SentropicPublishConfig;
  readonly federations: readonly SentropicPublishConfig[];
  readonly defaultFederation: string;
}

/**
 * Resolve the active federation configuration and the full catalog of declared federations.
 * Precedence: CLI flag (`--federation` / `--preprod`) > env (`H2A_SENTROPIC_FEDERATION` /
 * `H2A_SENTROPIC_ENV` and endpoint/client overrides) > user config `defaultFederation` >
 * built-in `preprod`.
 */
export function resolveAllPublishConfigs(
  env: Env,
  home?: string,
  options: ResolvePublishConfigOptions = {},
): ResolvedFederationSet {
  if (options.preprod === true && options.federation !== undefined && nonEmpty(options.federation) !== SENTROPIC_BUILTIN_FEDERATION) {
    throw new SentropicPublishError(
      "usage",
      `--preprod is an alias for --federation ${SENTROPIC_BUILTIN_FEDERATION} and cannot be combined with --federation ${options.federation}`,
    );
  }
  if (options.federation !== undefined && nonEmpty(options.federation) === undefined) {
    throw new SentropicPublishError("usage", "--federation requires a federation name");
  }

  const effectiveHome = home ?? nonEmpty(env.REMOTE_CLI_CONFIG_HOME) ?? homedir();
  const stateDir = nonEmpty(env[SENTROPIC_ENV_VARS.home]) ?? join(effectiveHome, ".sentropic");
  if (!isAbsolute(stateDir)) throw configError(`${SENTROPIC_ENV_VARS.home} must be an absolute path`);

  const catalog =
    options.userConfig !== undefined
      ? parseSentropicUserConfig(options.userConfig)
      : readSentropicUserConfig(env, home);

  const flagName =
    options.federation !== undefined
      ? nonEmpty(options.federation)
      : options.preprod === true
        ? SENTROPIC_BUILTIN_FEDERATION
        : undefined;
  const envName = nonEmpty(env[SENTROPIC_ENV_VARS.federation]) ?? nonEmpty(env[SENTROPIC_ENV_VARS.environment]);
  const selectedName = flagName ?? envName ?? catalog.defaultFederation ?? SENTROPIC_BUILTIN_FEDERATION;

  const selectedEntry = catalog.federations.find((entry) => entry.name === selectedName);
  if (selectedEntry === undefined) {
    const known = catalog.federations.map((entry) => entry.name).join(", ");
    const source =
      flagName !== undefined
        ? "--federation"
        : nonEmpty(env[SENTROPIC_ENV_VARS.federation]) !== undefined
          ? SENTROPIC_ENV_VARS.federation
          : SENTROPIC_ENV_VARS.environment;
    throw configError(`${source}: unknown federation "${selectedName}"; declared federations: ${known}`);
  }

  // Precedence: flag > env > config default > built-in.
  // When a federation is explicitly selected by `--federation <name>` (or `--preprod`), its
  // declared endpoints/clientId take precedence over env overrides directed at another federation.
  // Built-in `preprod` still accepts env endpoint/client overrides when env does not target a
  // different federation (`H2A_SENTROPIC_FEDERATION` / `H2A_SENTROPIC_ENV` unset or `"preprod"`
  // and `defaultFederation` is `"preprod"`).
  const envTargetsSelected =
    envName !== undefined ? envName === selectedEntry.name : catalog.defaultFederation === selectedEntry.name;
  const applyEnvToActive = flagName === undefined || (selectedEntry.builtIn && envTargetsSelected);
  const active = buildConfigForEntry(selectedEntry, catalog.federations, stateDir, env, applyEnvToActive);
  const federations = catalog.federations.map((entry) =>
    entry.name === active.federation ? active : buildConfigForEntry(entry, catalog.federations, stateDir, env, false),
  );

  return {
    active,
    federations,
    defaultFederation: catalog.defaultFederation,
  };
}

/** Resolve the active federation configuration; throws a config/usage error on a bad value. */
export function resolvePublishConfig(
  env: Env,
  home?: string,
  options: ResolvePublishConfigOptions = {},
): SentropicPublishConfig {
  return resolveAllPublishConfigs(env, home, options).active;
}

/**
 * Anti-exfiltration guard for federation endpoints: calls reach only the resource server and
 * issuer declared by the selected federation entry (or an isolated loopback test server for the
 * built-in `preprod` entry). Undeclared endpoints supplied via `H2A_SENTROPIC_MCP_URL` or
 * `H2A_SENTROPIC_ISSUER` are refused before any network call.
 */
export function assertDeclaredResourceServer(config: SentropicPublishConfig): void {
  if (config.mcpUrl === config.declaredMcpUrl && config.issuer === config.declaredIssuer) return;
  let mcpHost = "";
  let issuerHost = "";
  try {
    mcpHost = new URL(config.mcpUrl).hostname;
    issuerHost = new URL(config.issuer).hostname;
  } catch {
    // not a URL: refused below
  }
  const isBuiltInLoopbackTest =
    config.builtIn &&
    (config.mcpUrl === config.declaredMcpUrl || isLoopbackHostname(mcpHost)) &&
    (config.issuer === config.declaredIssuer || isLoopbackHostname(issuerHost)) &&
    !(config.otherDeclaredServers?.has(config.server) ?? false) &&
    !(config.otherDeclaredIssuers?.has(serverKey(config.issuer)) ?? false);
  if (isBuiltInLoopbackTest) return;
  throw new SentropicPublishError(
    "usage",
    `the MCP probe for federation "${config.federation}" is limited to its declared resource server (${config.declaredMcpUrl})` +
      (config.builtIn ? " or a loopback test server" : "") +
      `; ${SENTROPIC_ENV_VARS.mcpUrl} names another one`,
  );
}

/** Backward-compatible alias for {@link assertDeclaredResourceServer}. */
export const assertPreprodResourceServer = assertDeclaredResourceServer;

/** The configured client id, or a config error naming the variable or federation config to set. */
export function requireClientId(config: SentropicPublishConfig): string {
  if (config.clientId === undefined) {
    throw configError(
      `no OAuth client is configured for sentropic ${config.federation}: set ${SENTROPIC_ENV_VARS.clientId} ` +
        "or declare clientId in the federation entry to the public client id registered for the h2a CLI on the authorization server",
    );
  }
  return config.clientId;
}
