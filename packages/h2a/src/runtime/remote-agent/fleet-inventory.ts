/**
 * Fleet inventory helper (LH-00). Reads the recorded host kind per existing
 * session plus the fleet valve value, and reports shares without reading live
 * state: no host socket, no tmux server, no process scan.
 *
 * Sources (fixture or file reads only):
 * - presence sessions (`H2ASession`) — the recorded kind comes from
 *   `launchContext.nativePty` versus `launchContext.tmux`; anything else is
 *   `unknown`. This replaces the spec placeholder `unknown` (Q-11) with the
 *   observed fact: the native host is the default unless the fleet valve
 *   `H2A_SESSION_HOST=tmux` selects tmux.
 * - registry rows (`H2AActorRegistration`) with no matching presence session
 *   count as `unknown` and drive the presence-coverage measure (Q-10):
 *   presence exists only where a sidecar opened it, so the coverage ratio is
 *   the join-key availability signal for LH-06.
 * - `buildFleetInventoryFromRoot` reads `<root>/presence/*.json` and
 *   `<root>/registry/instances.jsonl` from a temporary store root. It never
 *   creates a directory and never opens a socket.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { H2AActorRegistration } from "../../types.js";
import type { H2ALaunchContext, H2ASession } from "../../session.js";
import { listPresence } from "../local-files/presence.js";
import type { InventoryHostKind } from "./types.js";

export type FleetValve = "native" | "tmux";

export interface InventoryRow {
  readonly sessionId: string;
  readonly instance: string;
  readonly hostKind: InventoryHostKind;
  readonly hasPresence: boolean;
  readonly source: "presence" | "registry";
}

export interface FleetInventory {
  readonly total: number;
  readonly native: number;
  readonly tmux: number;
  readonly unknown: number;
  readonly shares: Readonly<{ native: number; tmux: number; unknown: number }>;
  readonly fleetValve: FleetValve;
  readonly defaultHostForNew: FleetValve;
  readonly presenceCoverage: Readonly<{ withPresence: number; withoutPresence: number; ratio: number }>;
  readonly rows: readonly InventoryRow[];
}

/** Fleet valve: `H2A_SESSION_HOST=tmux` (case-insensitive) selects tmux; anything else is native. */
export function resolveFleetValve(env: Readonly<Record<string, string | undefined>> = process.env): FleetValve {
  return (env["H2A_SESSION_HOST"] ?? "").toLowerCase() === "tmux" ? "tmux" : "native";
}

export function classifyLaunchHost(launchContext: H2ALaunchContext | undefined): InventoryHostKind {
  if (!launchContext) return "unknown";
  if (launchContext.nativePty && typeof launchContext.nativePty.session === "string" && launchContext.nativePty.session.length > 0) {
    return "native";
  }
  if (
    launchContext.tmux &&
    typeof launchContext.tmux.session === "string" &&
    launchContext.tmux.session.length > 0 &&
    typeof launchContext.tmux.pane === "string" &&
    launchContext.tmux.pane.length > 0
  ) {
    return "tmux";
  }
  return "unknown";
}

export function buildFleetInventory(input: {
  readonly sessions: readonly H2ASession[];
  readonly registrations?: readonly H2AActorRegistration[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}): FleetInventory {
  const env = input.env ?? process.env;
  const valve = resolveFleetValve(env);
  const rows: InventoryRow[] = [];
  const coveredInstances = new Set<string>();
  for (const session of input.sessions) {
    coveredInstances.add(session.instance);
    rows.push({
      sessionId: session.sessionId,
      instance: session.instance,
      hostKind: classifyLaunchHost(session.launchContext),
      hasPresence: true,
      source: "presence"
    });
  }
  for (const registration of input.registrations ?? []) {
    if (coveredInstances.has(registration.instance)) continue;
    rows.push({
      sessionId: registration.id,
      instance: registration.instance,
      hostKind: "unknown",
      hasPresence: false,
      source: "registry"
    });
  }
  let native = 0;
  let tmux = 0;
  let unknown = 0;
  for (const row of rows) {
    if (row.hostKind === "native") native += 1;
    else if (row.hostKind === "tmux") tmux += 1;
    else unknown += 1;
  }
  const total = rows.length;
  const shares = total === 0 ? { native: 0, tmux: 0, unknown: 0 } : { native: native / total, tmux: tmux / total, unknown: unknown / total };
  const withPresence = rows.filter((row) => row.hasPresence).length;
  const withoutPresence = total - withPresence;
  const ratio = total === 0 ? 0 : withPresence / total;
  return {
    total,
    native,
    tmux,
    unknown,
    shares,
    fleetValve: valve,
    defaultHostForNew: valve,
    presenceCoverage: { withPresence, withoutPresence, ratio },
    rows
  };
}

function readInstancesJsonl(root: string): H2AActorRegistration[] {
  const file = join(root, "registry", "instances.jsonl");
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: H2AActorRegistration[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as H2AActorRegistration;
      if (parsed && typeof parsed.id === "string" && typeof parsed.instance === "string") out.push(parsed);
    } catch {
      continue;
    }
  }
  return out;
}

export function buildFleetInventoryFromRoot(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly now?: number } = {}
): FleetInventory {
  const now = options.now ?? Date.now();
  const sessions = listPresence(root, { now, includeExpired: true, sweep: false });
  const registrations = readInstancesJsonl(root);
  return buildFleetInventory({ sessions, registrations, env });
}

export function readPresenceFileNames(root: string): string[] {
  try {
    return readdirSync(join(root, "presence"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
