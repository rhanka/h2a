/**
 * EVO-13 / feed-contract P1 step 4a — the mirror push as an OPT-IN live daemon.
 *
 * `h2a remote mirror` is a ONE-SHOT push (build → sign → POST once). The
 * ratified feed contract
 * (`docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md`,
 * Part C) needs that same push to run continuously on a 15–30s beat, so the
 * hosted read-only store stays warm for a UI that only ever pulls. A laptop
 * behind NAT cannot accept inbound, so the data path must be push — the daemon
 * is the pipeline, not a new trust boundary.
 *
 * This module changes NOTHING about what is pushed. It wraps the existing
 * one-shot cycle (`buildInstanceMirror` → `sendRemoteEnvelope`) in the same
 * supervisor idioms already shipped for the L1 objective loop
 * (`runtime/loop/supervisor.ts`): opt-in only, a global kill-switch, an
 * injectable clock, a drainable abort signal, and a per-beat summary that is
 * observability — never control. The signed-envelope trust boundary, the
 * payload shape, the sequence fencing and the accept-side verification are
 * untouched.
 *
 * Safety properties, in the order they matter:
 *
 *  - OPT-IN, NEVER DEFAULT-ON. Nothing here runs unless a caller explicitly
 *    asks for an interval. `h2a remote mirror` with no `--interval-ms` still
 *    takes the byte-identical one-shot path it took before this module existed.
 *    The global kill-switch `H2A_MIRROR_PUSH_OFF` hard-disables the loop even
 *    when a unit file or an operator asked for it — checked before the FIRST
 *    cycle, so a frozen daemon never emits a single request.
 *
 *  - AUTH FAILURE STOPS, IT DOES NOT RETRY FOREVER. A 401/403 means the
 *    receiving side does not trust this instance's signing key (never enrolled,
 *    revoked, or — the live case today — the agent re-anchored and mints a
 *    different keypair than the one enrolled). No amount of retrying fixes
 *    that: it needs a human re-enrollment ceremony. So consecutive auth
 *    rejections are backed off and then the daemon STOPS with an actionable
 *    message, instead of hammering a rejecting endpoint indefinitely. Only a
 *    genuinely accepted push (`ok`) clears the counter — a transient error in
 *    between does NOT, because "network flap between two 401s" must not be a
 *    way to loop forever against a server that is refusing us.
 *
 *  - NO OVERLAP. A push slower than the interval must not stack. The runner
 *    carries its own in-flight guard: a cycle requested while one is still
 *    running returns `skipped-overlap` without building or sending anything.
 *
 *  - NO DRIFT. Cycles are scheduled against a monotonic slot anchor
 *    (`anchor + n × interval`), not by sleeping a fixed interval after each
 *    cycle, so per-cycle duration does not accumulate into lateness. Slots
 *    already in the past are skipped rather than fired back-to-back. A small
 *    bounded jitter de-synchronises several agents pushing to one endpoint.
 *
 *  - TRANSIENT ERRORS KEEP LOOPING. A network throw, a 5xx or a 429 is the
 *    endpoint's problem, not ours: exponential backoff (capped), then carry on.
 *
 *  - DRAINABLE. `signal` is honored before each cycle and inside every sleep,
 *    so SIGTERM stops promptly instead of finishing the schedule.
 *
 *  - LOGS ARE SAFE BY CONSTRUCTION. The per-cycle line carries an outcome, an
 *    HTTP status, a closed-vocabulary rejection reason and a redacted endpoint.
 *    It NEVER carries key material, a token, a request body or a response body.
 *    Everything free-form (an error message) goes through `sanitizeForLog`.
 */

import type { H2AEnvelope } from "@sentropic/h2a";

import { createLocalStore } from "../local-files/index.js";
import { sendRemoteEnvelope } from "../remote/client.js";
import { buildInstanceMirror } from "./build.js";

/**
 * Default beat. The ratified contract asks for 15–30s; 20s sits in the middle
 * and keeps a UI's worst-case staleness under the 90s presence keepalive
 * window, so a `stale` row means the pipeline really is down.
 */
export const DEFAULT_MIRROR_PUSH_INTERVAL_MS = 20_000;

/**
 * Floor the CLI enforces on `--interval-ms`. The library itself accepts any
 * positive interval (tests drive it at millisecond speed against a fake
 * transport); the operator-facing surface refuses anything that would hammer a
 * hosted endpoint faster than the contract's own range.
 */
export const MIN_MIRROR_PUSH_INTERVAL_MS = 5_000;

/** Bounded de-synchronisation jitter, as a fraction of the interval (±10%). */
export const MIRROR_PUSH_JITTER_FRACTION = 0.1;

/** First transient-failure backoff; doubles per consecutive failure. */
export const MIRROR_PUSH_BACKOFF_BASE_MS = 5_000;

/** Backoff ceiling — a long outage retries every 5 min, not every 5 hours. */
export const MIRROR_PUSH_BACKOFF_MAX_MS = 300_000;

/**
 * How many CONSECUTIVE auth rejections are tolerated (each backed off) before
 * the daemon stops. 3 absorbs a key-rotation race on the accept side while
 * still stopping in well under a minute of real rejection.
 */
export const DEFAULT_MIRROR_AUTH_FAILURE_LIMIT = 3;

/** Name of the global kill-switch env var. */
export const MIRROR_PUSH_OFF_ENV = "H2A_MIRROR_PUSH_OFF";

/**
 * Global kill-switch for the live mirror push. When `H2A_MIRROR_PUSH_OFF` is
 * set to any non-empty, non-"0"/"false" value, NO mirror push daemon runs
 * anywhere, regardless of flags or unit files. Same semantics as
 * `H2A_LOOP_AUTOTICK_OFF` for the objective-loop supervisor — one lever to
 * freeze the pipeline without editing any invocation.
 */
export function mirrorPushGloballyDisabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = env[MIRROR_PUSH_OFF_ENV];
  if (v === undefined) return false;
  const norm = v.trim().toLowerCase();
  return norm !== "" && norm !== "0" && norm !== "false";
}

/**
 * The actionable message emitted when the daemon stops on repeated auth
 * rejection. Deliberately explicit: the failure is NOT retryable and the
 * operator must know exactly which human act unblocks it.
 */
export const MIRROR_PUSH_REENROLLMENT_MESSAGE =
  "mirror push STOPPED: the endpoint rejected this instance's signing key (HTTP 401/403) on every attempt. " +
  "This is not a transient error and retrying cannot fix it — the key is not enrolled on the receiving side " +
  "(never enrolled, revoked, or the agent re-anchored and now signs with a different keypair). " +
  "RE-ENROLLMENT IS REQUIRED: enroll this instance's CURRENT public key on the receiving side, then restart the daemon. " +
  "Nothing further will be pushed until then.";

/** What one cycle did. `skipped-overlap` performed no build and no request. */
export type MirrorPushOutcome =
  | "ok"
  | "auth-rejected"
  | "rejected"
  | "transient"
  | "build-failed"
  | "skipped-overlap";

/** Why the daemon returned. Every reason is a clean, intentional stop. */
export type MirrorPushStopReason =
  | "max-cycles"
  | "aborted"
  | "kill-switch"
  | "auth-stop";

export interface MirrorPushCycleResult {
  readonly outcome: MirrorPushOutcome;
  /** HTTP status, when a request actually completed. */
  readonly status?: number;
  /** Closed-vocabulary accept-side rejection reason, when the body carried one. */
  readonly reason?: string;
  /** Sanitized error text for `transient` / `build-failed`. Never secrets. */
  readonly error?: string;
  readonly durationMs: number;
}

/** The one-line-per-cycle status record. Safe to journal verbatim. */
export interface MirrorPushCycleLog {
  readonly cycle: number;
  readonly at: string;
  readonly instance: string;
  /** Redacted endpoint: scheme + host + path only. No query, no userinfo. */
  readonly endpoint: string;
  readonly outcome: MirrorPushOutcome;
  readonly status?: number;
  readonly reason?: string;
  readonly error?: string;
  readonly durationMs: number;
  /** Sleep before the next cycle. Absent when the daemon is stopping. */
  readonly nextInMs?: number;
  /** Consecutive auth rejections so far — 0 unless the key is being refused. */
  readonly authFailures?: number;
}

export interface MirrorPushDaemonSummary {
  readonly cycles: number;
  /** Cycles the endpoint accepted (2xx). */
  readonly ok: number;
  /** Cycles that did not push successfully (any non-ok, non-skipped outcome). */
  readonly failures: number;
  /** Cycles skipped because a previous push was still in flight. */
  readonly skippedOverlap: number;
  /** Consecutive auth rejections at stop time. */
  readonly authFailures: number;
  readonly stopReason: MirrorPushStopReason;
  /** Present only on `auth-stop`: {@link MIRROR_PUSH_REENROLLMENT_MESSAGE}. */
  readonly message?: string;
}

/** Builds the (unsigned) mirror envelope for a given clock reading. */
export type MirrorEnvelopeBuilder = (nowMs: number) => H2AEnvelope;

/** Signs + POSTs the envelope. Injected in tests; never a real socket there. */
export type MirrorEnvelopeSender = (
  url: string,
  envelope: H2AEnvelope,
  options: { by: string; privateKeyPem: string }
) => Promise<{ status: number; body: unknown }>;

/** Accept-side rejection vocabulary (`runtime/mirror/accept.ts`). */
const MIRROR_REJECTION_REASONS = new Set([
  "malformed",
  "not-mirror",
  "no-signature",
  "unauthorized-key",
  "bad-signature",
  "invalid-timestamp",
  "expired",
  "future",
  "replayed",
  "stale-sequence",
  "instance-key-mismatch"
]);

/**
 * Strip anything that could be secret out of free-form text before it is
 * logged. Defence in depth: nothing here is SUPPOSED to see key material, but a
 * thrown error can carry whatever the thrower put in it, and this daemon holds a
 * private key in memory. PEM blocks, bearer tokens and token-ish query params
 * are replaced; the result is length-capped so a giant blob cannot be smuggled
 * out one line at a time.
 */
export function sanitizeForLog(text: string): string {
  return text
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted-key]")
    .replace(/-----BEGIN[\s\S]*/g, "[redacted-key]")
    .replace(/\b(bearer)\s+[\w.\-+/=]+/gi, "$1 [redacted]")
    .replace(/\b(token|key|secret|password|signature|apikey|api_key)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 300);
}

/**
 * Reduce a URL to scheme + host + path. Drops query and userinfo, which are the
 * two places a credential can hide in a URL, and keeps enough for an operator to
 * recognise which endpoint is being pushed to.
 */
export function redactEndpoint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "[unparseable-url]";
  }
}

/** True for a status that means "your key is not trusted here". */
function isAuthRejection(status: number): boolean {
  return status === 401 || status === 403;
}

/** True for a status worth retrying: server-side or rate-limit. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Pull the closed-vocabulary rejection reason out of an accept-side body. */
function rejectionReasonOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const reason = (body as { reason?: unknown }).reason;
  if (typeof reason === "string" && MIRROR_REJECTION_REASONS.has(reason)) return reason;
  return undefined;
}

export interface MirrorPushRunnerOptions {
  /** h2a root the mirror is built from. */
  readonly root: string;
  /** Endpoint to POST the signed envelope to. */
  readonly url: string;
  /** Instance whose registration + presence is mirrored (also the signer). */
  readonly instance: string;
  /** Signer's ed25519 private-key PEM. Never logged, never sent. */
  readonly privateKeyPem: string;
  /** Injectable clock (ms). Default `Date.now`. */
  readonly now?: () => number;
  /** Injectable envelope builder. Default the real `buildInstanceMirror`. */
  readonly buildImpl?: MirrorEnvelopeBuilder;
  /** Injectable transport. Default the real `sendRemoteEnvelope`. */
  readonly sendImpl?: MirrorEnvelopeSender;
}

/**
 * Create the guarded one-cycle runner: build → sign → POST once, classified.
 *
 * The returned function is the ONLY thing that touches the network, and it
 * carries the overlap guard: while one cycle is in flight, a second call
 * returns `skipped-overlap` immediately without building an envelope or
 * issuing a request. Exposed so a caller (or a test) can drive single cycles
 * without the timer loop — exactly as `runSupervisorBeat` is exposed next to
 * `runLoopSupervisor`.
 *
 * Never throws: every failure is classified into a {@link MirrorPushOutcome}.
 */
export function createMirrorPushRunner(
  options: MirrorPushRunnerOptions
): () => Promise<MirrorPushCycleResult> {
  const nowFn = options.now ?? ((): number => Date.now());
  const build =
    options.buildImpl ??
    ((nowMs: number): H2AEnvelope =>
      buildInstanceMirror(createLocalStore({ root: options.root }), options.instance, nowMs));
  const send = options.sendImpl ?? sendRemoteEnvelope;

  let inFlight = false;

  return async function runCycle(): Promise<MirrorPushCycleResult> {
    // OVERLAP GUARD: a slow push must not stack. Checked before any work, so a
    // skipped cycle costs nothing and, crucially, sends nothing.
    if (inFlight) return { outcome: "skipped-overlap", durationMs: 0 };
    inFlight = true;
    const startedAt = nowFn();
    try {
      let envelope: H2AEnvelope;
      try {
        envelope = build(startedAt);
      } catch (error) {
        // Local build failure (e.g. the instance is not in this root's
        // registry). Not fatal: an agent can re-register, so we back off and
        // keep looping rather than tearing the daemon down. No request was made.
        return {
          outcome: "build-failed",
          error: sanitizeForLog((error as Error).message),
          durationMs: nowFn() - startedAt
        };
      }

      let status: number;
      let body: unknown;
      try {
        const res = await send(options.url, envelope, {
          by: options.instance,
          privateKeyPem: options.privateKeyPem
        });
        status = res.status;
        body = res.body;
      } catch (error) {
        // Transport threw: DNS, refused, TLS, timeout. Retryable.
        return {
          outcome: "transient",
          error: sanitizeForLog((error as Error).message),
          durationMs: nowFn() - startedAt
        };
      }

      const durationMs = nowFn() - startedAt;
      const reason = rejectionReasonOf(body);
      if (status >= 200 && status < 300) {
        return { outcome: "ok", status, durationMs };
      }
      if (isAuthRejection(status)) {
        // The key itself is refused. Counted toward the stop budget.
        return { outcome: "auth-rejected", status, ...(reason ? { reason } : {}), durationMs };
      }
      if (isTransientStatus(status)) {
        return { outcome: "transient", status, ...(reason ? { reason } : {}), durationMs };
      }
      // Other 4xx: a rejected envelope (stale sequence, replay, clock skew).
      // Some of these self-heal as the sequence advances, so we keep looping —
      // but backed off, so a permanently malformed push is not a hot loop.
      return { outcome: "rejected", status, ...(reason ? { reason } : {}), durationMs };
    } finally {
      inFlight = false;
    }
  };
}

export interface MirrorPushDaemonOptions extends MirrorPushRunnerOptions {
  /** Beat interval. Default {@link DEFAULT_MIRROR_PUSH_INTERVAL_MS}. */
  readonly intervalMs?: number;
  /** Stop after this many cycles (testing / bounded ops runs). */
  readonly max?: number;
  /** Abort to stop the daemon between cycles and inside every sleep. */
  readonly signal?: AbortSignal;
  /** Environment for the kill-switch. Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Injectable randomness for the jitter. Default `Math.random`. */
  readonly random?: () => number;
  /** Injectable sleep, so tests advance a fake clock instead of waiting. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Consecutive auth rejections tolerated. Default {@link DEFAULT_MIRROR_AUTH_FAILURE_LIMIT}. */
  readonly authFailureLimit?: number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  /** Pre-built runner (shares one overlap guard across callers). */
  readonly runner?: () => Promise<MirrorPushCycleResult>;
  /** Called once per cycle with the safe status line. */
  readonly onCycle?: (log: MirrorPushCycleLog) => void | Promise<void>;
}

/** Abort-aware sleep. Resolves early (does not reject) when aborted. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run the live mirror push until `signal` aborts, `max` cycles elapse, or the
 * endpoint has refused this key often enough to stop (see
 * {@link MIRROR_PUSH_REENROLLMENT_MESSAGE}).
 *
 * This is what the systemd `--user` unit runs. It is NEVER on any default code
 * path: no caller reaches it without an explicit interval, and the kill-switch
 * short-circuits it before the first request.
 */
export async function runMirrorPushDaemon(
  options: MirrorPushDaemonOptions
): Promise<MirrorPushDaemonSummary> {
  const env = options.env ?? process.env;
  const nowFn = options.now ?? ((): number => Date.now());
  const random = options.random ?? ((): number => Math.random());
  const sleep = options.sleep ?? delay;
  const intervalMs =
    options.intervalMs && options.intervalMs > 0
      ? options.intervalMs
      : DEFAULT_MIRROR_PUSH_INTERVAL_MS;
  const authLimit =
    options.authFailureLimit && options.authFailureLimit > 0
      ? options.authFailureLimit
      : DEFAULT_MIRROR_AUTH_FAILURE_LIMIT;
  const backoffBase =
    options.backoffBaseMs && options.backoffBaseMs > 0
      ? options.backoffBaseMs
      : MIRROR_PUSH_BACKOFF_BASE_MS;
  const backoffMax =
    options.backoffMaxMs && options.backoffMaxMs > 0
      ? options.backoffMaxMs
      : MIRROR_PUSH_BACKOFF_MAX_MS;
  const endpoint = redactEndpoint(options.url);

  let cycles = 0;
  let ok = 0;
  let failures = 0;
  let skippedOverlap = 0;
  let authFailures = 0;
  let consecutiveFailures = 0;

  const finish = (
    stopReason: MirrorPushStopReason,
    message?: string
  ): MirrorPushDaemonSummary => ({
    cycles,
    ok,
    failures,
    skippedOverlap,
    authFailures,
    stopReason,
    ...(message ? { message } : {})
  });

  // KILL-SWITCH, checked BEFORE the first cycle: a frozen daemon must not emit
  // a single request, not even one.
  if (mirrorPushGloballyDisabled(env)) return finish("kill-switch");
  if (options.signal?.aborted) return finish("aborted");

  const runCycle = options.runner ?? createMirrorPushRunner(options);

  // Monotonic slot anchor — cycle n is due at `anchor + n × intervalMs`, so a
  // slow cycle does not push every later cycle late (no drift). Re-anchored
  // after a backoff, whose delay is deliberate rather than lateness.
  let anchor = nowFn();
  let slot = 0;

  for (;;) {
    // Re-checked each cycle so a mutated environment freezes an already-running
    // daemon at the next beat instead of only at (re)start.
    if (mirrorPushGloballyDisabled(env)) return finish("kill-switch");
    if (options.signal?.aborted) return finish("aborted");

    const result = await runCycle();
    cycles += 1;

    if (result.outcome === "skipped-overlap") {
      skippedOverlap += 1;
    } else if (result.outcome === "ok") {
      ok += 1;
      consecutiveFailures = 0;
      // Only a genuinely ACCEPTED push clears the auth budget.
      authFailures = 0;
    } else {
      failures += 1;
      consecutiveFailures += 1;
      if (result.outcome === "auth-rejected") authFailures += 1;
    }

    const emit = async (nextInMs?: number): Promise<void> => {
      await options.onCycle?.({
        cycle: cycles,
        at: new Date(nowFn()).toISOString(),
        instance: options.instance,
        endpoint,
        outcome: result.outcome,
        ...(result.status !== undefined ? { status: result.status } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.error ? { error: result.error } : {}),
        durationMs: result.durationMs,
        ...(nextInMs !== undefined ? { nextInMs } : {}),
        authFailures
      });
    };

    // AUTH STOP: the budget is spent, so stop instead of hammering a server
    // that is refusing this key. Backoff already happened between attempts.
    if (authFailures >= authLimit) {
      await emit(undefined);
      return finish("auth-stop", MIRROR_PUSH_REENROLLMENT_MESSAGE);
    }

    if (options.max !== undefined && cycles >= options.max) {
      await emit(undefined);
      return finish("max-cycles");
    }
    if (options.signal?.aborted) {
      await emit(undefined);
      return finish("aborted");
    }

    // Schedule the next cycle: backoff after a failure, otherwise the next
    // monotonic slot with bounded jitter.
    let waitMs: number;
    if (consecutiveFailures > 0) {
      const exp = Math.min(backoffMax, backoffBase * 2 ** (consecutiveFailures - 1));
      waitMs = Math.max(0, Math.round(exp * (1 + MIRROR_PUSH_JITTER_FRACTION * (random() * 2 - 1))));
      // The backoff wait is intentional, so the drift anchor restarts from here.
      anchor = nowFn() + waitMs;
      slot = 0;
    } else {
      slot += 1;
      let due = anchor + slot * intervalMs;
      // A cycle that overran one or more whole slots must not fire the missed
      // ones back-to-back: skip straight to the next slot in the future.
      while (due <= nowFn()) {
        slot += 1;
        due = anchor + slot * intervalMs;
      }
      const jitter = intervalMs * MIRROR_PUSH_JITTER_FRACTION * (random() * 2 - 1);
      waitMs = Math.max(0, Math.round(due - nowFn() + jitter));
    }

    await emit(waitMs);
    await sleep(waitMs, options.signal);
    if (options.signal?.aborted) return finish("aborted");
  }
}
