/**
 * Catalogue projector (LH-00 fixture form). The full projector with the
 * host-plus-presence join, the exclusion set and delta coalescing lands in
 * LH-06; LH-00 only pins the wire shape and proves a snapshot round-trips.
 *
 * Q-10 (catalogue source and field width): LH-00 projects the minimal day-1
 * listing fields (spec section 4.1) plus the recorded host kind and the
 * operable bit. It deliberately omits mirror extras (interests,
 * subscribedTopics, version, workspace internals) so a later widening needs a
 * named relaxation instead of arriving silently. The host-plus-presence join
 * stays an LH-06 decision; here operable means "recorded native host".
 */

import type { H2ALaunchContext, H2ASession } from "../../session.js";
import { classifyLaunchHost } from "./fleet-inventory.js";
import {
  TRUNK_PROTOCOL_VERSION,
  type CatalogueSessionRow,
  type CatalogueSnapshot,
  type InventoryHostKind
} from "./types.js";

const FORBIDDEN_LOCAL_KEYS = new Set([
  "cwd",
  "command",
  "resumeCommand",
  "tty",
  "tmux",
  "nativePty",
  "pid",
  "launchContext",
  "workspace"
]);

function containsKey(value: unknown, path: readonly string[] = []): string[] | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = containsKey(value[i], [...path, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_LOCAL_KEYS.has(key)) return [...path, key];
    const hit = containsKey(child, [...path, key]);
    if (hit) return hit;
  }
  return null;
}

export function containsForbiddenLocalField(value: unknown): boolean {
  return containsKey(value) !== null;
}

export function projectCatalogueRow(
  session: H2ASession,
  options: { readonly hostKind?: InventoryHostKind; readonly operable?: boolean; readonly excluded?: boolean } = {}
): CatalogueSessionRow {
  const hostKind = options.hostKind ?? classifyLaunchHost(session.launchContext as H2ALaunchContext | undefined);
  const operable = options.operable ?? hostKind === "native";
  return {
    sessionId: session.sessionId,
    instance: session.instance,
    ...(session.host === undefined ? {} : { host: session.host }),
    ...(session.name === undefined ? {} : { name: session.name }),
    startedAt: session.startedAt,
    heartbeatAt: session.heartbeatAt,
    state: session.state,
    ...(session.workStatus === undefined ? {} : { workStatus: session.workStatus }),
    hostKind,
    operable,
    ...(options.excluded === undefined ? {} : { excluded: options.excluded })
  };
}

export function buildCatalogueSnapshot(
  sessions: readonly H2ASession[],
  options: { readonly at: number; readonly ch?: number; readonly s?: number } = { at: 0 }
): CatalogueSnapshot {
  return {
    v: TRUNK_PROTOCOL_VERSION,
    t: "cat.snapshot",
    ch: options.ch ?? 1,
    s: options.s ?? 1,
    at: options.at,
    rows: sessions.map((session) => projectCatalogueRow(session))
  };
}

export function serializeCatalogueSnapshot(snapshot: CatalogueSnapshot): string {
  return JSON.stringify(snapshot);
}

function isRow(value: unknown): value is CatalogueSessionRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row["sessionId"] !== "string" || typeof row["instance"] !== "string") return false;
  if (typeof row["startedAt"] !== "string" || typeof row["heartbeatAt"] !== "string") return false;
  if (typeof row["state"] !== "string") return false;
  if (row["host"] !== undefined && typeof row["host"] !== "string") return false;
  if (row["name"] !== undefined && typeof row["name"] !== "string") return false;
  if (row["workStatus"] !== undefined && typeof row["workStatus"] !== "string") return false;
  if (row["hostKind"] !== "native" && row["hostKind"] !== "tmux" && row["hostKind"] !== "unknown") return false;
  if (typeof row["operable"] !== "boolean") return false;
  if (row["excluded"] !== undefined && typeof row["excluded"] !== "boolean") return false;
  return true;
}

export function parseCatalogueSnapshot(json: string): CatalogueSnapshot {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") throw new TypeError("catalogue snapshot: not an object");
  const snap = parsed as Record<string, unknown>;
  if (snap["v"] !== TRUNK_PROTOCOL_VERSION || snap["t"] !== "cat.snapshot") throw new TypeError("catalogue snapshot: wrong version or type");
  if (typeof snap["ch"] !== "number" || typeof snap["s"] !== "number" || typeof snap["at"] !== "number") {
    throw new TypeError("catalogue snapshot: missing envelope fields");
  }
  if (!Array.isArray(snap["rows"])) throw new TypeError("catalogue snapshot: rows is not an array");
  const rows = snap["rows"] as unknown[];
  for (const row of rows) {
    if (!isRow(row)) throw new TypeError("catalogue snapshot: malformed row");
  }
  if (containsForbiddenLocalField(parsed)) throw new TypeError("catalogue snapshot: forbidden local field");
  return snap as unknown as CatalogueSnapshot;
}
