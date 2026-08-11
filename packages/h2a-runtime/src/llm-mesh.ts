/**
 * llm-mesh — local LLM gateway management for solo-dev mode.
 *
 * Enrollment: `h2a llm-mesh enroll cloud-code|codex` delegates OAuth and
 *   account persistence entirely to the sentropic-owned facade.
 *
 * Startup:    `h2a llm-mesh start` reads public host config and starts the
 *   embedded gateway runtime as a background process. Callers acquire an
 *   opaque process-local bearer without printing it.
 *
 * Config path: ~/.sentropic/llm-mesh.json  (0600, public metadata only)
 * PID file:    ~/.sentropic/llm-mesh.pid
 * Runtime file: ~/.sentropic/llm-mesh-token.json (0600, base URL + PID only)
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createLlmMeshFacade,
  type LlmMeshFacade,
} from "@sentropic/llm-mesh/facade";
import {
  validateLlmMeshRoutingConfig,
  type LlmMeshRoutingConfig,
} from "./llm-routing-config.js";

const ANTHROPIC_GATEWAY_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
] as const;

/** Temporarily replace the Anthropic gateway lane and return an exact restorer. */
export function replaceAnthropicGatewayEnvironment(
  env: NodeJS.ProcessEnv,
  replacement?: Partial<Record<(typeof ANTHROPIC_GATEWAY_ENV_KEYS)[number], string>>,
): () => void {
  const previous = new Map(
    ANTHROPIC_GATEWAY_ENV_KEYS.map((key) => [key, env[key]] as const),
  );
  for (const key of ANTHROPIC_GATEWAY_ENV_KEYS) delete env[key];
  for (const [key, value] of Object.entries(replacement ?? {})) {
    if (value !== undefined) env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  };
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface LlmMeshConfig {
  /** Deprecated migration sinks. Never returned or persisted. */
  accounts?: readonly unknown[];
  meshAccounts?: readonly unknown[];
  /** Local port for the gateway. Default: 3002 */
  port?: number;
  /** Log file path (stdout+stderr of the gateway process). Default: ~/.sentropic/llm-mesh.log */
  logFile?: string;
  /** Public host routing policy. Provider/model knowledge remains in llm-mesh. */
  routing?: LlmMeshRoutingConfig;
}

export interface LlmMeshEnrollmentAccount {
  accountId: string;
  provider: "cloud-code" | "codex";
  label: string;
}

export interface FacadeEnrollmentOptions {
  configRef?: string;
  ownerScope?: string;
  redirectUri?: string;
  /** Injection seam for CLI tests; production uses the opaque facade. */
  facade?: LlmMeshFacade;
  /** Injection seam that keeps enrollment tests from opening a real browser. */
  openBrowser?: (url: string) => void;
}

function facadeConfigResolver() {
  return {
    async resolveConfig(configRef: string): Promise<Record<string, unknown>> {
      const raw = process.env.H2A_LLM_MESH_CONFIG_JSON;
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const scoped = parsed[configRef];
        return scoped && typeof scoped === "object" && !Array.isArray(scoped)
          ? (scoped as Record<string, unknown>)
          : parsed;
      } catch {
        return {};
      }
    },
  };
}

export function createCliLlmMeshFacade(): LlmMeshFacade {
  return createLlmMeshFacade({
    configResolver: facadeConfigResolver(),
    mode: "cli",
    legacyAccountOwnerScopeRef: llmMeshOwnerScopeRef(),
  });
}

/** Stable local owner used both at enrollment and by gateway-authenticated routing. */
export function llmMeshOwnerScopeRef(): string {
  return process.env.H2A_LLM_MESH_OWNER_SCOPE?.trim() || `cli:${hostname()}`;
}

function openEnrollmentBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // The URL is always printed, so a headless CLI can continue manually.
  }
}

/**
 * Enroll through the sentropic-owned OAuth state machine. H2A never receives
 * an authorization code or a provider token. Account records remain owned by
 * the facade/keyring and are not copied into h2a config.
 */
export async function enrollViaFacade(
  provider: "cloud-code" | "codex",
  options: FacadeEnrollmentOptions = {},
): Promise<LlmMeshEnrollmentAccount> {
  const facade = options.facade ?? createCliLlmMeshFacade();
  const session = await facade.enroll(provider, {
    configRef: options.configRef ?? process.env.H2A_LLM_MESH_CONFIG_REF ?? "default",
    mode: "cli",
    redirectUri: options.redirectUri ?? "http://127.0.0.1",
    ownerScope: options.ownerScope ?? llmMeshOwnerScopeRef(),
  });

  const completed = provider === "cloud-code"
    ? await (async () => {
        if (session.kind !== "authorization-url") {
          throw new Error("Cloud Code enrollment did not return an authorization URL");
        }
        process.stdout.write(`[h2a] llm-mesh: open ${session.url}\n`);
        (options.openBrowser ?? openEnrollmentBrowser)(session.url);
        return facade.waitForCallback(session.enrollmentId);
      })()
    : await (async () => {
        if (session.kind !== "device-code") {
          throw new Error("Codex enrollment did not return a device code");
        }
        process.stdout.write(
          `[h2a] llm-mesh: enter code ${session.userCode} at ${session.verificationUrl}\n`,
        );
        return facade.pollForCompletion(session.enrollmentId);
      })();

  return { accountId: completed.accountId, provider, label: completed.label };
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

  public async StartGateway(
    config: LlmMeshConfig,
    opts: StartGatewayOptions = {},
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

export function readLlmMeshConfig(dir?: string): LlmMeshConfig | null {
  const config = readJson<Omit<LlmMeshConfig, "accounts" | "meshAccounts"> & {
    accounts?: unknown;
    meshAccounts?: unknown;
  }>(llmMeshConfigPath(dir));
  if (!config) return null;
  const { accounts: _legacyAccounts, meshAccounts: _legacyPublicIds, ...publicConfig } = config;
  return publicConfig;
}

export function writeLlmMeshConfig(config: LlmMeshConfig, dir?: string): void {
  // The facade/keyring own credentials. Keep only public enrollment metadata
  // in llm-mesh.json, including when migrating a pre-facade configuration.
  const {
    accounts: _legacyCredentialRecords,
    meshAccounts: _legacyPublicIds,
    ...publicConfig
  } = config;
  if (publicConfig.routing) validateLlmMeshRoutingConfig(publicConfig.routing);
  writeSecret(llmMeshConfigPath(dir), publicConfig);
}

export function updateLlmMeshRoutingConfig(
  routing: LlmMeshRoutingConfig | undefined,
  dir?: string,
): LlmMeshConfig {
  const config = readLlmMeshConfig(dir) ?? {};
  const next = routing
    ? { ...config, routing: validateLlmMeshRoutingConfig(routing) }
    : (() => {
        const copy = { ...config };
        delete copy.routing;
        return copy;
      })();
  writeLlmMeshConfig(next, dir);
  return next;
}

// ---------------------------------------------------------------------------
// Gateway process management
// ---------------------------------------------------------------------------

/** Resolve the embedded gateway runtime entry point relative to this package. */
export function gatewayScriptPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), "llm-gateway-runtime", "index.js");
}

export interface StartResult {
  pid: number;
  port: number;
  gatewayToken: string;
}

export interface StartGatewayOptions {
  readonly verbose?: boolean | undefined;
  readonly clientSessionId?: string | undefined;
  /**
   * Private runtime state root for the PID, session metadata, and gateway log.
   * The public routing configuration and the Sentropic-owned credential facade
   * remain at their normal locations, so an isolated probe can use enrolled
   * accounts without taking over the user's live gateway state.
   */
  readonly stateDir?: string | undefined;
}

/**
 * A gateway session is an account-affinity boundary, so a local CLI session
 * must never inherit a process-wide static identifier. Callers provide the
 * stable tmux/conversation identity when they have one; standalone gateway
 * management gets a fresh ephemeral identity instead.
 */
export function gatewayClientSessionId(clientSessionId?: string): string {
  const supplied = clientSessionId?.trim();
  return supplied || `local-${randomBytes(16).toString("hex")}`;
}

/**
 * Start the llm-gateway as a detached background process.
 * Returns the PID, port, and a gw-token for Claude Code.
 */
export async function startGateway(
  config: LlmMeshConfig,
  opts: StartGatewayOptions = {},
): Promise<StartResult> {
  const port = config.port ?? 3002;
  const stateDir = opts.stateDir;
  // An explicitly isolated state root must not inherit a live gateway's log.
  const logFile = stateDir ? llmMeshLogPath(undefined, stateDir) : llmMeshLogPath(config);
  const gatewayScript = gatewayScriptPath();

  if (!existsSync(gatewayScript)) {
    throw new Error(
      `Gateway script not found: ${gatewayScript}\n` +
        `Run \`npm run build -w @sentropic/remote-cli\` first.`,
    );
  }

  mkdirSync(stateDir ?? sentropicDir(), { recursive: true });

  const gatewayEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    H2A_LLM_MESH_OWNER_SCOPE: llmMeshOwnerScopeRef(),
    ...(config.routing
      ? { H2A_LLM_MESH_ROUTING_JSON: JSON.stringify(config.routing) }
      : {}),
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
  writeFileSync(llmMeshPidPath(stateDir), String(pid) + "\n");

  // Wait for the gateway to be ready
  const baseUrl = `http://localhost:${port}`;
  await waitForHealth(baseUrl, 10_000);

  // Acquire a session token
  const sessionResp = await fetch(`${baseUrl}/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: gatewayClientSessionId(opts.clientSessionId),
      clientSessionId: opts.clientSessionId,
      workspaceId: process.cwd(),
    }),
  });
  if (!sessionResp.ok) {
    throw new Error(`Session acquisition failed: ${sessionResp.status}`);
  }
  const session = (await sessionResp.json()) as { gatewayToken?: string };
  const gatewayToken = session.gatewayToken;
  if (!gatewayToken) throw new Error("No gatewayToken in session response");

  // Persist only process metadata. The opaque bearer remains process-local and
  // is reacquired for each caller affinity.
  writeSecret(llmMeshTokenPath(stateDir), {
    baseUrl,
    pid,
  });

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
  baseUrl: string;
  pid: number;
}

function configuredGatewayBaseUrl(dir?: string): string | null {
  const config = readLlmMeshConfig(dir);
  if (!config) return null;
  return `http://localhost:${config.port ?? 3002}`;
}

/**
 * Acquire a fresh in-memory gateway token from the running local gateway.
 * Gateway tokens are intentionally not durable. The runtime metadata file
 * contains only the base URL and PID; every caller reacquires its own bearer.
 */
export async function acquireLlmMeshSessionEnv(
  dir?: string,
  clientSessionId?: string,
): Promise<{
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
} | null> {
  try {
    let baseUrl: string | undefined;
    let pid: number | undefined;
    try {
      const raw = readFileSync(llmMeshTokenPath(dir), "utf8");
      const tokenFile = JSON.parse(raw) as LlmMeshTokenFile;
      baseUrl = tokenFile.baseUrl;
      pid = tokenFile.pid;
    } catch {
      baseUrl = configuredGatewayBaseUrl(dir) ?? undefined;
      pid = readGatewayPid(dir) ?? undefined;
    }
    if (!baseUrl || !pid) return null;
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
        sessionId: gatewayClientSessionId(clientSessionId),
        clientSessionId,
        workspaceId,
      }),
    });
    if (!sessionResp.ok) return null;
    const session = (await sessionResp.json()) as { gatewayToken?: string };
    if (!session.gatewayToken) return null;
    return {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: session.gatewayToken,
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
