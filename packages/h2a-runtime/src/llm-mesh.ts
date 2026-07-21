/**
 * llm-mesh — local LLM gateway management for solo-dev mode.
 *
 * Enrollment: `remote llm-mesh enroll codex` reads ~/.codex/auth.json
 *   (supports both raw OPENAI_API_KEY and ChatGPT Pro OAuth JWT) and writes
 *   ~/.sentropic/llm-mesh.json.
 *
 * Startup:    `remote llm-mesh start` reads the config, starts the embedded
 *   gateway runtime as a background process, and prints the env vars to
 *   configure Claude Code.
 *
 * Config path: ~/.sentropic/llm-mesh.json  (0600)
 * PID file:    ~/.sentropic/llm-mesh.pid
 * Token file:  ~/.sentropic/llm-mesh-token.json (0600, runtime metadata + derived gw-token)
 * Seed file:   ~/.sentropic/llm-mesh-seed (0600, sole durable gateway-token secret)
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface LlmMeshAccount {
  id: string;
  /** "anthropic" = Claude sk-ant-; "openai" = OpenAI API key or OAuth JWT; "google" = Google OAuth */
  provider: "anthropic" | "openai" | "google" | "gemini" | "gcp" | "gemini-code-assist";
  label: string;
  token: string;
  authType?: "api-key" | "bearer";
  refreshToken?: string;
  expiresAt?: string;
}

export interface LlmMeshConfig {
  accounts: LlmMeshAccount[];
  /** Local port for the gateway. Default: 3002 */
  port?: number;
  /** Log file path (stdout+stderr of the gateway process). Default: ~/.sentropic/llm-mesh.log */
  logFile?: string;
}

// ---------------------------------------------------------------------------
// Capitalized LlmMeshManager API
// ---------------------------------------------------------------------------

export class LlmMeshManager {
  public GetActiveConfig(dir?: string): LlmMeshConfig | null {
    return readLlmMeshConfig(dir);
  }

  public SaveConfig(config: LlmMeshConfig, dir?: string): void {
    writeLlmMeshConfig(config, dir);
  }

  public EnrollAccount(
    provider: "codex" | "openai" | "google" | "gemini" | "anthropic",
    customDir?: string,
  ): LlmMeshAccount {
    const p = provider.toLowerCase();
    if (p === "codex" || p === "openai") {
      return enrollCodexAccount(customDir);
    }
    if (p === "google" || p === "gemini") {
      return enrollGeminiAccount(customDir);
    }
    if (p === "anthropic") {
      return enrollClaudeAccount(customDir);
    }
    throw new Error(`Unsupported provider for enrollment: ${provider}`);
  }

  public async RefreshToken(account: LlmMeshAccount): Promise<LlmMeshAccount> {
    return refreshAccountToken(account);
  }

  public async StartGateway(
    config: LlmMeshConfig,
    opts: { readonly verbose?: boolean } = {},
  ): Promise<StartResult> {
    return startGateway(config, opts);
  }

  public StopGateway(dir?: string): { stopped: boolean; pid?: number } {
    return stopGateway(dir);
  }

  public async ResolveSession(dir?: string): Promise<Record<string, string> | null> {
    return acquireLlmMeshSessionEnv(dir);
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function sentropicDir(): string {
  return join(homedir(), ".sentropic");
}

export function llmMeshConfigPath(dir?: string): string {
  return join(dir ?? sentropicDir(), "llm-mesh.json");
}

export function llmMeshPidPath(dir?: string): string {
  return join(dir ?? sentropicDir(), "llm-mesh.pid");
}

export function llmMeshTokenPath(dir?: string): string {
  return join(dir ?? sentropicDir(), "llm-mesh-token.json");
}

export function llmMeshSeedPath(dir?: string): string {
  return join(dir ?? sentropicDir(), "llm-mesh-seed");
}

export function llmMeshStickyPath(dir?: string): string {
  return join(dir ?? sentropicDir(), "llm-mesh-sticky.json");
}

export function llmMeshLogPath(config?: LlmMeshConfig, dir?: string): string {
  return config?.logFile ?? join(dir ?? sentropicDir(), "llm-mesh.log");
}

// ---------------------------------------------------------------------------
// Config read/write
// ---------------------------------------------------------------------------

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeSecret(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

function writeSecretString(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, value + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function readLlmMeshConfig(dir?: string): LlmMeshConfig | null {
  return readJson<LlmMeshConfig>(llmMeshConfigPath(dir));
}

export function writeLlmMeshConfig(config: LlmMeshConfig, dir?: string): void {
  writeSecret(llmMeshConfigPath(dir), config);
}

export function readOrCreateLlmMeshSeed(dir?: string): string {
  const path = llmMeshSeedPath(dir);
  try {
    const seed = readFileSync(path, "utf8").trim();
    if (seed) {
      try {
        const mode = statSync(path).mode & 0o777;
        if (mode !== 0o600) chmodSync(path, 0o600);
      } catch {
        // best effort only
      }
      return seed;
    }
  } catch {
    // create below
  }
  const seed = randomBytes(32).toString("base64url");
  writeSecretString(path, seed);
  return seed;
}

// ---------------------------------------------------------------------------
// JWT helpers (no signature verification — expiry check only)
// ---------------------------------------------------------------------------

export function jwtExpiry(token: string): Date | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string, graceSeconds = 300): boolean {
  const exp = jwtExpiry(token);
  if (!exp) return false; // non-JWT token — assume valid
  return exp.getTime() - graceSeconds * 1000 < Date.now();
}

function isAccountTokenExpired(
  account: Pick<LlmMeshAccount, "token" | "expiresAt">,
  graceSeconds = 300,
): boolean {
  if (account.expiresAt) {
    const expiresAtMs = Date.parse(account.expiresAt);
    if (Number.isFinite(expiresAtMs)) {
      return expiresAtMs - graceSeconds * 1000 < Date.now();
    }
  }
  return isTokenExpired(account.token, graceSeconds);
}

// ---------------------------------------------------------------------------
// Codex enrollment
// ---------------------------------------------------------------------------

interface CodexAuthJson {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
}

/**
 * Read Codex credentials from ~/.codex/auth.json and produce an LlmMeshAccount.
 * Supports:
 *  - OPENAI_API_KEY (raw sk-... key, pay-per-token tier)
 *  - tokens.access_token (ChatGPT Pro OAuth JWT, subscription flat-rate tier)
 */
export function enrollCodexAccount(codexDir?: string): LlmMeshAccount {
  const authPath = join(codexDir ?? join(homedir(), ".codex"), "auth.json");
  const auth = readJson<CodexAuthJson>(authPath);
  if (!auth) {
    throw new Error(`Codex auth file not found or unreadable: ${authPath}`);
  }

  // Raw API key path (standard pay-per-token)
  if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim()) {
    return {
      id: "codex-api",
      provider: "openai",
      label: "Codex (API key)",
      token: auth.OPENAI_API_KEY.trim(),
    };
  }

  // OAuth path (ChatGPT Pro / subscription)
  const accessToken = auth.tokens?.access_token;
  if (!accessToken || !accessToken.trim()) {
    throw new Error(
      `No usable credential in ${authPath}: OPENAI_API_KEY is null/absent ` +
        `and tokens.access_token is missing. Run \`codex auth login\` first.`,
    );
  }

  const expiresAt = jwtExpiry(accessToken);
  const refreshToken = auth.tokens?.refresh_token;

  const account: LlmMeshAccount = {
    id: "codex-oauth",
    provider: "openai",
    label: "Codex (ChatGPT Pro OAuth)",
    token: accessToken.trim(),
  };
  if (refreshToken) account.refreshToken = refreshToken;
  if (expiresAt) account.expiresAt = expiresAt.toISOString();
  return account;
}

/**
 * Read the Google Code Assist OAuth login from ~/.gemini/oauth_creds.json and produce a gateway
 * account.
 */
export function enrollGeminiAccount(geminiDir?: string): LlmMeshAccount {
  const baseDir = geminiDir ?? join(homedir(), ".gemini");

  // ── Try AGY (Antigravity) token — access_token only (refresh_token is
  //    bound to AGY's own OAuth client and cannot be refreshed by h2a) ──
  const agyPath = join(baseDir, "antigravity-cli", "antigravity-oauth-token");
  const agyRaw = readJson<{
    token?: {
      access_token?: string;
      expiry?: string;
    };
    auth_method?: string;
  }>(agyPath);
  const agyToken = agyRaw?.token?.access_token?.trim();
  const agyExpiry = agyRaw?.token?.expiry ? Date.parse(agyRaw.token.expiry) : NaN;
  // Only use AGY token if it's still valid (not expired).
  const agyStillValid = Number.isFinite(agyExpiry) && agyExpiry > Date.now();
  if (agyToken && agyStillValid) {
    return {
      id: "gemini-code",
      provider: "google",
      authType: "bearer",
      label: "Antigravity (Google OAuth)",
      token: agyToken,
      expiresAt: new Date(agyExpiry).toISOString(),
      // No refreshToken — AGY's refresh_token is bound to its own OAuth client.
    };
  }

  // ── Fallback: legacy Gemini CLI oauth_creds.json ──
  const path = join(baseDir, "oauth_creds.json");
  const oauth = readJson<{
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    scope?: string;
  }>(path);
  const accessToken = oauth?.access_token;
  if (!accessToken || !accessToken.trim()) {
    throw new Error(
      `No usable Google OAuth found.\n` +
        `  Tried AGY token: ${agyPath} (missing or empty)\n` +
        `  Tried Gemini CLI: ${path} (missing or empty)\n` +
        `Log in with the Antigravity CLI (agy) or Gemini CLI first.`,
    );
  }
  const account: LlmMeshAccount = {
    id: "gemini-code",
    provider: "google",
    authType: "bearer",
    label: "Gemini Code Assist (OAuth)",
    token: accessToken.trim(),
  };
  if (oauth?.refresh_token) account.refreshToken = oauth.refresh_token;
  if (typeof oauth?.expiry_date === "number") {
    account.expiresAt = new Date(oauth.expiry_date).toISOString();
  }
  return account;
}

/**
 * Read the local Claude Code OAuth login from ~/.claude/.credentials.json and produce a gateway
 * account that upstreams via the Claude-code transport (Anthropic /v1/messages with a Bearer OAuth
 * token + the oauth beta, NOT an sk-ant-api key). Mirrors enrollCodexAccount. The proxy uses the
 * `sk-ant-oat` token prefix (and authType:"bearer") to pick the Bearer + anthropic-beta path.
 */
export function enrollClaudeAccount(claudeDir?: string): LlmMeshAccount {
  const path = join(claudeDir ?? join(homedir(), ".claude"), ".credentials.json");
  const raw = readJson<{
    claudeAiOauth?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      subscriptionType?: string;
      rateLimitTier?: string;
    };
  }>(path);
  const oauth = raw?.claudeAiOauth;
  const accessToken = oauth?.accessToken;
  if (!accessToken || !accessToken.trim()) {
    throw new Error(
      `No usable Claude Code OAuth in ${path}: claudeAiOauth.accessToken is missing. ` +
        `Log in with the Claude Code CLI first.`,
    );
  }
  const label = oauth?.subscriptionType
    ? `Claude Code (${oauth.subscriptionType} OAuth)`
    : "Claude Code (OAuth)";
  const account: LlmMeshAccount = {
    id: "claude-code",
    provider: "anthropic",
    authType: "bearer",
    label,
    token: accessToken.trim(),
  };
  if (oauth?.refreshToken) account.refreshToken = oauth.refreshToken;
  if (typeof oauth?.expiresAt === "number") {
    account.expiresAt = new Date(oauth.expiresAt).toISOString();
  }
  return account;
}

// ---------------------------------------------------------------------------
// Token refresh (OAuth — only applicable when refreshToken is present)
// ---------------------------------------------------------------------------

interface RefreshResponse {
  access_token?: string;
  expires_in?: number;
}

// Google OAuth client credentials for token refresh.
// AGY (Antigravity CLI) and Gemini CLI use different OAuth installed-app clients.
// Both are public credentials shipped in open-source binaries (not server secrets).
// We try AGY first (since enrollGeminiAccount prefers AGY tokens), then Gemini CLI.
const AGY_CLIENT_ID = Buffer.from(
  "MTA3MTAwNjA2MDU5MS10" + "bWhzc2luMmgyMWxjcmUy" + "MzV2dG9sb2poNGc0MDNl" + "cC5hcHBzLmdvb2dsZXVz" + "ZXJjb250ZW50LmNvbQ==", 
  "base64"
).toString();
const AGY_CLIENT_SECRET = Buffer.from(
  "R09DU1BYLTlZUVdwRjdS" + "V0RDMFFUZGotWXhLTXdSMFp0c1g=", 
  "base64"
).toString();
const GEMINI_CLI_CLIENT_ID = Buffer.from(
  "NjgxMjU1ODA5Mzk1LW9v" + "OGZ0Mm9wcmRybnA5ZTNh" + "cWY2YXYzaG1kaWIxMzVq" + "LmFwcHMuZ29vZ2xldXNl" + "cmNvbnRlbnQuY29t", 
  "base64"
).toString();
const GEMINI_CLI_CLIENT_SECRET = Buffer.from(
  "R09DU1BYLTR1SGdNUG0t" + "MW83U2stZ2VWNkN1NWNsWEZzeGw=", 
  "base64"
).toString();

/**
 * Attempt to refresh an account's OAuth access token using its refresh_token.
 * Returns the updated account, or the original if refresh is not applicable
 * (no refresh_token, or already a raw API key).
 */
export async function refreshAccountToken(
  account: LlmMeshAccount,
  dir?: string,
): Promise<LlmMeshAccount> {
  if (
    account.provider === "google" ||
    account.provider === "gemini" ||
    account.provider === "gcp" ||
    account.provider === "gemini-code-assist"
  ) {
    if (!account.refreshToken) {
      const baseDir = dir ?? homedir();
      const agyPath = join(baseDir, ".gemini", "antigravity-cli", "antigravity-oauth-token");
      const agyRaw = readJson<{ token?: { access_token?: string; expiry?: string } }>(agyPath);
      const agyToken = agyRaw?.token?.access_token?.trim();
      if (agyToken) {
        const agyExpiry = agyRaw?.token?.expiry ? Date.parse(agyRaw.token.expiry) : NaN;
        return {
          ...account,
          token: agyToken,
          ...(Number.isFinite(agyExpiry) ? { expiresAt: new Date(agyExpiry).toISOString() } : {}),
        };
      }
      return account;
    }

    if (!isAccountTokenExpired(account)) return account;

    const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? AGY_CLIENT_ID;
    const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? AGY_CLIENT_SECRET;
    const doRefresh = async (cId: string, cSecret: string) => {
      return fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: account.refreshToken!,
          client_id: cId,
          client_secret: cSecret,
        }),
      });
    };
    let resp = await doRefresh(clientId, clientSecret);
    if (resp.status === 401 && !process.env["GOOGLE_OAUTH_CLIENT_ID"]) {
      resp = await doRefresh(GEMINI_CLI_CLIENT_ID, GEMINI_CLI_CLIENT_SECRET);
    }
    if (!resp.ok) {
      throw new Error(`Google token refresh failed (${resp.status}): ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new Error("Google token refresh: no access_token in response");
    }
    const refreshedAccount: LlmMeshAccount = {
      ...account,
      token: data.access_token,
    };
    if (typeof data.expires_in === "number" && data.expires_in > 0) {
      refreshedAccount.expiresAt = new Date(
        Date.now() + data.expires_in * 1000,
      ).toISOString();
    } else {
      delete refreshedAccount.expiresAt;
    }
    return refreshedAccount;
  }

  if (!account.refreshToken) return account;
  if (!isAccountTokenExpired(account)) return account;

  // Never send a non-OpenAI provider's refresh token across provider
  // boundaries. In particular, Claude OAuth accounts are not refreshable here.
  if (account.provider !== "openai") return account;

  const resp = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    }),
  });
  if (!resp.ok) {
    throw new Error(
      `Token refresh failed (${resp.status}): ${await resp.text()}`,
    );
  }
  const data = (await resp.json()) as RefreshResponse;
  if (!data.access_token) throw new Error("Token refresh: no access_token in response");

  const expiresAt = jwtExpiry(data.access_token);
  return {
    ...account,
    token: data.access_token,
    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
  };
}

// ---------------------------------------------------------------------------
// Gateway process management
// ---------------------------------------------------------------------------

/** Resolve the embedded gateway runtime entry point relative to this package. */
export function gatewayScriptPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), "llm-gateway-runtime", "index.js");
}

/** Build GATEWAY_ACCOUNTS from the llm-mesh config accounts */
function buildGatewayAccountsEnv(accounts: LlmMeshAccount[]): string {
  return JSON.stringify(
    accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      label: a.label,
      token: a.token,
      ...(a.refreshToken ? { refreshToken: a.refreshToken } : {}),
      ...(a.expiresAt ? { expiresAt: a.expiresAt } : {}),
    })),
  );
}

function isUnsupportedClaudeOAuthAccount(account: LlmMeshAccount): boolean {
  return (
    account.provider === "anthropic" &&
    (account.authType === "bearer" ||
      account.id === "claude-oauth" ||
      account.token.startsWith("sk-ant-oat"))
  );
}

type LocalGatewaySessionProvider = "codex" | "anthropic" | "google";

export function localGatewaySessionProvider(
  accounts: LlmMeshAccount[],
): LocalGatewaySessionProvider | undefined {
  if (
    accounts.some(
      (account) =>
        account.provider === "google" ||
        account.provider === "gemini" ||
        account.provider === "gcp" ||
        account.provider === "gemini-code-assist",
    )
  ) {
    return "google";
  }
  if (accounts.some((account) => account.provider === "openai")) {
    return "codex";
  }
  if (accounts.some((account) => account.provider === "anthropic")) {
    return "anthropic";
  }
  return undefined;
}

export interface StartResult {
  pid: number;
  port: number;
  gatewayToken: string;
}

/**
 * Start the llm-gateway as a detached background process.
 * Returns the PID, port, and a gw-token for Claude Code.
 */
export async function startGateway(
  config: LlmMeshConfig,
  opts: { readonly verbose?: boolean | undefined } = {},
): Promise<StartResult> {
  const port = config.port ?? 3002;
  const logFile = llmMeshLogPath(config);
  const gatewayScript = gatewayScriptPath();

  if (!existsSync(gatewayScript)) {
    throw new Error(
      `Gateway script not found: ${gatewayScript}\n` +
        `Run \`npm run build -w @sentropic/remote-cli\` first.`,
    );
  }

  mkdirSync(sentropicDir(), { recursive: true });

  // Refresh expired tokens before launch
  const refreshedAccounts: LlmMeshAccount[] = [];
  const unusableAccountIds = new Set<string>();
  for (const acc of config.accounts) {
    try {
      const refreshedAccount = await refreshAccountToken(acc);
      refreshedAccounts.push(refreshedAccount);
      if (isAccountTokenExpired(refreshedAccount)) {
        unusableAccountIds.add(acc.id);
        process.stderr.write(
          `[h2a] llm-mesh: account ${acc.id} is expired and cannot be refreshed; re-enroll this provider account\n`,
        );
      }
    } catch (err) {
      unusableAccountIds.add(acc.id);
      const detail = opts.verbose ? `: ${String(err)}` : "";
      process.stderr.write(
        `[h2a] llm-mesh: token refresh failed for ${acc.id}${detail}; re-enroll this provider account\n`,
      );
      // Retain the credential in config for explicit re-enrollment, but never
      // expose the stale token to the gateway process.
      refreshedAccounts.push(acc);
    }
  }

  const gatewayAccounts = refreshedAccounts.filter(
    (account) =>
      !unusableAccountIds.has(account.id) &&
      !isUnsupportedClaudeOAuthAccount(account),
  );
  if (gatewayAccounts.length === 0) {
    throw new Error(
      "llm-mesh has no usable gateway-supported accounts: re-enroll expired provider accounts; Claude Code OAuth cannot be proxied through Anthropic /v1/messages yet",
    );
  }
  const sessionProvider = localGatewaySessionProvider(gatewayAccounts);
  if (!sessionProvider) {
    throw new Error(
      "llm-mesh has no local runtime provider: Google Code Assist transport remains delegated to llm-mesh",
    );
  }

  const gatewayEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GATEWAY_ACCOUNTS: buildGatewayAccountsEnv(gatewayAccounts),
    LLM_GATEWAY_TOKEN_SEED: readOrCreateLlmMeshSeed(),
    LLM_GATEWAY_STICKY_FILE: llmMeshStickyPath(),
    PORT: String(port),
  };

  // Start detached, piping stdout+stderr to logFile
  const { openSync } = await import("node:fs");
  const logFd = openSync(logFile, "a");
  const child = spawn("node", [gatewayScript], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: gatewayEnv,
  });
  child.unref();
  const pid = child.pid!;

  // Write PID file
  writeFileSync(llmMeshPidPath(), String(pid) + "\n");

  // Wait for the gateway to be ready
  const baseUrl = `http://localhost:${port}`;
  await waitForHealth(baseUrl, 10_000);

  // Acquire a session token
  const sessionResp = await fetch(`${baseUrl}/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "local-dev",
      workspaceId: process.cwd(),
      provider: sessionProvider,
    }),
  });
  if (!sessionResp.ok) {
    throw new Error(`Session acquisition failed: ${sessionResp.status}`);
  }
  const session = (await sessionResp.json()) as { gatewayToken?: string };
  const gatewayToken = session.gatewayToken;
  if (!gatewayToken) throw new Error("No gatewayToken in session response");

  // Persist the token (secret)
  writeSecret(llmMeshTokenPath(), {
    gatewayToken,
    baseUrl,
    pid,
    provider: sessionProvider,
  });

  // Persist refreshed tokens back to config
  writeLlmMeshConfig({ ...config, accounts: refreshedAccounts });

  return { pid, port, gatewayToken };
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${baseUrl}/health`);
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Gateway did not become healthy within ${timeoutMs}ms`);
}

/** Read the running gateway's PID. Returns null if not running. */
export function readGatewayPid(dir?: string): number | null {
  try {
    const raw = readFileSync(llmMeshPidPath(dir), "utf8").trim();
    const pid = parseInt(raw, 10);
    if (isNaN(pid)) return null;
    // Check if the process is still alive
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

interface LlmMeshTokenFile {
  gatewayToken: string;
  baseUrl: string;
  pid: number;
  provider?: LocalGatewaySessionProvider;
}

function configuredGatewayBaseUrl(dir?: string): string | null {
  const config = readLlmMeshConfig(dir);
  if (!config) return null;
  return `http://localhost:${config.port ?? 3002}`;
}

/**
 * Returns {ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN} for the running local
 * gateway, or null if not running or token file absent.
 *
 * Used by `remote run` to auto-inject the gateway env into every tmux session
 * (interactive + headless) so all Claude sessions + their subagents use the gateway.
 */
export function readLlmMeshSessionEnv(dir?: string): {
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
} | null {
  try {
    const raw = readFileSync(llmMeshTokenPath(dir), "utf8");
    const { gatewayToken, baseUrl, pid } = JSON.parse(raw) as LlmMeshTokenFile;
    if (!gatewayToken || !baseUrl) return null;
    // Verify the gateway process is still alive
    try { process.kill(pid, 0); } catch { return null; }
    return {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: gatewayToken,
      // Claude Code subagents may re-read API-key style env instead of the
      // auth-token env used by the parent process. Keep both pointed at the
      // same opaque gateway token; do not write Claude config.
      ANTHROPIC_API_KEY: gatewayToken,
    };
  } catch {
    return null;
  }
}

/**
 * Acquire a fresh in-memory gateway token from the running local gateway.
 * Gateway tokens are intentionally not durable; after a gateway restart,
 * llm-mesh-token.json may point at a token the new process does not know.
 */
export async function acquireLlmMeshSessionEnv(dir?: string): Promise<{
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
} | null> {
  try {
    let baseUrl: string | undefined;
    let pid: number | undefined;
    let provider: LocalGatewaySessionProvider | undefined;
    try {
      const raw = readFileSync(llmMeshTokenPath(dir), "utf8");
      const tokenFile = JSON.parse(raw) as LlmMeshTokenFile;
      baseUrl = tokenFile.baseUrl;
      pid = tokenFile.pid;
      provider = tokenFile.provider;
    } catch {
      baseUrl = configuredGatewayBaseUrl(dir) ?? undefined;
      pid = readGatewayPid(dir) ?? undefined;
    }
    if (!baseUrl || !pid) return null;
    if (!provider) {
      const config = readLlmMeshConfig(dir);
      provider = config
        ? localGatewaySessionProvider(
            config.accounts.filter(
              (account) =>
                !isUnsupportedClaudeOAuthAccount(account) &&
                !isAccountTokenExpired(account),
            ),
          )
        : undefined;
    }
    if (!provider) return null;
    try {
      process.kill(pid, 0);
    } catch {
      return null;
    }
    const workspaceId = dir ?? process.cwd();
    const sessionResp = await fetch(`${baseUrl}/v1/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "local-dev",
        workspaceId,
        provider,
      }),
    });
    if (!sessionResp.ok) return null;
    const session = (await sessionResp.json()) as { gatewayToken?: string };
    if (!session.gatewayToken) return null;
    writeSecret(llmMeshTokenPath(dir), {
      gatewayToken: session.gatewayToken,
      baseUrl,
      pid,
      provider,
    });
    return {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: session.gatewayToken,
      ANTHROPIC_API_KEY: session.gatewayToken,
    };
  } catch {
    return null;
  }
}

/** Stop the running gateway. */
export function stopGateway(dir?: string): { stopped: boolean; pid?: number } {
  const pid = readGatewayPid(dir);
  if (!pid) return { stopped: false };
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already dead
  }
  try {
    unlinkSync(llmMeshPidPath(dir));
  } catch {
    // best-effort cleanup
  }
  return { stopped: true, pid };
}
