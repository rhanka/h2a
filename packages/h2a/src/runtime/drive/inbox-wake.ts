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
import { decideInboxWake, type H2AEnvelope, type H2ALaunchContext } from "@sentropic/h2a";

import { formatSignedDriveInstruction, type H2ADriver } from "./index.js";
import type { WakeJournal } from "../handover/wake.js";

export interface InboxWakeHandlerDeps {
  readonly journal?: WakeJournal;
  readonly restoredSeen?: readonly string[];
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
}

/** Returns a handler; calling it injects a wake iff new inbox envelopes exist. */
export function createInboxWakeHandler(deps: InboxWakeHandlerDeps): (() => Promise<boolean>) & { checkpointState(): { seen: string[] } } {
  const now = deps.now ?? Date.now;
  // Seed from the current inbox: boot backlog must not trigger a wake.
  let seen: string[] = deps.restoredSeen ? [...deps.restoredSeen] : deps.readInbox().map((e) => e.id);
  let pending: Promise<boolean> | undefined;
  const perform = async () => {
    const inbox = deps.readInbox();
    const eligible = deps.journal ? new Set(deps.journal.eligibleEnvelopeIds(inbox.map(e => e.id))) : undefined;
    const decision = decideInboxWake({
      seen,
      inbox: eligible ? inbox.filter(e => eligible.has(e.id)) : inbox,
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
    const inject = (line: string) => deps.driver.drive({
      to: nativeSessionId && nativeSessionId.length > 0
        ? nativeSessionId
        : deps.instance,
      instructionLine: line,
      ...(deps.host ? { host: deps.host } : {}),
      ...(launchContext ? { launchContext } : {})
    });
    const ok = deps.journal
      ? await deps.journal.perform(decision.fresh.map(e => e.id), instructionLine, inject)
      : await inject(instructionLine);
    // Advance `seen` ONLY on a successful drive: a transient failure (no pane,
    // tmux hiccup) must leave the envelope fresh so the next tick retries it,
    // instead of marking it seen and never waking on it again.
    if (ok) seen = decision.seen;
    deps.log?.(`inbox-wake: ${decision.fresh.length} new envelope(s) → drive ${ok ? "ok" : "failed"}`);
    return ok;
  };
  const handler = () => pending ??= perform().finally(() => { pending = undefined; });
  handler.checkpointState = () => ({ seen: [...seen] });
  return handler;
}
