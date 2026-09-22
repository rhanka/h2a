/**
 * L2 — identity-independent MCP connection + asynchronous identity readiness.
 *
 * The MCP transport (initialize / tools/list) must answer IMMEDIATELY, without
 * waiting on the shared-identity critical section (the keypair read, the
 * registry parse, and above all the identity/registry lock wait). Those run in a
 * dedicated, non-detached CHILD process (`../identity/worker.js`) so they never
 * block the parent's event loop — a `Promise`/`setImmediate` around the sync
 * lock in the PARENT would not help, because the lock wait (and the ~17 MB
 * registry parse) are synchronous and would still stall `initialize`.
 *
 * This module owns the readiness STATE MACHINE and the single 20 s deadline
 * measured from entering `identity_pending`. Activation (opening the real
 * presence session, reading the private key, publishing the correlated readiness
 * ACK, arming the live signer) is delegated to the caller through `activate`,
 * because that side lives with the SessionRegistry in the stdio transport. The
 * controller only transitions to `identity_ready` once activation reports
 * success — never on the child's raw result, never with a provisional key, never
 * with an early availability ACK.
 */

import { fork, type ChildProcess } from "node:child_process";

import type { H2ASendSigner } from "../send.js";
import { identityKeyPaths } from "../identity/live.js";
import { getActiveMcpTrace } from "./phase-trace.js";

/** The single identity deadline (ms), measured from entering identity_pending. */
export const MCP_IDENTITY_TIMEOUT_MS = 20_000;

export type IdentityFailureCode =
  | "identity_timeout"
  | "storage_readonly"
  | "storage_permission_denied"
  | "identity_worker_failed"
  | "identity_proof_failed"
  | "identity_storage_failed"
  | "session_open_failed"
  | "readiness_ack_failed";

export type McpIdentityStatus =
  | { state: "identity_disabled" }
  | { state: "identity_pending"; attemptId: string; elapsedMs: number; timeoutMs: 20000 }
  | {
      state: "identity_ready";
      attemptId: string;
      instance: string;
      sessionId: string;
      signingAvailable: boolean;
    }
  | {
      state: "identity_failed";
      attemptId: string;
      cause: IdentityFailureCode;
      message: string;
      retryable: false;
      elapsedMs: number;
    };

export interface McpIdentityController {
  status(): McpIdentityStatus;
  start(): void;
  cancel(reason: "transport_closed" | "signal"): void;
  signer(): H2ASendSigner | undefined;
}

/**
 * The identity attributes the worker resolves and hands back over IPC. It
 * carries NO private key material — only paths, which the parent re-validates
 * against `identityKeyPaths(root, instance)` before reading.
 */
export interface ResolvedIdentityMessage {
  readonly instance: string;
  readonly host: string;
  readonly workspace?: unknown;
  readonly name?: string;
  readonly action: "override" | "reclaim" | "mint";
  readonly providerSessionId?: string;
  readonly providerSessionSource?: string;
  readonly privateKeyPath: string;
  readonly publicKeyPath: string;
  readonly migrationNotice?: string;
  readonly legacyInstance?: string;
  readonly delegationEligible?: boolean;
}

/** The deferred identity request the CLI hands to the transport (no lock work). */
export interface McpIdentityRequest {
  readonly root: string;
  readonly host: string;
  readonly cwd: string;
  readonly explicitInstance?: string;
  readonly name?: string;
  readonly scopes?: readonly string[];
  readonly declaredCapabilities?: readonly string[];
  /** Provider env captured from the launching session (never re-derived in child). */
  readonly providerEnv?: Readonly<Record<string, string>>;
}

/** Result of a caller-supplied activation attempt (session + ACK + signer). */
export type ActivationResult =
  | { ok: true; sessionId: string; signer?: H2ASendSigner }
  | { ok: false; cause: IdentityFailureCode; message: string };

export interface CreateIdentityControllerOptions {
  readonly request: McpIdentityRequest;
  /**
   * Perform the real activation once the worker resolved a valid identity and
   * the deadline still holds: open the presence session, read the private key,
   * publish the correlated readiness ACK, build the live signer. Returning
   * `{ok:false}` fails the identity terminally (no partial availability).
   */
  readonly activate: (identity: ResolvedIdentityMessage) => ActivationResult;
  /** Diagnostic sink (stderr). Never protocol traffic. */
  readonly log?: (line: string) => void;
  /** Test seam: fork a worker child. Production uses the real fork below. */
  readonly spawnWorker?: (request: McpIdentityRequest, budgetMs: number) => IdentityWorkerHandle;
  /** Test seam: monotonic clock in ns. Defaults to process.hrtime.bigint. */
  readonly nowNs?: () => bigint;
  /** Test seam: deadline in ms. Defaults to MCP_IDENTITY_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

/** Minimal handle over the identity worker child (real fork or test double). */
export interface IdentityWorkerHandle {
  onResolved(cb: (identity: ResolvedIdentityMessage) => void): void;
  onError(cb: (cause: IdentityFailureCode, message: string) => void): void;
  /** Fires when the child exits WITHOUT having produced a result. */
  onExitWithoutResult(cb: () => void): void;
  cancel(reason: string): void;
}

function randomAttemptId(): string {
  // A short, non-secret correlation id for the attempt (never a nonce/key).
  return `att:${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
}

/**
 * Real worker fork. Non-detached, argv-only, stdout IGNORED (it must never write
 * protocol traffic), stderr piped for diagnostics, IPC typed. cwd/provider env
 * are captured explicitly so the child does not inherit an artificial
 * conversation. No shell, and NO PEM ever crosses IPC.
 */
export function forkIdentityWorker(
  request: McpIdentityRequest,
  budgetMs: number,
  log?: (line: string) => void
): IdentityWorkerHandle {
  const capturedEnv: NodeJS.ProcessEnv = { ...process.env, ...(request.providerEnv ?? {}) };
  let child: ChildProcess | undefined;
  let resolvedCb: ((identity: ResolvedIdentityMessage) => void) | undefined;
  let errorCb: ((cause: IdentityFailureCode, message: string) => void) | undefined;
  let exitCb: (() => void) | undefined;
  let sawResult = false;
  let started = false;

  const ensureStarted = (): void => {
    if (started) return;
    started = true;
    try {
      child = fork(new URL("../identity/worker.js", import.meta.url), [], {
        cwd: request.cwd,
        env: capturedEnv,
        stdio: ["ignore", "ignore", "pipe", "ipc"]
      });
    } catch (err) {
      queueMicrotask(() =>
        errorCb?.("identity_worker_failed", err instanceof Error ? err.message : String(err))
      );
      return;
    }
    // Forward the worker's stderr LINE BY LINE so a `h2a.mcp.phase …` trace span
    // (L0, role=identity-child) is never split across a chunk boundary when it is
    // re-emitted on the parent's stderr. Diagnostics flow through unchanged.
    let stderrBuf = "";
    child.stderr?.on("data", (chunk) => {
      stderrBuf += String(chunk);
      let nl;
      while ((nl = stderrBuf.indexOf("\n")) !== -1) {
        const line = stderrBuf.slice(0, nl);
        stderrBuf = stderrBuf.slice(nl + 1);
        if (line.length > 0) log?.(`identity-worker: ${line}`);
      }
    });
    child.stderr?.on("end", () => {
      if (stderrBuf.trimEnd().length > 0) log?.(`identity-worker: ${stderrBuf.trimEnd()}`);
      stderrBuf = "";
    });
    child.on("message", (msg: unknown) => {
      const m = msg as { kind?: string } | undefined;
      if (!m || typeof m !== "object") return;
      if (m.kind === "identity_resolved") {
        sawResult = true;
        resolvedCb?.((m as { identity: ResolvedIdentityMessage }).identity);
      } else if (m.kind === "identity_error") {
        sawResult = true;
        const e = m as { cause?: IdentityFailureCode; message?: string };
        errorCb?.(e.cause ?? "identity_worker_failed", e.message ?? "identity worker error");
      }
      // A `cancel_ack` needs no parent action beyond letting the child exit.
    });
    child.on("error", (err) => {
      if (sawResult) return;
      errorCb?.("identity_worker_failed", err instanceof Error ? err.message : String(err));
    });
    child.on("exit", () => {
      if (!sawResult) exitCb?.();
    });
    try {
      // Correlate the worker's L0 spans to THIS attempt's trace (same attemptId,
      // role=identity-child) so the relocated identity/lock/registry spans stay
      // joinable with the parent's server-role boot spans.
      const traceAttemptId = getActiveMcpTrace()?.attemptId;
      child.send({
        kind: "resolve_identity",
        v: 1,
        request,
        budgetMs,
        ...(traceAttemptId !== undefined ? { traceAttemptId } : {})
      });
    } catch (err) {
      errorCb?.("identity_worker_failed", err instanceof Error ? err.message : String(err));
    }
  };

  return {
    onResolved(cb) {
      resolvedCb = cb;
      ensureStarted();
    },
    onError(cb) {
      errorCb = cb;
    },
    onExitWithoutResult(cb) {
      exitCb = cb;
    },
    cancel(reason) {
      try {
        child?.send({ kind: "cancel", reason });
      } catch {
        /* channel already gone; the child's own finally releases its lock */
      }
    }
  };
}

/**
 * Build the identity controller for one MCP attachment. It starts inert and
 * transitions `identity_pending → identity_ready | identity_failed` exactly once.
 */
export function createIdentityController(
  options: CreateIdentityControllerOptions
): McpIdentityController {
  const timeoutMs = options.timeoutMs ?? MCP_IDENTITY_TIMEOUT_MS;
  const nowNs = options.nowNs ?? process.hrtime.bigint;
  const spawnWorker =
    options.spawnWorker ??
    ((req, budget) => forkIdentityWorker(req, budget, options.log));

  let state: McpIdentityStatus = { state: "identity_disabled" };
  let attemptId = "";
  let startedNs = 0n;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let worker: IdentityWorkerHandle | undefined;
  let liveSigner: H2ASendSigner | undefined;
  let terminal = false;
  let cancelled = false;

  const elapsedMs = (): number => Number((nowNs() - startedNs) / 1_000_000n);

  const clearTimer = (): void => {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
    }
  };

  const fail = (cause: IdentityFailureCode, message: string): void => {
    if (terminal) return;
    terminal = true;
    clearTimer();
    state = {
      state: "identity_failed",
      attemptId,
      cause,
      message,
      retryable: false,
      elapsedMs: elapsedMs()
    };
    liveSigner = undefined;
    // L0 trace reuse: the identity lifecycle on the PARENT (the deep provider /
    // registry / lock spans now run in the child, off this event loop).
    getActiveMcpTrace()?.phase("identity_failed", { code: cause });
    options.log?.(`identity failed (${cause}): ${message}`);
    try {
      worker?.cancel("failed");
    } catch {
      /* best effort */
    }
  };

  const onResolved = (identity: ResolvedIdentityMessage): void => {
    if (terminal || cancelled) return;
    // Deadline re-check at the activation boundary: a late worker result never
    // reactivates the connection.
    if (elapsedMs() >= timeoutMs) {
      fail("identity_timeout", `identity did not become ready within ${timeoutMs}ms`);
      return;
    }
    // Validate the returned key paths against the canonical layout for this
    // instance — NEVER read an arbitrary path the child claimed. An explicit
    // `--instance` override resolves with NO key paths (presence-only, no
    // signer); that is allowed and only skips this check.
    if (identity.privateKeyPath) {
      const expected = identityKeyPaths(options.request.root, identity.instance);
      if (
        identity.privateKeyPath !== expected.privateKeyPath ||
        identity.publicKeyPath !== expected.publicKeyPath
      ) {
        fail(
          "identity_proof_failed",
          "resolved identity key paths do not match the canonical layout"
        );
        return;
      }
    }
    let result: ActivationResult;
    try {
      result = options.activate(identity);
    } catch (err) {
      fail("session_open_failed", err instanceof Error ? err.message : String(err));
      return;
    }
    if (!result.ok) {
      fail(result.cause, result.message);
      return;
    }
    // F1: a FULLY-SUCCESSFUL activation is terminal-ready. We do NOT re-check the
    // deadline here: activation already opened the presence session, armed the
    // signer/wake and published the correlated readiness ACK — failing now would
    // leave a live ACK + presence + wake behind a `failed` state (a wedged
    // connection). The deadline is enforced BEFORE activation (above) and by the
    // parent timer; if activation itself fails, `activate` rolls its own partial
    // work back before returning `{ok:false}`.
    terminal = true;
    clearTimer();
    liveSigner = result.signer;
    state = {
      state: "identity_ready",
      attemptId,
      instance: identity.instance,
      sessionId: result.sessionId,
      signingAvailable: liveSigner !== undefined
    };
    getActiveMcpTrace()?.phase("identity_ready", {
      code: liveSigner ? "signing" : "presence_only"
    });
    options.log?.(
      `identity ready: ${identity.instance} (signing ${liveSigner ? "available" : "unavailable"})`
    );
  };

  return {
    status(): McpIdentityStatus {
      if (state.state === "identity_pending") {
        return { state: "identity_pending", attemptId, elapsedMs: elapsedMs(), timeoutMs: 20000 };
      }
      return state;
    },
    start(): void {
      if (state.state !== "identity_disabled") return;
      attemptId = randomAttemptId();
      startedNs = nowNs();
      state = { state: "identity_pending", attemptId, elapsedMs: 0, timeoutMs: 20000 };
      // L0 trace reuse: mark that identity entered the async pending window on the
      // parent (initialize/tools-list are already answerable — identity is NOT on
      // the boot critical path anymore, which is the #249 fix).
      getActiveMcpTrace()?.phase("identity_pending");
      deadlineTimer = setTimeout(() => {
        fail("identity_timeout", `identity did not become ready within ${timeoutMs}ms`);
      }, timeoutMs);
      deadlineTimer.unref?.();
      worker = spawnWorker(options.request, timeoutMs);
      worker.onError((cause, message) => fail(cause, message));
      worker.onExitWithoutResult(() =>
        fail("identity_worker_failed", "identity worker exited without a result")
      );
      worker.onResolved(onResolved);
    },
    cancel(reason): void {
      cancelled = true;
      clearTimer();
      try {
        worker?.cancel(reason);
      } catch {
        /* best effort */
      }
      // Transport is gone: no activation may follow. Keep the last observable
      // state for any in-flight status read, but disarm the signer.
      liveSigner = undefined;
    },
    signer(): H2ASendSigner | undefined {
      return liveSigner;
    }
  };
}
