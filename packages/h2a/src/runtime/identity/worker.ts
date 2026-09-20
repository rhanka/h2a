/**
 * L2 identity worker — the dedicated, non-detached child that resolves the
 * shared identity OFF the parent's MCP event loop.
 *
 * It receives ONE typed request over IPC, runs the canonical async resolution
 * (the same writer path as the CLI — `resolveLiveIdentityAsync`, whose only
 * append of a binding row is `reclaimOrMint*`), and returns ONE response. It
 * publishes NO presence, NO tool signature, NO wake, NO readiness ACK; those are
 * the parent's job after it validates the result. No PEM ever crosses IPC — only
 * paths, which the parent re-validates against the canonical key layout.
 *
 * It is argv-only (the request arrives over IPC), stdout is ignored (it must
 * never emit protocol traffic), and diagnostics go to stderr. A cancel makes it
 * stop starting any NEW transaction (cooperative); a transaction already entered
 * under a lock finishes so no half-written binding is left, and the lock is
 * released in the resolver's `finally`.
 */

import { resolveLiveIdentityAsync } from "./live.js";
import type { ResolveLiveIdentityInput } from "./live.js";
import { LockCancelledError, LockTimeoutError } from "../local-files/locks.js";
import { createMcpTrace, setActiveMcpTrace } from "../mcp/phase-trace.js";

interface ResolveRequest {
  readonly kind: "resolve_identity";
  readonly v: 1;
  readonly request: {
    readonly root: string;
    readonly host: string;
    readonly cwd: string;
    readonly explicitInstance?: string;
    readonly name?: string;
    readonly scopes?: readonly string[];
    readonly declaredCapabilities?: readonly string[];
  };
  readonly budgetMs: number;
  /** Parent trace's attemptId so the child's L0 spans correlate (role=identity-child). */
  readonly traceAttemptId?: string;
}

type IdentityFailureCode =
  | "identity_timeout"
  | "storage_readonly"
  | "storage_permission_denied"
  | "identity_worker_failed"
  | "identity_proof_failed"
  | "identity_storage_failed"
  | "session_open_failed"
  | "readiness_ack_failed";

function classify(err: unknown): { cause: IdentityFailureCode; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof LockCancelledError) {
    return { cause: "identity_timeout", message };
  }
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EROFS") return { cause: "storage_readonly", message };
  if (code === "EACCES" || code === "EPERM") return { cause: "storage_permission_denied", message };
  if (err instanceof Error && err.name === "LockTimeoutError") {
    return { cause: "identity_timeout", message };
  }
  // A generic durable-store write failure vs. an unexpected worker fault.
  if (code === "ENOSPC" || code === "EIO") return { cause: "identity_storage_failed", message };
  return { cause: "identity_worker_failed", message };
}

function send(message: unknown): void {
  try {
    process.send?.(message);
  } catch {
    /* the parent may have closed the channel; nothing more we can do */
  }
}

const abort = new AbortController();
let handled = false;

process.on("message", (raw: unknown) => {
  const msg = raw as { kind?: string } | undefined;
  if (!msg || typeof msg !== "object") return;
  if (msg.kind === "cancel") {
    // Cooperative: stop before any NEW transaction. A transaction already under a
    // lock finishes; its `finally` releases the lock.
    abort.abort((msg as { reason?: string }).reason ?? "cancel");
    send({ kind: "cancel_ack", v: 1 });
    return;
  }
  if (msg.kind !== "resolve_identity" || handled) return;
  handled = true;
  const req = msg as ResolveRequest;
  // L0 (#249): relocate the identity/lock/registry instrumentation that used to
  // run on the parent. Installing a correlated `identity-child` trace (same
  // attemptId as the parent) makes resolveLiveIdentityAsync's provider/keys/
  // register/alias spans, the registry_read span, and the binding-lock spans
  // fire HERE (on the worker's stderr, which the parent forwards line by line),
  // instead of being silently lost when resolution moved off the parent loop.
  setActiveMcpTrace(
    createMcpTrace({
      role: "identity-child",
      ...(req.traceAttemptId !== undefined ? { attemptId: req.traceAttemptId } : {}),
      pid: process.pid
    })
  );
  const input: ResolveLiveIdentityInput = {
    root: req.request.root,
    host: req.request.host,
    cwd: req.request.cwd,
    ...(req.request.explicitInstance !== undefined
      ? { explicitInstance: req.request.explicitInstance }
      : {}),
    ...(req.request.name !== undefined ? { name: req.request.name } : {}),
    ...(req.request.scopes !== undefined ? { scopes: req.request.scopes } : {}),
    ...(req.request.declaredCapabilities !== undefined
      ? { declaredCapabilities: req.request.declaredCapabilities }
      : {})
  };
  const budgetMs = Number.isFinite(req.budgetMs) && req.budgetMs > 0 ? req.budgetMs : 20_000;
  const startNs = process.hrtime.bigint();
  const remainingMs = (): number =>
    budgetMs - Number((process.hrtime.bigint() - startNs) / 1_000_000n);

  const cancellableDelay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (abort.signal.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });

  // Retry on CONTENTION (a live lock holder) until the budget, ceding the event
  // loop between attempts so an IPC cancel is honored; the parent's 20 s deadline
  // is authoritative. A PERMANENT error (EROFS / EACCES / …) is NOT retried — it
  // is the failure. `reclaimOrMint*` stays the unique binding writer across
  // attempts; a contended attempt writes no binding (it releases the lock first).
  // Shared across attempts: the mint candidate is generated once (no keypair
  // leak) and the expensive OUTSIDE-lock reads are parsed once (no re-parse of
  // the ~17 MB registry per retry under contention).
  const mintMemo: { value?: { instance: string; agentUuid: string } } = {};
  const prepCache: { prepared?: unknown } = {};
  let attempt = 0;
  const resolveWithRetry = async () => {
    while (!abort.signal.aborted) {
      const budget = remainingMs();
      if (budget <= 0) throw new LockTimeoutError("identity", undefined, budgetMs);
      try {
        return await resolveLiveIdentityAsync(input, {
          signal: abort.signal,
          deadlineMs: budget,
          // Fail a contended registration fast so the identity lock is not held
          // through a long registry wait; the loop retries outside the section.
          registryLockTimeoutMs: 250,
          mintMemo,
          prepCache,
          attempt
        });
      } catch (err) {
        attempt += 1;
        if (abort.signal.aborted) throw err;
        if (err instanceof LockTimeoutError && remainingMs() > 0) {
          await cancellableDelay(200);
          continue;
        }
        throw err;
      }
    }
    throw new LockCancelledError("identity", "cancelled");
  };

  void resolveWithRetry()
    .then((identity) => {
      send({
        kind: "identity_resolved",
        v: 1,
        identity: {
          instance: identity.instance,
          host: identity.host,
          ...(identity.workspace !== undefined ? { workspace: identity.workspace } : {}),
          ...(identity.name !== undefined ? { name: identity.name } : {}),
          action: identity.action,
          ...(identity.providerSessionId !== undefined
            ? { providerSessionId: identity.providerSessionId }
            : {}),
          ...(identity.providerSessionSource !== undefined
            ? { providerSessionSource: identity.providerSessionSource }
            : {}),
          // Paths only — the parent re-validates them against identityKeyPaths.
          privateKeyPath: identity.privateKeyPath ?? "",
          publicKeyPath: identity.publicKeyPath ?? "",
          ...(identity.migrationNotice !== undefined
            ? { migrationNotice: identity.migrationNotice }
            : {}),
          ...(identity.legacyInstance !== undefined
            ? { legacyInstance: identity.legacyInstance }
            : {}),
          // Only a locally-derived identity (no explicit --instance) may attest a
          // delegation; an explicit label never becomes an ownership attestation.
          delegationEligible: req.request.explicitInstance === undefined
        }
      });
    })
    .catch((err) => {
      const { cause, message } = classify(err);
      send({ kind: "identity_error", v: 1, cause, message });
    })
    .finally(() => {
      // The worker's whole job is one resolution; exit so no orphan lingers to
      // start another transaction. Give the IPC a tick to flush.
      setTimeout(() => process.exit(0), 10).unref?.();
    });
});

// If the parent's channel closes before a result, exit rather than linger.
process.on("disconnect", () => {
  abort.abort("disconnect");
  setTimeout(() => process.exit(0), 50).unref?.();
});
