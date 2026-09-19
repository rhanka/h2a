import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { linkSync, unlinkSync, writeFileSync } from "node:fs";
import type { Readable, Writable } from "node:stream";

import type { H2AWorkspaceRef } from "@sentropic/h2a";

import { createInboxWakeHandler } from "../drive/inbox-wake.js";
import {
  detectLocalLaunchContext,
  detectTmuxLaunchContext,
  type H2ADriver
} from "../drive/index.js";
import { createLocalStore } from "../local-files/index.js";
import { reapDeadInstancePresence } from "../local-files/presence.js";
import { agentVersion } from "../version/agent-version.js";
import { currentCliVersion } from "../upgrade/index.js";
import { getActiveMcpTrace } from "./phase-trace.js";
import {
  createMcpServer,
  isMcpTransportResult,
  type McpServer
} from "./server.js";
import type { H2aRunDelegation, H2aRunExecutor } from "./agent-launch.js";
import type { H2ASendSigner } from "../send.js";
import {
  boundNotificationFrame,
  boundResponseFrame,
  buildInvalidRequestId,
  encodeFrame,
  isAcceptableRequestId,
  type EncodedFrame,
  type JsonRpcId
} from "./frame-budget.js";
import type { PayloadRecoveryRef } from "./payload-store.js";

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
  /** Workspace boundary for h2a_run; defaults to the server startup cwd. */
  workspaceRoot?: string;
  /** Test seam for h2a_run; production uses the argv-only subprocess bridge. */
  runExecutor?: H2aRunExecutor;
  /** Trusted signer resolved by mcp-serve, never from JSON-RPC arguments. */
  sendContext?: H2ASendSigner;
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
    /**
     * Re-reads the host-native display title on each heartbeat (spec
     * 2026-07-25-h2a-lane-addressing §D1b). Omit to freeze the name — which is
     * what an explicit `--name` does.
     */
    readonly refreshDisplayName?: () => string | undefined;
    /** Set only for a locally-derived sidecar identity (not --instance). */
    readonly delegationEligible?: true;
  };
  /**
   * Internal structured-launch readiness handshake. When present, auto-open is
   * mandatory and this process atomically publishes the correlated ACK only
   * after the presence session is open. It is never an MCP/CLI public option.
   */
  readiness?: {
    readonly file: string;
    readonly nonce: string;
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
    /** Concrete native PTY session receiving the signed self-wake line. */
    readonly nativeSessionId?: string;
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
const SERVER_NAME = "@sentropic/h2a";

// The MCP `serverInfo.version` MUST be the real package version, not a frozen
// literal — a stale `0.1.1` made `initialize` disagree with the plugin manifest
// and `h2a --version`, defeating the version-drift diagnosis (#275). Resolved
// from package.json via `currentCliVersion()` and cached (initialize is rare,
// but the read is trivial and total — it falls back to "0.0.0" on any error).
let cachedServerVersion: string | undefined;
function serverVersion(): string {
  if (cachedServerVersion === undefined) {
    try {
      cachedServerVersion = currentCliVersion();
    } catch {
      cachedServerVersion = "0.0.0";
    }
  }
  return cachedServerVersion;
}

function currentTmuxSessionForSidecar(): string | undefined {
  const pane = process.env.TMUX_PANE;
  if (!pane || !/^%\d+$/.test(pane)) return undefined;
  try {
    const result = spawnSync(
      "tmux",
      ["display-message", "-p", "-t", pane, "#{session_name}"],
      { encoding: "utf8", timeout: 250 },
    );
    const name = result.status === 0 ? (result.stdout ?? "").trim() : "";
    return name && name.length <= 128 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)
      ? name
      : undefined;
  } catch {
    return undefined;
  }
}

function recordTmuxOwner(session: string, instance: string): void {
  try {
    spawnSync(
      "tmux",
      ["set-option", "-t", `=${session}`, "@h2a_owner_instance", instance],
      { stdio: "ignore", timeout: 250 },
    );
  } catch {
    // A missing tmux server means the owner link stays unknown; never invent it.
  }
}

export const H2A_MCP_READY_FILE_ENV = "H2A_MCP_READY_FILE";
export const H2A_MCP_READY_NONCE_ENV = "H2A_MCP_READY_NONCE";
export const H2A_MCP_READY_KIND = "h2a.mcp.ready";

function publishReadinessAck(
  readiness: NonNullable<RunMcpStdioOptions["readiness"]>,
  sessionId: string
): void {
  const temporary = `${readiness.file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      temporary,
      `${JSON.stringify({
        kind: H2A_MCP_READY_KIND,
        version: 1,
        nonce: readiness.nonce,
        pid: process.pid,
        sessionId
      })}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    // Hard-linking a fully-written file to the final name is atomic and refuses
    // to overwrite an existing ACK. The launcher owns a private 0700 directory.
    linkSync(temporary, readiness.file);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // The final link is the only readiness signal; temp cleanup is best effort.
    }
  }
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
      serverInfo: { name: SERVER_NAME, version: serverVersion() },
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
    if (isMcpTransportResult(result)) return result;
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
  // L0 trace: the ambient per-attempt trace installed by bin.ts. Undefined in
  // unit tests and normal CLI verbs → every call is a no-op. It only ever
  // writes to stderr, never to the JSON-RPC stdout stream.
  const trace = getActiveMcpTrace();
  // Only the FIRST tool response is the calibration milestone; the rest are
  // still measured but tagged distinctly.
  let firstToolCallTraced = false;
  if (options.readiness && !options.autoOpen) {
    throw new Error("structured readiness requires successful auto-open");
  }
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? envInt("H2A_HEARTBEAT_INTERVAL_MS");
  const notifyIntervalMs =
    options.notifyIntervalMs ??
    envInt("H2A_NOTIFY_INTERVAL_MS") ??
    heartbeatIntervalMs;
  const expiryMs = options.expiryMs ?? envInt("H2A_SESSION_EXPIRY_MS");
  // The stdio transport carries live agent sessions; enable autoHeartbeat so
  // the presence file stays fresh while this mcp-serve process is alive.
  let delegation: H2aRunDelegation | undefined;
  // L1: forward reference — the notification sink is installed on the server
  // below, but the bounded emitter needs `server.frameBudget`/`payloadStore`,
  // which only exist after creation. Ticks are unref'd and interval-driven, so
  // the real emitter is always assigned before the first tick fires.
  let emitNotification: (
    notification: unknown,
    meta: { method: string; topic?: string | undefined }
  ) => { accepted: boolean } = () => ({ accepted: false });
  const server = createMcpServer({
    root,
    workspaceRoot: options.workspaceRoot ?? process.cwd(),
    ...(options.runExecutor ? { runExecutor: options.runExecutor } : {}),
    ...(options.sendContext ? { sendContext: options.sendContext } : {}),
    delegationContext: () => delegation,
    sessions: {
      autoHeartbeat: true,
      ...(heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs } : {}),
      ...(expiryMs !== undefined ? { expiryMs } : {})
    },
    notifications: {
      ...(notifyIntervalMs !== undefined ? { intervalMs: notifyIntervalMs } : {}),
      sink: (notification) =>
        emitNotification(notification, {
          method: notification.method,
          topic:
            typeof notification.params?.topic === "string"
              ? notification.params.topic
              : undefined
        })
    }
  });

  // ---------------------------------------------------------------------------
  // L1: the SINGLE bounded output writer. Every frame — success, error, parse
  // error, initialize, tools/list, a preformatted Track result, AND every pushed
  // notification — is bounded to the frame budget here; there is NO direct write
  // to `stdout` anywhere else. Writes are ordered and drain-aware (backpressure),
  // and the queue is byte-bounded so a slow reader cannot grow memory unbounded.
  // ---------------------------------------------------------------------------
  const frameBudget = server.frameBudget;
  const recover = (intactJson: string): PayloadRecoveryRef | undefined => {
    try {
      return server.payloadStore.persistOutput(Buffer.from(intactJson, "utf8"));
    } catch {
      return undefined;
    }
  };
  const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
  let writeChain: Promise<void> = Promise.resolve();
  let queuedBytes = 0;
  function enqueueLine(line: string): void {
    const bytes = Buffer.byteLength(line, "utf8");
    queuedBytes += bytes;
    writeChain = writeChain
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            const flushed = stdout.write(line, (err) => {
              if (err) reject(err);
            });
            if (flushed) resolve();
            else stdout.once("drain", resolve);
          })
      )
      .then(
        () => {
          queuedBytes -= bytes;
        },
        (err) => {
          queuedBytes -= bytes;
          throw err;
        }
      );
    writeChain.catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      try {
        stderr.write(`h2a mcp-serve: stdout write error: ${message}\n`);
      } catch {
        /* stderr is diagnostic-only; a broken diagnostic sink is not fatal */
      }
    });
  }
  /** Bound and enqueue a JSON-RPC response; returns the frame ACTUALLY emitted. */
  function emitResponse(id: JsonRpcId, responseObject: unknown): EncodedFrame {
    const frame = boundResponseFrame(id, responseObject, frameBudget, recover);
    enqueueLine(frame.line);
    return frame;
  }
  emitNotification = (notification, meta): { accepted: boolean } => {
    if (queuedBytes > MAX_QUEUE_BYTES) {
      // Queue bound: drop rather than grow memory unbounded. A response is never
      // dropped; a notification is retried by the dispatcher (snapshot held).
      try {
        stderr.write(`h2a mcp-serve: notification queue full; dropped ${meta.method}\n`);
      } catch {
        /* diagnostic only */
      }
      return { accepted: false };
    }
    const outcome = boundNotificationFrame(notification, meta, frameBudget, recover);
    if (!outcome) {
      try {
        stderr.write(`h2a mcp-serve: dropped unserializable notification ${meta.method}\n`);
      } catch {
        /* diagnostic only */
      }
      return { accepted: false };
    }
    enqueueLine(outcome.frame.line);
    return { accepted: outcome.accepted };
  };

  // DEC-052: start the periodic diff scan so subscribed sessions receive
  // pushed presence/inbox/negotiation notifications.
  server.notifications.start();

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

  // WP-F: the auto-opened session id, so the line loop can mark MCP activity on
  // it (presence-honesty — proof the host→server channel is carrying traffic).
  let autoOpenedSessionId: string | undefined;

  // DEC-105 (EVO-6): auto-open a presence session at boot when requested, so
  // the host joins the bus at startup. Historically this is best-effort; a
  // structured readiness challenge upgrades failure to fatal because no ACK
  // may be published for an unreachable sidecar.
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
        // Auto-capture our owning local terminal (native session or inherited
        // tmux pane) so loop scheduling has an explicit wake target.
        ...((() => {
          const lc = detectLocalLaunchContext(
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
      autoOpenedSessionId = opened.sessionId;
      trace?.phase("session_open");
      // Spec 2026-07-25-h2a-lane-addressing §D1b: follow the host-native title
      // for the life of the session, so a rename converges into presence within
      // one heartbeat instead of staying stale until the host reconnects.
      // Absent when the operator passed an explicit `--name`.
      if (options.autoOpen.refreshDisplayName) {
        server.sessions.setDisplayNameResolver(
          opened.sessionId,
          options.autoOpen.refreshDisplayName
        );
      }
      const delegatorTmuxSession = currentTmuxSessionForSidecar();
      if (delegatorTmuxSession && options.autoOpen.delegationEligible === true) {
        delegation = {
          origin: "mcp:h2a_run",
          delegatorInstance: options.autoOpen.instance,
          delegatorTmuxSession,
        };
        recordTmuxOwner(delegatorTmuxSession, options.autoOpen.instance);
      }
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
      if (options.readiness) {
        shutdown();
        throw new Error(`structured auto-open failed: ${message}`);
      }
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
        // into a DIFFERENT agent's terminal. Native inbox delivery belongs to PR-1.
        resolveLaunchContext: () =>
          detectTmuxLaunchContext(
            process.env,
            undefined,
            `h2a mcp-serve --host ${options.autoOpen?.host ?? ""}`.trim()
          ),
        ...(options.wake.nativeSessionId !== undefined
          ? { resolveNativeSessionId: () => options.wake?.nativeSessionId }
          : {}),
        log: (line) => stderr.write(`h2a mcp-serve: ${line}\n`)
      });
      server.notifications.setOnInboxArrival((instance) => {
        if (instance === wakeInstance) void wake();
      });
      stderr.write(`h2a mcp-serve: inbox-wake armed for ${wakeInstance}\n`);
    }
  }

  // Publish only after every synchronous boot step above has completed and
  // immediately before constructing the stdio loop. Auto-upgrade/re-exec runs
  // in runMcpServe before this function, so it cannot acknowledge early.
  if (options.readiness && autoOpenedSessionId) {
    try {
      publishReadinessAck(options.readiness, autoOpenedSessionId);
      trace?.phase("readiness_ack");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stderr.write(`h2a mcp-serve: readiness ACK failed: ${message}\n`);
      shutdown();
      throw new Error(`structured readiness ACK failed: ${message}`);
    }
  }

  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  (stdin as Readable & { ref?: () => void }).ref?.();
  stdin.resume();

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
      // Flush the bounded writer before resolving so no queued frame is lost.
      void writeChain.finally(() => resolve());
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

      // WP-F: any non-empty inbound line proves the host→server MCP channel is
      // carrying traffic right now — record it (in-memory; flushed by heartbeat).
      if (autoOpenedSessionId) server.sessions.markActivity(autoOpenedSessionId);

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emitResponse(null, errorResponse(null, -32700, "Parse error", message));
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

      // L1: reject an incoming id we cannot correlate within budget (a huge
      // string, an object, an array) BEFORE building any response — so every
      // response id below is a finite number, null, or a ≤128-byte string.
      if (!isNotification && !isAcceptableRequestId(request.id)) {
        emitResponse(null, buildInvalidRequestId());
        return;
      }

      if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
        if (!isNotification) {
          emitResponse(
            (request.id ?? null) as JsonRpcId,
            errorResponse(request.id ?? null, -32600, "Invalid Request")
          );
        }
        return;
      }

      try {
        const requestId =
          typeof request.id === "string" || typeof request.id === "number"
            ? request.id
            : undefined;
        if (trace && request.method === "initialize") {
          trace.phase("initialize_recv", {
            method: "initialize",
            ...(requestId !== undefined ? { requestId } : {})
          });
        }
        const result = handleMethod(server, request.method, request.params);
        if (!isNotification) {
          // L1: the SINGLE bounded writer serializes ONCE, bounds the exact UTF-8
          // bytes to the frame budget (an oversize result becomes a bounded -32010
          // with a recovery ref — never a raw >B write), and returns the frame
          // ACTUALLY emitted so the L0 calibration measures the true wire size.
          const emitted = emitResponse(
            (request.id ?? null) as JsonRpcId,
            successResponse(request.id ?? null, result)
          );
          // L0 calibration semantics: the PAYLOAD bytes (no trailing newline),
          // as before the single-writer refactor. The budget itself counts the
          // newline; the trace stays payload-exact so the L0 witness is unchanged.
          const bytes = Buffer.byteLength(emitted.json, "utf8");
          if (trace) {
            const rid = requestId !== undefined ? { requestId } : {};
            if (request.method === "initialize") {
              trace.phase("initialize_sent", { bytes, ...rid });
            } else if (request.method === "tools/list") {
              trace.phase("tools_list_sent", { bytes, ...rid });
            } else if (request.method === "tools/call") {
              const rawName =
                request.params && typeof request.params === "object"
                  ? (request.params as { name?: unknown }).name
                  : undefined;
              const toolField = typeof rawName === "string" ? { tool: rawName } : {};
              trace.phase(firstToolCallTraced ? "tool_sent" : "tool_first_sent", {
                bytes,
                ...rid,
                ...toolField
              });
              firstToolCallTraced = true;
            }
          }
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
          emitResponse(
            (request.id ?? null) as JsonRpcId,
            errorResponse(request.id ?? null, -32601, `Method not found: ${err.method}`)
          );
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        stderr.write(`h2a mcp-serve: internal error: ${message}\n`);
        emitResponse(
          (request.id ?? null) as JsonRpcId,
          errorResponse(request.id ?? null, -32603, `Internal error: ${message}`)
        );
      }
    });

    rl.on("close", () => {
      shutdown();
      // Flush the bounded writer before resolving so the last frame is on the
      // wire before the process (bin.ts awaits this promise) can exit.
      void writeChain.finally(() => resolve());
    });
    rl.on("error", (err) => {
      shutdown();
      reject(err);
    });
  });
}
