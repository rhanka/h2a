import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { H2AWorkspaceRef } from "@sentropic/h2a";

import { createInboxWakeHandler } from "../drive/inbox-wake.js";
import { detectTmuxLaunchContext, type H2ADriver } from "../drive/index.js";
import { createLocalStore } from "../local-files/index.js";
import { reapDeadInstancePresence } from "../local-files/presence.js";
import { agentVersion } from "../version/agent-version.js";
import { createMcpServer, type McpServer } from "./server.js";

/**
 * Minimal subset of the JSON-RPC 2.0 spec we accept on the wire. The spec
 * allows `id` to be a string, number, or null; we keep it loose since we
 * only echo it back.
 */
interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: unknown;
  result: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: unknown;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface RunMcpStdioOptions {
  /** Filesystem root for the local-files store. */
  root: string;
  /** Readable stream of newline-delimited JSON-RPC requests. */
  stdin: Readable;
  /** Writable stream for newline-delimited JSON-RPC responses. */
  stdout: Writable;
  /** Writable stream for diagnostics (never used for protocol traffic). */
  stderr: Writable;
  /**
   * Optional override for the SessionRegistry heartbeat interval in ms.
   * Defaults to H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS or, if set, the
   * H2A_HEARTBEAT_INTERVAL_MS environment variable.
   */
  heartbeatIntervalMs?: number;
  /**
   * Optional override for the NotificationDispatcher poll interval in ms.
   * Defaults to the heartbeat interval or, if set, the
   * H2A_NOTIFY_INTERVAL_MS environment variable.
   */
  notifyIntervalMs?: number;
  /**
   * Optional override for session expiry in ms. Defaults to
   * H2A_SESSION_DEFAULT_EXPIRY_MS or, if set, H2A_SESSION_EXPIRY_MS.
   */
  expiryMs?: number;
  /**
   * DEC-105 (EVO-6): open a presence session automatically when the server
   * boots, so the host is on the bus at startup without an explicit
   * `/h2a connect`. The session auto-closes on shutdown (DEC-051); the agent
   * can still close it early with `h2a_session_close` (`/h2a disconnect`).
   */
  autoOpen?: {
    readonly instance: string;
    readonly host?: string;
    readonly workspace?: H2AWorkspaceRef;
    readonly name?: string;
    readonly scopes?: readonly string[];
  };
  /**
   * EVO-1 inbox wake (bug #3): when set (with `autoOpen`), inject a signed,
   * h2a-tagged wake line into the host via `driver` whenever a new inbox
   * envelope arrives for the auto-opened instance. The host is woken to run
   * `/h2a receive`. Driver-injected so it's testable; `nativeBackchannelDriver`
   * is the real wake.
   */
  wake?: {
    readonly driver: H2ADriver;
    readonly privateKeyPem: string;
  };
  /**
   * Optional abort signal for graceful shutdown. When it aborts, the server
   * closes its sessions (presence → `closed`, so peers no longer see a
   * false-live) and resolves. The real entry (bin.ts) wires SIGTERM/SIGINT/
   * SIGHUP to an AbortController so a host kill cleans presence immediately
   * instead of leaving it to expire. Tests omit it (no process listeners).
   */
  signal?: AbortSignal;
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "@sentropic/h2a-cli";
const SERVER_VERSION = "0.1.1";

function writeResponse(stdout: Writable, response: JsonRpcResponse): void {
  stdout.write(`${JSON.stringify(response)}\n`);
}

function errorResponse(
  id: unknown,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  const error: JsonRpcErrorResponse["error"] = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function successResponse(id: unknown, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id, result };
}

function handleMethod(
  server: McpServer,
  method: string,
  params: unknown
): unknown {
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      capabilities: { tools: {} }
    };
  }
  if (method === "tools/list") {
    return { tools: server.listTools() };
  }
  if (method === "tools/call") {
    const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = typeof p.name === "string" ? p.name : "";
    const args =
      p.arguments && typeof p.arguments === "object"
        ? (p.arguments as Record<string, unknown>)
        : {};
    const result = server.callTool(name, args);
    const isError = Boolean(
      result && typeof result === "object" && "error" in (result as object)
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError
    };
  }
  // Sentinel: the caller will map this to JSON-RPC -32601.
  throw new MethodNotFoundError(method);
}

class MethodNotFoundError extends Error {
  constructor(public readonly method: string) {
    super(`Method not found: ${method}`);
    this.name = "MethodNotFoundError";
  }
}

/**
 * Run the MCP server over a JSON-RPC 2.0 newline-delimited stdio transport.
 *
 * Reads requests from `stdin`, writes responses to `stdout` (one per line),
 * uses `stderr` for diagnostics only. Resolves once `stdin` reaches EOF.
 * A malformed line or a tool-dispatch throw never crashes the loop: each
 * is reported as a structured JSON-RPC error response.
 */
export function runMcpStdio(options: RunMcpStdioOptions): Promise<void> {
  const { root, stdin, stdout, stderr } = options;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? envInt("H2A_HEARTBEAT_INTERVAL_MS");
  const notifyIntervalMs =
    options.notifyIntervalMs ??
    envInt("H2A_NOTIFY_INTERVAL_MS") ??
    heartbeatIntervalMs;
  const expiryMs = options.expiryMs ?? envInt("H2A_SESSION_EXPIRY_MS");
  // The stdio transport carries live agent sessions; enable autoHeartbeat so
  // the presence file stays fresh while this mcp-serve process is alive.
  const server = createMcpServer({
    root,
    sessions: {
      autoHeartbeat: true,
      ...(heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs } : {}),
      ...(expiryMs !== undefined ? { expiryMs } : {})
    },
    notifications: {
      ...(notifyIntervalMs !== undefined ? { intervalMs: notifyIntervalMs } : {}),
      sink: (notification) => {
        stdout.write(`${JSON.stringify(notification)}\n`);
      }
    }
  });
  // DEC-052: start the periodic diff scan so subscribed sessions receive
  // pushed presence/inbox/negotiation notifications.
  server.notifications.start();

  // DEC-105 (EVO-6): auto-open a presence session at boot when requested, so
  // the host joins the bus at startup. Best-effort: a failure here must not
  // crash the transport (diagnostics to stderr only — stdout is protocol).
  if (options.autoOpen) {
    try {
      const opened = server.sessions.open({
        instance: options.autoOpen.instance,
        ...(options.autoOpen.host !== undefined ? { host: options.autoOpen.host } : {}),
        ...(options.autoOpen.workspace !== undefined
          ? { workspace: options.autoOpen.workspace }
          : {}),
        ...(options.autoOpen.name !== undefined ? { name: options.autoOpen.name } : {}),
        version: agentVersion(options.autoOpen.host),
        // Auto-capture our tmux pane (inherited $TMUX_PANE) so the local-tmux
        // wake driver can target this agent — no launcher config needed.
        ...((() => {
          const lc = detectTmuxLaunchContext(
            process.env,
            undefined,
            `h2a mcp-serve --host ${options.autoOpen.host ?? ""}`.trim()
          );
          return lc ? { launchContext: lc } : {};
        })()),
        interests: {
          scopes: [...(options.autoOpen.scopes ?? ["scope:default"])],
          negotiations: []
        }
      });
      stderr.write(
        `h2a mcp-serve: auto-opened session for ${options.autoOpen.instance}\n`
      );
      // Reap the false-live presence left by a previous connection of THIS
      // agent that the host dropped without signalling (process lingered,
      // blind heartbeat kept presence "live"). Best-effort, same-instance only.
      try {
        const reaped = reapDeadInstancePresence(
          root,
          options.autoOpen.instance,
          opened.sessionId
        );
        if (reaped.length > 0) {
          stderr.write(
            `h2a mcp-serve: reaped ${reaped.length} stale presence file(s) for ${options.autoOpen.instance}\n`
          );
        }
      } catch {
        // best-effort
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stderr.write(`h2a mcp-serve: auto-open failed: ${message}\n`);
    }

    // EVO-1 wake (bug #3): wake the idle host when a new inbox envelope arrives.
    if (options.wake) {
      const wakeInstance = options.autoOpen.instance;
      const wakeStore = createLocalStore({ root });
      const wake = createInboxWakeHandler({
        instance: wakeInstance,
        readInbox: () => wakeStore.readInbox(wakeInstance),
        privateKeyPem: options.wake.privateKeyPem,
        driver: options.wake.driver,
        ...(options.autoOpen.host !== undefined ? { host: options.autoOpen.host } : {}),
        // Self-wake targets THIS process's OWN tmux pane (inherited $TMUX_PANE),
        // NOT latestLaunchContext(instance) — with concurrent sessions sharing one
        // perennial id (durable bug #1), an instance lookup could inject keystrokes
        // into a DIFFERENT agent's terminal. The waking process is the one in the pane.
        resolveLaunchContext: () =>
          detectTmuxLaunchContext(
            process.env,
            undefined,
            `h2a mcp-serve --host ${options.autoOpen?.host ?? ""}`.trim()
          ),
        log: (line) => stderr.write(`h2a mcp-serve: ${line}\n`)
      });
      server.notifications.setOnInboxArrival((instance) => {
        if (instance === wakeInstance) void wake();
      });
      stderr.write(`h2a mcp-serve: inbox-wake armed for ${wakeInstance}\n`);
    }
  }

  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  (stdin as Readable & { ref?: () => void }).ref?.();
  stdin.resume();

  let didShutdown = false;
  function shutdown(): void {
    if (didShutdown) return;
    didShutdown = true;
    try {
      server.notifications.stop();
      server.sessions.closeAll("closed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stderr.write(`h2a mcp-serve: shutdown error: ${message}\n`);
    }
  }

  return new Promise<void>((resolve, reject) => {
    // Graceful shutdown on abort (SIGTERM/SIGINT/SIGHUP, wired by bin.ts): close
    // sessions so presence is marked `closed` immediately rather than lingering
    // as false-live until expiry. Idempotent with the rl `close` path below.
    const onAbort = (): void => {
      shutdown();
      try {
        rl.close();
      } catch {
        // ignore
      }
      resolve();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeResponse(stdout, errorResponse(null, -32700, "Parse error", message));
        return;
      }

      // JSON-RPC 2.0: a message with NO `id` member is a NOTIFICATION — the
      // server MUST NOT reply to it (not even an error). Previously every line
      // got a response with `id: request.id ?? null`, so a notification such as
      // the standard `notifications/initialized` drew back an `id:null` error
      // response, which strict clients (codex's rmcp) reject with "data did not
      // match any variant of untagged enum JsonRpcMessage" — breaking the stream
      // at startup. Gate every stdout write on the message actually being a
      // request (DEC-115).
      const isNotification = !("id" in request);

      if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
        if (!isNotification) {
          writeResponse(stdout, errorResponse(request.id ?? null, -32600, "Invalid Request"));
        }
        return;
      }

      try {
        const result = handleMethod(server, request.method, request.params);
        if (!isNotification) {
          writeResponse(stdout, successResponse(request.id ?? null, result));
        }
      } catch (err) {
        if (isNotification) {
          // An unhandled notification (e.g. `notifications/initialized`) is a
          // silent no-op; surface only genuine internal errors on stderr.
          if (!(err instanceof MethodNotFoundError)) {
            const message = err instanceof Error ? err.message : String(err);
            stderr.write(`h2a mcp-serve: internal error (notification ${request.method}): ${message}\n`);
          }
          return;
        }
        if (err instanceof MethodNotFoundError) {
          writeResponse(
            stdout,
            errorResponse(request.id ?? null, -32601, `Method not found: ${err.method}`)
          );
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        stderr.write(`h2a mcp-serve: internal error: ${message}\n`);
        writeResponse(
          stdout,
          errorResponse(request.id ?? null, -32603, `Internal error: ${message}`)
        );
      }
    });

    rl.on("close", () => {
      shutdown();
      resolve();
    });
    rl.on("error", (err) => {
      shutdown();
      reject(err);
    });
  });
}
