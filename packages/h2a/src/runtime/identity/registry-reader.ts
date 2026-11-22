/**
 * H2 — Instance/key registry verification surface: the typed `RegistryReaderV1`
 * read port (r2 §8.1 H2; §2.8 one writer per placement).
 *
 * The h2a local-files store remains the SOLE WRITER of instance/key lifecycle
 * records (§2.8 local rule). This port is the verified READ projection the local
 * cluster-mesh instance consumes for its decisions, keyed by registry revision.
 * It writes nothing: every method is a read over `LocalStore`'s own readers, so
 * the single-writer invariant is preserved by construction.
 *
 * Semantics frozen with the cluster-mesh lane (M0):
 *  - `currentRevision()` — a monotonically advancing cursor string
 *    `<instances>/<keys>/<grants>/<offboards>`: the per-stream line counts of
 *    the four append-only registry files. Rows are never rewritten or removed,
 *    so each component only grows, and every stream is diffed against its OWN
 *    component — an append in one stream can never shift another stream's rows
 *    past the consumer's cursor (a flat concatenation index loses records as
 *    soon as a later stream is non-empty).
 *  - `getInstance(agentUuidOrInstance)` — the `RegistryInstanceViewV1` for a
 *    perennial agent, addressed by `agentUuid` (the §2.4 level-1 anchor) or by
 *    any of its per-conversation instance ids (level-2 correlation only).
 *    Registrations without a perennial `agentUuid` anchor have NO level-1 view:
 *    they surface in the estate inventory's owner resolution queue instead
 *    (never auto-merged), and this read returns `null` for them.
 *  - `listChangesSince(revision)` — the CURRENT views of every agent whose rows
 *    changed after `revision` (diff replay). A malformed revision refuses with
 *    `registry_revision_invalid`; a revision ahead of the registry refuses with
 *    `registry_revision_ahead` (a stale consumer must resync via a full read,
 *    never be told "no changes").
 */

import { createHash } from "node:crypto";

import type { H2AActorRegistration } from "../../types.js";
import type { H2AOrgMembershipGrant } from "../../org.js";
import type { H2AKeyEvent, H2AOffboardTombstone, LocalStore } from "../local-files/store.js";
import { publicKeyFingerprint } from "./live.js";

export const H2A_REGISTRY_INSTANCE_V1_FORMAT = "h2a.registry-instance/v1";

export interface RegistryKeyViewV1 {
  readonly keyId: string;
  readonly fingerprint: string;
  readonly state: "active" | "rotated" | "revoked";
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly revokedAt?: string;
}

export interface RegistryInstanceViewV1 {
  readonly format: typeof H2A_REGISTRY_INSTANCE_V1_FORMAT;
  /** Revision this view was read at. */
  readonly registryRevision: string;
  readonly agentUuid: string;
  readonly launchName?: string;
  /** Per-conversation instance ids, correlation only. */
  readonly instances: readonly string[];
  readonly keys: readonly RegistryKeyViewV1[];
  readonly roleScopeBindings: readonly {
    actorLaunchName: string;
    scope: string;
    governanceRoles: readonly string[];
  }[];
  readonly offboardTombstone?: { offboardedAt: string; reason: string };
}

export interface RegistryReaderV1 {
  currentRevision(): Promise<string>;
  getInstance(agentUuidOrInstance: string): Promise<RegistryInstanceViewV1 | null>;
  listChangesSince(revision: string): Promise<readonly RegistryInstanceViewV1[]>;
}

export type RegistryRevisionErrorCode =
  | "registry_revision_invalid"
  | "registry_revision_ahead";

export class RegistryRevisionError extends Error {
  readonly code: RegistryRevisionErrorCode;
  constructor(code: RegistryRevisionErrorCode, message: string) {
    super(message);
    this.name = "RegistryRevisionError";
    this.code = code;
  }
}

interface RegistrySnapshot {
  readonly instances: readonly H2AActorRegistration[];
  readonly keyEvents: readonly H2AKeyEvent[];
  readonly grants: readonly H2AOrgMembershipGrant[];
  readonly offboards: readonly H2AOffboardTombstone[];
}

function readSnapshot(store: LocalStore): RegistrySnapshot {
  return {
    instances: store.listInstances(),
    keyEvents: store.listKeyEvents(),
    grants: store.listOrgMembership(),
    offboards: store.listOffboards()
  };
}

/**
 * The registry cursor: one line count per append-only stream. The four streams
 * are separate JSONL files, so the consumer's revision must carry each stream's
 * own cursor — a single flat index over the concatenated rows is not stable
 * across interleaved appends.
 */
interface RegistryCursor {
  readonly instances: number;
  readonly keys: number;
  readonly grants: number;
  readonly offboards: number;
}

const CURSOR_STREAMS = ["instances", "keys", "grants", "offboards"] as const;

function cursorOf(snapshot: RegistrySnapshot): RegistryCursor {
  return {
    instances: snapshot.instances.length,
    keys: snapshot.keyEvents.length,
    grants: snapshot.grants.length,
    offboards: snapshot.offboards.length
  };
}

function formatCursor(cursor: RegistryCursor): string {
  return `${cursor.instances}/${cursor.keys}/${cursor.grants}/${cursor.offboards}`;
}

function parseCursor(revision: string): RegistryCursor | undefined {
  if (typeof revision !== "string") return undefined;
  const parts = revision.split("/");
  if (parts.length !== CURSOR_STREAMS.length) return undefined;
  const counts: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return undefined;
    counts.push(Number(part));
  }
  return {
    instances: counts[0],
    keys: counts[1],
    grants: counts[2],
    offboards: counts[3]
  };
}

function cursorIsAhead(cursor: RegistryCursor, current: RegistryCursor): boolean {
  return (
    cursor.instances > current.instances ||
    cursor.keys > current.keys ||
    cursor.grants > current.grants ||
    cursor.offboards > current.offboards
  );
}

/**
 * Instance id AND handle → perennial `agentUuid`, for every registration that
 * carries the anchor. Legacy rows without `agentUuid` anchor nothing.
 */
function anchorOf(snapshot: RegistrySnapshot): Map<string, string> {
  const anchor = new Map<string, string>();
  for (const reg of snapshot.instances) {
    if (typeof reg.agentUuid !== "string" || reg.agentUuid.length === 0) continue;
    anchor.set(reg.id, reg.agentUuid);
    anchor.set(reg.instance, reg.agentUuid);
  }
  return anchor;
}

interface KeyAccumulator {
  readonly pem: string;
  validFrom: string;
  /** Instances under which the key is currently active (h2a per-instance keyring). */
  readonly active: Set<string>;
  revokedAt?: string;
}

function keyViewsFor(
  agentUuid: string,
  regs: readonly H2AActorRegistration[],
  keyEvents: readonly H2AKeyEvent[],
  anchor: ReadonlyMap<string, string>
): RegistryKeyViewV1[] {
  const byPem = new Map<string, KeyAccumulator>();
  const touch = (pem: string, validFrom: string, instance: string): void => {
    let acc = byPem.get(pem);
    if (!acc) {
      acc = { pem, validFrom, active: new Set<string>() };
      byPem.set(pem, acc);
    }
    if (validFrom < acc.validFrom) acc.validFrom = validFrom;
    acc.active.add(instance);
  };

  for (const reg of regs) {
    for (const pem of reg.publicKeys) touch(pem, reg.createdAt, reg.instance);
  }
  for (const event of keyEvents) {
    if (anchor.get(event.instance) !== agentUuid) continue;
    if (event.type === "added") {
      touch(event.publicKey, event.at, event.instance);
      continue;
    }
    // Revocation (rotate-out): per h2a keyring semantics the key leaves the
    // active set of that instance. A key still active under another instance of
    // the same agent stays usable by the agent.
    let acc = byPem.get(event.publicKey);
    if (!acc) {
      acc = { pem: event.publicKey, validFrom: event.at, active: new Set<string>() };
      byPem.set(event.publicKey, acc);
    }
    acc.active.delete(event.instance);
    if (acc.revokedAt === undefined || event.at > acc.revokedAt) acc.revokedAt = event.at;
  }

  const views: RegistryKeyViewV1[] = [];
  for (const acc of byPem.values()) {
    const keyId = `sha256:${createHash("sha256").update(acc.pem, "utf8").digest("hex")}`;
    const revoked = acc.active.size === 0;
    views.push({
      keyId,
      fingerprint: publicKeyFingerprint(acc.pem),
      state: revoked ? "revoked" : "active",
      validFrom: acc.validFrom,
      ...(revoked && acc.revokedAt !== undefined ? { revokedAt: acc.revokedAt } : {})
    });
  }
  views.sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));
  return views;
}

function roleScopeBindingsFor(
  agentUuid: string,
  regs: readonly H2AActorRegistration[],
  grants: readonly H2AOrgMembershipGrant[],
  anchor: ReadonlyMap<string, string>
): RegistryInstanceViewV1["roleScopeBindings"] {
  const nameOf = new Map<string, string>();
  for (const reg of regs) {
    if (typeof reg.name === "string" && reg.name.length > 0) {
      nameOf.set(reg.instance, reg.name);
      nameOf.set(reg.id, reg.name);
    }
  }

  const deduped = new Map<string, { actorLaunchName: string; scope: string; governanceRoles: string[] }>();
  const add = (binding: { actorLaunchName: string; scope: string; governanceRoles: string[] }): void => {
    deduped.set(JSON.stringify(binding), binding);
  };

  for (const reg of regs) {
    // An actor without a launch name cannot be keyed by the H1 policy key.
    if (typeof reg.name !== "string" || reg.name.length === 0) continue;
    for (const scope of reg.scopes) {
      add({ actorLaunchName: reg.name, scope, governanceRoles: [...reg.roles] });
    }
  }
  for (const grant of grants) {
    if (anchor.get(grant.instance) !== agentUuid) continue;
    const actorLaunchName = nameOf.get(grant.instance);
    if (actorLaunchName === undefined) continue;
    add({ actorLaunchName, scope: grant.scope, governanceRoles: [grant.role] });
  }

  return [...deduped.values()].sort((a, b) => {
    if (a.actorLaunchName !== b.actorLaunchName) return a.actorLaunchName < b.actorLaunchName ? -1 : 1;
    if (a.scope !== b.scope) return a.scope < b.scope ? -1 : 1;
    return a.governanceRoles.join(",") < b.governanceRoles.join(",") ? -1 : 1;
  });
}

function offboardTombstoneFor(
  agentUuid: string,
  offboards: readonly H2AOffboardTombstone[],
  anchor: ReadonlyMap<string, string>
): RegistryInstanceViewV1["offboardTombstone"] {
  let latest: H2AOffboardTombstone | undefined;
  for (const tombstone of offboards) {
    if (anchor.get(tombstone.instance) !== agentUuid) continue;
    if (latest === undefined || tombstone.at > latest.at) latest = tombstone;
  }
  return latest === undefined
    ? undefined
    : { offboardedAt: latest.at, reason: latest.reason ?? "" };
}

function buildView(
  agentUuid: string,
  snapshot: RegistrySnapshot,
  anchor: ReadonlyMap<string, string>,
  revision: string
): RegistryInstanceViewV1 {
  const regs = snapshot.instances.filter((reg) => reg.agentUuid === agentUuid);
  const named = regs
    .filter((reg) => typeof reg.name === "string" && reg.name.length > 0)
    .sort((a, b) =>
      a.createdAt !== b.createdAt
        ? a.createdAt < b.createdAt
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : 1
    );
  const launchName = named[0]?.name;
  const instances = [...new Set(regs.map((reg) => reg.instance))].sort();
  const keys = keyViewsFor(agentUuid, regs, snapshot.keyEvents, anchor);
  const roleScopeBindings = roleScopeBindingsFor(agentUuid, regs, snapshot.grants, anchor);
  const offboardTombstone = offboardTombstoneFor(agentUuid, snapshot.offboards, anchor);

  return {
    format: H2A_REGISTRY_INSTANCE_V1_FORMAT,
    registryRevision: revision,
    agentUuid,
    ...(launchName !== undefined ? { launchName } : {}),
    instances,
    keys,
    roleScopeBindings,
    ...(offboardTombstone !== undefined ? { offboardTombstone } : {})
  };
}

export function createRegistryReader(store: LocalStore): RegistryReaderV1 {
  return {
    async currentRevision(): Promise<string> {
      return formatCursor(cursorOf(readSnapshot(store)));
    },
    async getInstance(agentUuidOrInstance: string): Promise<RegistryInstanceViewV1 | null> {
      const snapshot = readSnapshot(store);
      const anchor = anchorOf(snapshot);
      const agentUuid = snapshot.instances.some((reg) => reg.agentUuid === agentUuidOrInstance)
        ? agentUuidOrInstance
        : anchor.get(agentUuidOrInstance);
      if (agentUuid === undefined) return null;
      return buildView(agentUuid, snapshot, anchor, formatCursor(cursorOf(snapshot)));
    },
    async listChangesSince(revision: string): Promise<readonly RegistryInstanceViewV1[]> {
      const cursor = parseCursor(revision);
      if (cursor === undefined) {
        throw new RegistryRevisionError(
          "registry_revision_invalid",
          `registry_revision_invalid: ${JSON.stringify(revision)} is not a registry revision cursor (<instances>/<keys>/<grants>/<offboards>)`
        );
      }
      const snapshot = readSnapshot(store);
      const current = cursorOf(snapshot);
      if (cursorIsAhead(cursor, current)) {
        throw new RegistryRevisionError(
          "registry_revision_ahead",
          `registry_revision_ahead: revision ${revision} is ahead of the registry (${formatCursor(current)}); resync with a full read`
        );
      }
      // Every stream is diffed against its OWN cursor component: an append in
      // instances never shifts keys/grants/offboards rows past the consumer.
      const anchor = anchorOf(snapshot);
      const touched = new Set<string>();
      const touch = (agentUuid: string | undefined): void => {
        if (agentUuid !== undefined) touched.add(agentUuid);
      };
      for (const reg of snapshot.instances.slice(cursor.instances)) {
        touch(
          typeof reg.agentUuid === "string" && reg.agentUuid.length > 0 ? reg.agentUuid : undefined
        );
      }
      for (const event of snapshot.keyEvents.slice(cursor.keys)) {
        touch(anchor.get(event.instance));
      }
      for (const grant of snapshot.grants.slice(cursor.grants)) {
        touch(anchor.get(grant.instance));
      }
      for (const tombstone of snapshot.offboards.slice(cursor.offboards)) {
        touch(anchor.get(tombstone.instance));
      }
      const revisionNow = formatCursor(current);
      return [...touched]
        .sort()
        .map((agentUuid) => buildView(agentUuid, snapshot, anchor, revisionNow));
    }
  };
}
