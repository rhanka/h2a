/**
 * EVO-1 inbox-wake handler (durable bug #3) — the glue between the pure
 * `decideInboxWake` (core) and a `H2ADriver`. On each call it reads the inbox,
 * decides whether anything is new, and if so injects a **signed** drive line
 * carrying the h2a-tagged wake prompt via the injected driver.
 *
 * Driver-injected → unit-testable with `loggingDriver`/a fake; the real wake
 * (waking a live claude/codex) is the `nativeBackchannelDriver` + a live-host
 * smoke. Seeds `seen` from the inbox at construction so it does NOT wake on the
 * boot backlog — only on arrivals after the handler is wired.
 */
import { createHash } from "node:crypto";

import { decideInboxWake, type H2AEnvelope, type H2ALaunchContext } from "@sentropic/h2a";

import {
  asDriveOutcome,
  formatSignedDriveInstruction,
  type H2ADriver
} from "./index.js";

/**
 * Round-1 (code-review astra-1/sol-2): stable idempotency key for one
 * logical wake batch. The key is a digest of the batch's sorted envelope
 * ids — stable across ticks and restarts for the same undelivered batch
 * (safe redelivery: the native transport dedups on it), and distinct for
 * every distinct batch (a second batch is never mistaken for a redelivery
 * of the first). Interpolating the envelope object (`wake:[object Object]`)
 * collapsed every batch onto one key, so a deduping transport applied only
 * the first write while the handler still marked later batches seen.
 */
export function wakeRequestIdForBatch(freshIds: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...freshIds].sort().join("\n"), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `wake:${digest}`;
}

/**
 * Lot L3: durable pending-wake store. A wake the driver could not deliver
 * (deferred or failed transport) must survive a sidecar restart: without
 * this, the restart seed marks the undelivered envelope seen and it is
 * never retried. The store holds envelope ids only (never content).
 */
export interface InboxWakePendingStore {
  load(): string[];
  save(ids: string[]): void;
}

export interface InboxWakeHandlerDeps {
  /** This agent's instance id (signer + drive target — it wakes itself). */
  readonly instance: string;
  /** Read the current inbox for `instance` (e.g. `() => store.readInbox(instance)`). */
  readonly readInbox: () => H2AEnvelope[];
  /** Private key PEM for signing the drive line (from the local keyring). */
  readonly privateKeyPem: string;
  /** Injected driver (logging / native / command / …). */
  readonly driver: H2ADriver;
  /** Optional host hint passed to the driver. */
  readonly host?: string;
  /**
   * Resolve the host's own launch context (its tmux pane) so the
   * local-tmux/native driver can target it.
   */
  readonly resolveLaunchContext?: () => H2ALaunchContext | undefined;
  /**
   * Resolve the native host's concrete PTY session. The signed line remains
   * addressed to `instance`; only the transport target uses this volatile id.
   */
  readonly resolveNativeSessionId?: () => string | undefined;
  /** Clock (drive nonce/at + wake tag). Defaults to `Date.now`. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /**
   * Lot L3: durable pending-wake store (envelope ids only). Undelivered
   * envelopes are saved on every unsuccessful drive and re-surfaced after a
   * restart. Best effort: store failures never break the wake call.
   */
  readonly pendingStore?: InboxWakePendingStore;
  /**
   * Round-2 P1: called with the typed retry delay when a drive defers on
   * recent human activity (transient — the human may be done typing by
   * then). The sidecar coalesces these into one bounded retry timer.
   * Refused, failed and other deferred outcomes never schedule: refusals
   * are final, and anything else stays pending for the next inbox arrival
   * or restart.
   */
  readonly scheduleRetry?: (retryAfterMs: number) => void;
}

/** Returns a handler; calling it injects a wake iff new inbox envelopes exist. */
export function createInboxWakeHandler(deps: InboxWakeHandlerDeps): () => Promise<boolean> {
  const now = deps.now ?? Date.now;
  const readPending = (): string[] => {
    try {
      const ids = deps.pendingStore?.load() ?? [];
      return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
    } catch {
      // A failing load reads as "unknown", never as "no pending": callers
      // below seed nothing as seen from it (round-2 sol-6).
      return [];
    }
  };
  const writePending = (ids: string[]): void => {
    try {
      deps.pendingStore?.save(ids);
    } catch (error) {
      // Surfaced, never silent: without durable pending, a restart cannot
      // tell delivered from deferred. The in-memory fresh set still retries
      // on the next tick within this process — but the wake call itself
      // never breaks on a store failure.
      const message = error instanceof Error ? error.message : String(error);
      deps.log?.(`inbox-wake: pending store unavailable, wake stays memory-only (${message})`);
    }
  };
  // Seed from the current inbox: boot backlog must not trigger a wake —
  // EXCEPT envelopes the previous process saved as pending (undelivered).
  // Those were never driven, so a restart must retry them, not bury them.
  // Round-2 (sol-6): a store that cannot be read proves nothing — seed
  // NOTHING as seen (fail safe: the next tick retries the backlog and the
  // failure is surfaced on the log) instead of declaring deposits seen
  // without proof of an accepted wake.
  let persisted: Set<string>;
  let pendingUnreadable = false;
  try {
    const ids = deps.pendingStore?.load() ?? [];
    persisted = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch (error) {
    persisted = new Set();
    pendingUnreadable = true;
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.(`inbox-wake: pending store unreadable, retrying inbox from scratch (${message})`);
  }
  // An unreadable store seeds NOTHING as seen: every deposit stays fresh
  // until a wake is accepted for it (a spurious backlog wake beats a buried
  // one, and the failure above names the cause).
  let seen: string[] = pendingUnreadable
    ? []
    : deps.readInbox().map((e) => e.id).filter((id) => !persisted.has(id));
  return async () => {
    const decision = decideInboxWake({
      seen,
      inbox: deps.readInbox(),
      nowIso: new Date(now()).toISOString()
    });
    if (!decision) return false;
    const instructionLine = formatSignedDriveInstruction({
      from: deps.instance,
      to: deps.instance,
      instruction: decision.wake,
      privateKeyPem: deps.privateKeyPem,
      now
    });
    const launchContext = deps.resolveLaunchContext?.();
    const nativeSessionId = deps.resolveNativeSessionId?.();
    const freshIds = decision.fresh.map((e) => e.id);
    // Round-1 (D9): persist the pending batch BEFORE sending, so a crash
    // between a successful drive and the clearing below still retries the
    // same batch under the same key — and the transport's idempotency
    // dedups it instead of applying it twice.
    writePending([...new Set([...readPending(), ...freshIds])]);
    const outcome = asDriveOutcome(await deps.driver.drive({
      to: nativeSessionId && nativeSessionId.length > 0
        ? nativeSessionId
        : deps.instance,
      instructionLine,
      requestId: wakeRequestIdForBatch(freshIds),
      ...(deps.host ? { host: deps.host } : {}),
      ...(launchContext ? { launchContext } : {})
    }));
    // Advance `seen` ONLY on a driven wake: deferred and failed drives keep
    // the envelopes fresh so the next tick retries them, and the pending
    // ids stay persisted so a restart retries them too — instead of marking
    // them seen and never waking on them again.
    if (outcome.outcome === "driven") {
      seen = decision.seen;
      // Reconcile the ACK (D9): clear exactly the driven batch, keep any
      // other pending ids a concurrent tick may have recorded.
      const driven = new Set(freshIds);
      writePending(readPending().filter((id) => !driven.has(id)));
      deps.log?.(`inbox-wake: ${decision.fresh.length} new envelope(s) → drive ok`);
      return true;
    }
    if (outcome.outcome === "deferred") {
      const retry = outcome.retryAfterMs !== undefined ? `, retry in ${outcome.retryAfterMs}ms` : "";
      deps.log?.(`inbox-wake: ${decision.fresh.length} new envelope(s) → drive deferred (${outcome.reason}${retry})`);
      // Round-2 P1: recent-human deferral is transient — ask the sidecar for
      // one coalesced retry after the window. Every other deferral stays
      // pending for the next arrival or restart.
      if (
        outcome.reason === "deferred-recent-human" &&
        typeof outcome.retryAfterMs === "number" &&
        outcome.retryAfterMs > 0
      ) {
        deps.scheduleRetry?.(outcome.retryAfterMs);
      }
    } else {
      const reason = outcome.outcome === "failed" && outcome.reason !== undefined ? ` (${outcome.reason})` : "";
      deps.log?.(`inbox-wake: ${decision.fresh.length} new envelope(s) → drive ${outcome.outcome}${reason}`);
    }
    return false;
  };
}
