/**
 * Store wiring for the remote HTTP server (DEC-077), slice 3b-ii.
 *
 * Binds the generic `createRemoteServer` (DEC-076) to a local-files store:
 * public keys are resolved from the registry, and accepted envelopes are
 * delivered to the recipient's inbox. Kept separate from `server.ts` so the
 * HTTP layer stays store-agnostic and unit-testable.
 */

import type { Server } from "node:http";

import { createReplayGuard, type H2AReplayGuard } from "@sentropic/h2a";

import type { LocalStore } from "../local-files/store.js";
import { createRemoteServer } from "./server.js";

export interface RemoteServerForStoreOptions {
  /** POST endpoint path. Default `/h2a/envelopes`. */
  path?: string;
  /** Shared replay guard. Defaults to a fresh in-memory guard. */
  guard?: H2AReplayGuard;
  /** Body-size cap (bytes). */
  maxBodyBytes?: number;
}

/**
 * Build (unstarted) an HTTP server that authenticates against `store`'s
 * registry and delivers accepted envelopes to local inboxes. Resolving a
 * signer with no registered public key yields `no-public-key` (401), so an
 * unknown or key-less sender is refused.
 */
export function remoteServerForStore(
  store: LocalStore,
  options: RemoteServerForStoreOptions = {}
): Server {
  return createRemoteServer({
    resolvePublicKey: (signer) => store.findInstance(signer)?.publicKeys[0],
    deliver: (recipient, envelope) => store.putInboxMessage(recipient, envelope),
    guard: options.guard ?? createReplayGuard(),
    path: options.path,
    maxBodyBytes: options.maxBodyBytes
  });
}
