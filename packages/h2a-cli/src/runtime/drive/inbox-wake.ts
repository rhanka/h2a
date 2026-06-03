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
import { decideInboxWake, type H2AEnvelope } from "@sentropic/h2a";

import { formatSignedDriveInstruction, type H2ADriver } from "./index.js";

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
  /** Clock (drive nonce/at + wake tag). Defaults to `Date.now`. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

/** Returns a handler; calling it injects a wake iff new inbox envelopes exist. */
export function createInboxWakeHandler(deps: InboxWakeHandlerDeps): () => Promise<boolean> {
  const now = deps.now ?? Date.now;
  // Seed from the current inbox: boot backlog must not trigger a wake.
  let seen: string[] = deps.readInbox().map((e) => e.id);
  return async () => {
    const decision = decideInboxWake({
      seen,
      inbox: deps.readInbox(),
      nowIso: new Date(now()).toISOString()
    });
    if (!decision) return false;
    seen = decision.seen;
    const instructionLine = formatSignedDriveInstruction({
      from: deps.instance,
      to: deps.instance,
      instruction: decision.wake,
      privateKeyPem: deps.privateKeyPem,
      now
    });
    const ok = await deps.driver.drive({
      to: deps.instance,
      instructionLine,
      ...(deps.host ? { host: deps.host } : {})
    });
    deps.log?.(`inbox-wake: ${decision.fresh.length} new envelope(s) → drive ${ok ? "ok" : "failed"}`);
    return ok;
  };
}
