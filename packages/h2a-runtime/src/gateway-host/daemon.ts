/** Local gateway daemon lifecycle and caller environment. */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { llmMeshOwnerScopeRef } from "../llm-mesh-accounts.js";
import { sentropicDir, readLlmMeshConfig, writePrivateMetadata, type LlmMeshConfig } from "./config-file.js";

const ANTHROPIC_GATEWAY_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
] as const;

/**
 * Temporarily replace the H2A gateway lane and return an exact restorer.
 * Direct launches preserve a user-owned ANTHROPIC_API_KEY. Gateway launches
 * hide it from Claude Code because the local gateway authenticates with the
 * opaque AUTH_TOKEN lane instead.
 */
export function replaceAnthropicGatewayEnvironment(
  env: NodeJS.ProcessEnv,
  replacement?: Partial<Record<(typeof ANTHROPIC_GATEWAY_ENV_KEYS)[number], string>>,
): () => void {
  const previous = new Map(
    ANTHROPIC_GATEWAY_ENV_KEYS.map((key) => [key, env[key]] as const),
  );
  for (const key of ANTHROPIC_GATEWAY_ENV_KEYS) {
    if (key !== "ANTHROPIC_API_KEY" || replacement !== undefined) {
      delete env[key];
    }
  }
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

export function llmMeshPidPath(dir?: string): string {
  return join(dir ?? sentropicDir(), "llm-mesh.pid");
}

export function llmMeshTokenPath(dir?: string): string {
  return join(dir ?? sentropicDir(), "llm-mesh-token.json");
}

export function llmMeshLogPath(config?: LlmMeshConfig, dir?: string): string {
  return config?.logFile ?? join(dir ?? sentropicDir(), "llm-mesh.log");
}

/** Resolve the embedded gateway runtime entry point relative to this package. */
export function gatewayScriptPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), "host.js");
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
  writePrivateMetadata(llmMeshTokenPath(stateDir), {
    baseUrl,
    pid,
  });

  return { pid, port, gatewayToken };
}

export async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      if (resp.ok) return;
      if (resp.status === 404) {
        process.stderr.write("[h2a] older daemon readiness fallback: /health (no /readyz endpoint)\n");
        const legacy = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
        if (legacy.ok) return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Gateway did not become ready within ${timeoutMs}ms`);
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

/** Whether the old listener still accepts loopback connections. */
async function listenerReleased(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (released: boolean) => { socket.destroy(); resolve(released); };
    socket.once("connect", () => finish(false));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED"));
    socket.setTimeout(200, () => finish(false));
  });
}

/** Stop and await process exit AND listener release before removing the PID. */
export async function stopGateway(dir?: string, timeoutMs = 5000): Promise<{ stopped: boolean; pid?: number }> {
  const pid = readGatewayPid(dir);
  if (!pid) return { stopped: false };
  let port = readLlmMeshConfig(dir)?.port ?? 3002;
  try {
    const metadata = JSON.parse(readFileSync(llmMeshTokenPath(dir), "utf8")) as LlmMeshTokenFile;
    port = Number(new URL(metadata.baseUrl).port) || port;
  } catch { /* Older daemons may have only the public config and PID. */ }
  try { process.kill(pid, "SIGTERM"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let exited = false;
    try { process.kill(pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      exited = true;
    }
    if (exited && await listenerReleased(port)) {
      try { unlinkSync(llmMeshPidPath(dir)); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return { stopped: true, pid };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Gateway shutdown timed out after ${timeoutMs}ms (pid ${pid}, port ${port}); PID retained`);
}
