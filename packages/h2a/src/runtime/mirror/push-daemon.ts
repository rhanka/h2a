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
 *  - NO OVERLAP. The daemon cannot overlap itself: it awaits each cycle before
 *    scheduling the next, so a slow push delays the next beat rather than
 *    stacking on top of it (and the slot arithmetic below then skips the beats
 *    that were missed). The exported runner ALSO carries an in-flight guard, for
 *    the different case of two concurrent callers sharing one runner: the second
 *    gets `skipped-overlap` without building or sending anything. That guard is
 *    defence for external callers, not what protects the daemon's own loop.
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
 *  - A STATUS MUST NOT BE WIDER THAN ITS EVIDENCE. The dividing line for every
 *    stop rule above is "can this self-heal": a network outage can, a refused
 *    key / a refused request / a root that cannot build this instance's mirror
 *    cannot. The non-self-healing cases therefore TERMINATE rather than idle,
 *    because idling would make this process the dishonest layer. Consider a
 *    wrong `H2A_ROOT`: nothing is ever sent, so the feed downstream correctly
 *    starts reporting those rows `stale` once `mirroredAt` stops advancing —
 *    while `systemctl status` would still read `active (running)`. The two
 *    layers would disagree and the only honest signal would be the one FURTHEST
 *    from the operator, in a UI nobody is watching. The signal nearest the fault
 *    has to be at least as honest as the far one, so we exit 1 and say why.
 *    Correspondingly, the per-cycle line reports what the push CONTAINED (seq +
 *    counts), so a successful push of an empty mirror is never mistaken for a
 *    healthy feed.
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

/**
 * How many CONSECUTIVE non-auth rejections (a 4xx that is not 401/403) are
 * tolerated before the daemon stops. Some of these genuinely self-heal — a
 * stale-sequence or replay rejection clears as `seq` advances — which is why the
 * budget is looser than the auth one. But a permanently malformed request or a
 * wrong path returning 404 will never heal, and retrying it forever is the same
 * failure mode as retrying a refused key: a unit that reads "active (running)"
 * while pushing nothing. 5 tolerates a real fencing race, then stops.
 */
export const DEFAULT_MIRROR_REJECT_LIMIT = 5;

/**
 * How many CONSECUTIVE local build failures are tolerated before the daemon
 * stops. `buildInstanceMirror` throwing means this root does not know this
 * instance — overwhelmingly because `H2A_ROOT` points somewhere the agent never
 * registered, the misconfiguration the shipped unit file explicitly warns about.
 * A wrong root NEVER self-heals, and looping on it forever is the worst possible
 * failure shape: no request is ever sent, yet `systemctl status` reads
 * `active (running)` indefinitely, so monitoring keyed on systemd state reads
 * green while the feed is dead. It must terminate loudly instead. 5 leaves room
 * for a genuinely transient race (an agent re-registering, a root being created).
 *
 * The contract-level argument (from the feed contract's own architect): in this
 * failure mode the feed WOULD report `stale` correctly, because `mirroredAt` stops
 * advancing — so the honest signal exists, but only at the layer furthest from the
 * operator. Idling here would ship a daemon that claims health next to a contract
 * written specifically to refuse claiming it.
 */
export const DEFAULT_MIRROR_BUILD_FAILURE_LIMIT = 5;

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
 * Emitted when the daemon stops because the endpoint keeps rejecting the request
 * itself (not the key). Like the auth stop, retrying cannot fix a permanently
 * malformed request or a wrong path.
 */
export const MIRROR_PUSH_REJECTED_MESSAGE =
  "mirror push STOPPED: the endpoint rejected this mirror on every attempt with a 4xx that is not an auth failure. " +
  "The request itself is being refused, so retrying cannot fix it — check that --url points at the ingester's mirror path " +
  "(a wrong path typically answers 404) and that this instance's clock is accurate (a skewed clock is refused as expired/future). " +
  "The per-cycle status lines carry the endpoint and the rejection reason. Nothing further will be pushed until the daemon is restarted.";

/**
 * Emitted when the daemon is asked to push to something that is not a usable
 * http(s) endpoint. Returned BEFORE any cycle runs, because a URL `fetch` cannot
 * even parse would otherwise be retried forever as a transient network failure.
 */
/**
 * Emitted when the daemon stops because it cannot even BUILD a mirror locally.
 * Names the likely cause, because this failure never reaches the network and so
 * leaves no server-side trace for the operator to correlate against.
 */
export const MIRROR_PUSH_BUILD_FAILED_MESSAGE =
  "mirror push STOPPED: this h2a root does not know the instance being mirrored, on every attempt. " +
  "Nothing was ever sent, and this cannot self-heal by retrying. " +
  "Check that --instance names an instance registered in THIS root and that H2A_ROOT / --root points at the root where that agent actually registers " +
  "(h2a discover --root <root> lists them). Nothing further will be pushed until the daemon is restarted.";

export const MIRROR_PUSH_INVALID_URL_MESSAGE =
  "mirror push NOT STARTED: the push target is not a usable http(s) URL, so no request could ever succeed. " +
  "Set --url to the ingester's full mirror endpoint (for example https://host/h2a/mirror). " +
  "If this is a systemd unit, its ExecStart placeholder was not filled in.";

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

/**
 * Why the daemon returned. Every reason is a clean, intentional stop — the
 * daemon never falls out of its loop by accident.
 *
 * `auth-stop`, `reject-stop`, `build-stop` and `config-invalid` are the four
 * that need a human act; they are exactly the reasons that carry a `message`,
 * and the CLI turns any `message` into exit 1 so systemd keeps the unit stopped.
 * `log-unavailable` is a CLEAN stop (no message, exit 0): the status sink went
 * away — a piped stdout closed — so the daemon stops rather than keep pushing
 * with no way to report what it is doing.
 */
export type MirrorPushStopReason =
  | "max-cycles"
  | "aborted"
  | "kill-switch"
  | "auth-stop"
  | "reject-stop"
  | "build-stop"
  | "config-invalid"
  | "log-unavailable";

export interface MirrorPushCycleResult {
  readonly outcome: MirrorPushOutcome;
  /** HTTP status, when a request actually completed. */
  readonly status?: number;
  /** Closed-vocabulary accept-side rejection reason, when the body carried one. */
  readonly reason?: string;
  /** Sanitized error text for `transient` / `build-failed`. Never secrets. */
  readonly error?: string;
  readonly durationMs: number;
  /**
   * What the pushed envelope actually CONTAINED. All non-secret: a monotonic
   * sequence number and three cardinalities, never a body.
   *
   * Without these, a `200` says only "the endpoint accepted something" — a valid
   * root whose instance has no live sessions pushes `presence: []` every cycle
   * and logs a perfectly healthy `ok`, while the hosted UI shows nothing. These
   * make "successfully pushed nothing" distinguishable from "pushed the mirror".
   */
  readonly payload?: MirrorPushPayloadShape;
}

/** Non-secret shape of one pushed mirror: what it carried, never its content. */
export interface MirrorPushPayloadShape {
  /** Per-instance monotonic sequence the receiver fences on. */
  readonly seq?: number;
  readonly registrations: number;
  readonly presence: number;
  readonly subagents: number;
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
  /** Consecutive non-auth rejections so far — 0 unless the request is refused. */
  readonly rejections?: number;
  /** Consecutive local build failures so far — 0 unless the root is wrong. */
  readonly buildFailures?: number;
  /** Sequence number of the pushed envelope (fencing anchor). */
  readonly seq?: number;
  /** How many registrations the pushed mirror carried. */
  readonly registrations?: number;
  /** How many presence sessions it carried — 0 means "pushed an empty mirror". */
  readonly presence?: number;
  /** How many subagent bindings it carried. */
  readonly subagents?: number;
}

export interface MirrorPushDaemonSummary {
  readonly cycles: number;
  /** Cycles the endpoint accepted (2xx). */
  readonly ok: number;
  /** Cycles that did not push successfully (any non-ok, non-skipped outcome). */
  readonly failures: number;
  /**
   * Cycles skipped because a previous push was still in flight. Always 0 for the
   * daemon itself, which awaits each cycle and therefore cannot overlap itself;
   * non-zero only when a `runner` is shared with another concurrent caller.
   */
  readonly skippedOverlap: number;
  /** Consecutive auth rejections at stop time. */
  readonly authFailures: number;
  /** Consecutive non-auth rejections at stop time. */
  readonly rejections: number;
  /** Consecutive local build failures at stop time. */
  readonly buildFailures: number;
  /**
   * Times the status sink (`onCycle`) threw. Never affects the push itself —
   * observability failures are counted, not propagated — but a non-zero value
   * means the journal is an incomplete record of what this daemon did.
   */
  readonly logFailures: number;
  readonly stopReason: MirrorPushStopReason;
  /**
   * The actionable instruction for a stop that needs a human act. Present on
   * exactly the four such stops — `auth-stop`
   * ({@link MIRROR_PUSH_REENROLLMENT_MESSAGE}), `reject-stop`
   * ({@link MIRROR_PUSH_REJECTED_MESSAGE}), `build-stop`
   * ({@link MIRROR_PUSH_BUILD_FAILED_MESSAGE}) and `config-invalid`
   * ({@link MIRROR_PUSH_INVALID_URL_MESSAGE}) — and absent on the clean stops
   * (`max-cycles`, `aborted`, `kill-switch`, `log-unavailable`). Its presence is
   * what the CLI keys exit 1 on, so systemd's `RestartPreventExitStatus=1` keeps
   * the unit stopped instead of restarting into the same wall.
   */
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
  return (
    text
      .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted-key]")
      .replace(/-----BEGIN[\s\S]*/g, "[redacted-key]")
      // URL userinfo (https://user:password@host) anywhere in free-form text.
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
      .replace(/\b(bearer|basic)\s+[\w.\-+/=]+/gi, "$1 [redacted]")
      // Credential-ish parameters. The name prefix is matched explicitly rather
      // than with `\b`, because `\b` does not fire after an underscore — which
      // let every `access_token=` / `session_key=` form through untouched.
      .replace(
        /([\w.-]*(?:token|key|secret|password|passwd|signature|credential)s?)=([^&\s]+)/gi,
        "$1=[redacted]"
      )
      // HEADER form (`X-Api-Key: literal`, `cookie: sid=…`). The `name=value`
      // rule above cannot see these, because the delimiter is a colon.
      .replace(
        /^([ \t]*[\w-]*(?:token|key|secret|password|passwd|auth|authorization|cookie|credential)s?)[ \t]*:[ \t]*\S.*$/gim,
        "$1: [redacted]"
      )
      .slice(0, 300)
  );
}

/**
 * Text of a caught value, for a value that is NOT guaranteed to be an `Error`.
 * A rejection can carry anything — a string, an object, `undefined` from a bare
 * `Promise.reject()` — and this daemon's whole contract is that a cycle never
 * throws. Reading `.message` off a non-Error would itself throw, escape the
 * classifier, and land in the CLI's unsanitized fatal handler.
 *
 * EVERY read is inside the `try`, deliberately. Accessing `.message` is not a
 * safe operation: it can be a getter that throws (including on a real `Error`
 * subclass), so a guard that only wraps the `String()` fallback still lets a
 * hostile object escape. The whole inspection is therefore fallible-by-default.
 */
function errorText(error: unknown): string {
  try {
    if (error instanceof Error && typeof error.message === "string") return error.message;
    const message = (error as { message?: unknown } | null | undefined)?.message;
    if (typeof message === "string") return message;
    return String(error);
  } catch {
    // A hostile `message` getter or `toString` still must not break the cycle.
    return "[unrepresentable error]";
  }
}

/**
 * True when a logging failure means the status sink is GONE for good rather than
 * momentarily unhappy — a closed or destroyed stream. A piped stdout that the
 * reader closed (`| head -3`, a journald restart) surfaces as EPIPE and never
 * reopens, so the honest response is to stop, not to keep pushing unobservably.
 */
function isClosedStreamError(error: unknown): boolean {
  let code: unknown;
  try {
    code = (error as { code?: unknown } | null | undefined)?.code;
  } catch {
    return false;
  }
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END";
}

/**
 * Read the non-secret shape of the envelope about to be pushed: its sequence
 * number and the cardinality of each collection. Never its contents. Defensive
 * about shape, because a caller can inject any `buildImpl`.
 */
function payloadShapeOf(envelope: H2AEnvelope): MirrorPushPayloadShape {
  const body = (envelope as { body?: unknown }).body as
    | {
        seq?: unknown;
        registrations?: unknown;
        presence?: unknown;
        subagents?: unknown;
      }
    | undefined;
  const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  return {
    ...(typeof body?.seq === "number" ? { seq: body.seq } : {}),
    registrations: count(body?.registrations),
    presence: count(body?.presence),
    subagents: count(body?.subagents)
  };
}

/**
 * True when `url` is something a push could actually reach: parseable, and
 * http(s). Anything else — an unfilled placeholder, a typo, a `file:` or `ws:`
 * scheme — makes `fetch` throw a parse error that would otherwise be classified
 * as a retryable network failure and retried forever.
 */
export function isPushableHttpUrl(url: string | undefined): boolean {
  if (typeof url !== "string" || url.trim() === "") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
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
 * The returned function is the ONLY thing that touches the network. It carries an
 * in-flight guard for CONCURRENT callers of the same runner: while one cycle is
 * running, a second call returns `skipped-overlap` immediately without building
 * an envelope or issuing a request. (The daemon itself awaits each cycle, so it
 * never trips this guard on its own — see the module header.) Exposed so a caller
 * or a test can drive single cycles without the timer loop, exactly as
 * `runSupervisorBeat` is exposed next to `runLoopSupervisor`.
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
          error: sanitizeForLog(errorText(error)),
          durationMs: nowFn() - startedAt
        };
      }

      // Read once, before the send, so the shape is reported even for a failed
      // push (the envelope is what WAS attempted).
      const payload = payloadShapeOf(envelope);

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
          error: sanitizeForLog(errorText(error)),
          durationMs: nowFn() - startedAt,
          payload
        };
      }

      const durationMs = nowFn() - startedAt;
      const reason = rejectionReasonOf(body);
      if (status >= 200 && status < 300) {
        return { outcome: "ok", status, durationMs, payload };
      }
      if (isAuthRejection(status)) {
        // The key itself is refused. Counted toward the stop budget.
        return { outcome: "auth-rejected", status, ...(reason ? { reason } : {}), durationMs, payload };
      }
      if (isTransientStatus(status)) {
        return { outcome: "transient", status, ...(reason ? { reason } : {}), durationMs, payload };
      }
      // Other 4xx: a rejected envelope (stale sequence, replay, clock skew).
      // Some of these self-heal as the sequence advances, so we keep looping —
      // but backed off, so a permanently malformed push is not a hot loop.
      return { outcome: "rejected", status, ...(reason ? { reason } : {}), durationMs, payload };
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
  /** Consecutive non-auth rejections tolerated. Default {@link DEFAULT_MIRROR_REJECT_LIMIT}. */
  readonly rejectLimit?: number;
  /** Consecutive local build failures tolerated. Default {@link DEFAULT_MIRROR_BUILD_FAILURE_LIMIT}. */
  readonly buildFailureLimit?: number;
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
  const rejectLimit =
    options.rejectLimit && options.rejectLimit > 0
      ? options.rejectLimit
      : DEFAULT_MIRROR_REJECT_LIMIT;
  const buildLimit =
    options.buildFailureLimit && options.buildFailureLimit > 0
      ? options.buildFailureLimit
      : DEFAULT_MIRROR_BUILD_FAILURE_LIMIT;
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
  let rejections = 0;
  let buildFailures = 0;
  let logFailures = 0;
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
    rejections,
    buildFailures,
    logFailures,
    stopReason,
    ...(message ? { message } : {})
  });

  // KILL-SWITCH, checked BEFORE the first cycle: a frozen daemon must not emit
  // a single request, not even one.
  if (mirrorPushGloballyDisabled(env)) return finish("kill-switch");
  if (options.signal?.aborted) return finish("aborted");

  // A target `fetch` cannot even parse would throw a parse TypeError that this
  // daemon would classify as a retryable network failure and retry forever. Stop
  // before the first cycle instead — the CLI refuses such a URL up front, but the
  // library is public API and must not be loopable into that state either.
  if (!isPushableHttpUrl(options.url)) {
    return finish("config-invalid", MIRROR_PUSH_INVALID_URL_MESSAGE);
  }

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
      // Only a genuinely ACCEPTED push clears either stop budget.
      authFailures = 0;
      rejections = 0;
      buildFailures = 0;
    } else {
      failures += 1;
      consecutiveFailures += 1;
      if (result.outcome === "auth-rejected") authFailures += 1;
      if (result.outcome === "rejected") rejections += 1;
      if (result.outcome === "build-failed") buildFailures += 1;
    }

    /**
     * Emit the status line. OBSERVABILITY MUST NOT BREAK THE PIPELINE: `onCycle`
     * is caller-supplied and writes to a stream the caller owns, so it can throw
     * — the common case being EPIPE once a piped stdout closes (`| head -3`, a
     * journald restart). Unguarded, that rejection escaped the daemon into the
     * CLI's raw fatal handler and pinned the unit `failed` with a message
     * matching none of the documented stops.
     *
     * A dead sink is not a reason to keep pushing blind, though: a closed stream
     * never reopens, so we stop CLEANLY (exit 0, no message) instead of running
     * unobservable. Any other logging error is counted and ignored.
     *
     * Returns false when the caller should stop.
     */
    const emit = async (nextInMs?: number): Promise<boolean> => {
      if (!options.onCycle) return true;
      try {
        await options.onCycle({
          cycle: cycles,
          at: new Date(nowFn()).toISOString(),
          instance: options.instance,
          endpoint,
          outcome: result.outcome,
          ...(result.status !== undefined ? { status: result.status } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.error ? { error: result.error } : {}),
          durationMs: result.durationMs,
          ...(result.payload?.seq !== undefined ? { seq: result.payload.seq } : {}),
          ...(result.payload
            ? {
                registrations: result.payload.registrations,
                presence: result.payload.presence,
                subagents: result.payload.subagents
              }
            : {}),
          ...(nextInMs !== undefined ? { nextInMs } : {}),
          authFailures,
          rejections,
          buildFailures
        });
        return true;
      } catch (error) {
        logFailures += 1;
        return !isClosedStreamError(error);
      }
    };

    // AUTH STOP: the budget is spent, so stop instead of hammering a server
    // that is refusing this key. Backoff already happened between attempts.
    if (authFailures >= authLimit) {
      await emit(undefined);
      return finish("auth-stop", MIRROR_PUSH_REENROLLMENT_MESSAGE);
    }

    // REJECT STOP: the same reasoning for a request the endpoint keeps refusing
    // on non-auth grounds. A looser budget, because a fencing rejection can
    // genuinely clear — but not an unbounded one, because a wrong path cannot.
    if (rejections >= rejectLimit) {
      await emit(undefined);
      return finish("reject-stop", MIRROR_PUSH_REJECTED_MESSAGE);
    }

    // BUILD STOP: we cannot even assemble a mirror. Nothing was sent and nothing
    // will be, so idling `active (running)` forever would report green while the
    // feed is dead. A wrong H2A_ROOT never self-heals — terminate loudly.
    if (buildFailures >= buildLimit) {
      await emit(undefined);
      return finish("build-stop", MIRROR_PUSH_BUILD_FAILED_MESSAGE);
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

    // A dead status sink stops the daemon cleanly rather than leaving it to push
    // where nobody can see what it is doing.
    if (!(await emit(waitMs))) return finish("log-unavailable");
    await sleep(waitMs, options.signal);
    if (options.signal?.aborted) return finish("aborted");
  }
}
