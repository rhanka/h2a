/**
 * Local runtime reader for the h2a → Sentropic session feed.
 *
 * This is deliberately a local, read-only adapter around the pure descriptor
 * builders. It makes the existing P1 feed startable without creating a hosted
 * endpoint, resolving a Sentropic principal, or enabling any remote control.
 * Those concerns remain owned by the gateway/binding layer.
 */
import type { H2ASession } from "@sentropic/h2a";

import { createLocalStore, type LocalStore } from "../local-files/store.js";
import {
  listPresenceWithDiagnostics,
  type ListPresenceOptions
} from "../local-files/presence.js";
import { buildFeedResponse, type H2AFeedResponse } from "./descriptors.js";

/** The minimum store capability needed by the read-only feed adapter. */
export interface FeedRegistrationSource {
  listInstances(): ReturnType<LocalStore["listInstances"]>;
}

/** Injectable presence reader keeps the adapter independently testable. */
export type FeedPresenceReader = (
  root: string,
  options: ListPresenceOptions
) => { readonly sessions: H2ASession[]; readonly warnings: string[] };

export interface ReadLocalFeedOptions {
  /** h2a local-state root (normally `<workspace>/.h2a`). */
  readonly root: string;
  /** Inject for deterministic callers; defaults to the current clock. */
  readonly asOf?: number;
  /** Mirrored-row freshness interval, when the caller reads a mirrored root. */
  readonly pushIntervalMs?: number;
  /** Optional source seam; no store is created when supplied. */
  readonly registrations?: FeedRegistrationSource;
  /** Optional source seam; no filesystem presence read occurs when supplied. */
  readonly readPresence?: FeedPresenceReader;
}

/**
 * Read local h2a state into the ratified browser-safe feed response.
 *
 * Presence is read with expired rows included and sweeping disabled: the feed
 * must describe a closed session honestly and must never delete local state as
 * a side effect of a read. A malformed/unreadable presence row is a failed
 * source, not proof of an empty feed, so the adapter refuses the response.
 */
export function readLocalFeed(options: ReadLocalFeedOptions): H2AFeedResponse {
  const asOf = options.asOf ?? Date.now();
  const registrations = options.registrations ?? createLocalStore({ root: options.root });
  const readPresence = options.readPresence ?? listPresenceWithDiagnostics;
  const presence = readPresence(options.root, {
    now: asOf,
    includeExpired: true,
    sweep: false
  });

  if (presence.warnings.length > 0) {
    throw new Error(
      "h2a feed: presence source has unreadable records — refusing to render a partial feed"
    );
  }

  return buildFeedResponse({
    asOf,
    sessions: presence.sessions,
    registrations: registrations.listInstances(),
    pushIntervalMs: options.pushIntervalMs
  });
}
