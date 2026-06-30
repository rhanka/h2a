/**
 * Durable drumbeat registry (DEC-086, slice D2).
 *
 * The ephemeral presence files (DEC-051) are swept ~15s after the last
 * heartbeat, so a genuinely *stopped* agent leaves no trace there — yet the
 * stopped agent is exactly what the drumbeat must relance. The host plugin
 * therefore records a **durable** stop entry here, under
 * `<root>/.h2a/drumbeat/<safe-instance>.json`, which survives the presence
 * sweep until the agent is cleanly resumed or finished.
 *
 * The presence `workStatus`/`inferStall` (D1) still cover the running-but-idle
 * case; this registry covers the stopped case.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { H2ALaunchContext, H2AReflexiveAction, H2AWorkStatus } from "@sentropic/h2a";

import { localStorePaths, safePathSegment } from "../local-files/paths.js";

export interface H2ADrumbeatEntry {
  readonly instance: string;
  /** Status the agent reported when it stopped. */
  readonly workStatus: H2AWorkStatus;
  /** ISO timestamp of the stop. */
  readonly stoppedAt: string;
  /** Launch context captured at start, for the relauncher (DEC-084). */
  readonly launchContext?: H2ALaunchContext;
  /** How many relances have been issued for this stop. */
  readonly relanceCount: number;
  /** ISO timestamp of the last relance, if any. */
  readonly lastRelanceAt?: string;
  /**
   * D5: set when a reflexive-watchdog terminal action (escalate/reroute) resolved
   * this stop. `scanDrumbeat` skips terminal entries so they are not re-decided;
   * a genuine fresh `recordStop` overwrites the entry (a new relance budget).
   */
  readonly terminal?: { readonly action: H2AReflexiveAction; readonly at: string };
}

function entryFile(root: string, instance: string): string {
  return join(localStorePaths(root).drumbeat, `${safePathSegment(instance)}.json`);
}

function ensureDir(root: string): void {
  mkdirSync(localStorePaths(root).drumbeat, { recursive: true });
}

export interface RecordStopInput {
  readonly instance: string;
  readonly workStatus: H2AWorkStatus;
  readonly launchContext?: H2ALaunchContext;
}

/**
 * Record (upsert) that an agent stopped. Resets `relanceCount` to 0 — a fresh
 * stop is a fresh relance budget. The host plugin calls this on exit.
 */
export function recordStop(
  root: string,
  input: RecordStopInput,
  now: number = Date.now()
): H2ADrumbeatEntry {
  ensureDir(root);
  const entry: H2ADrumbeatEntry = {
    instance: input.instance,
    workStatus: input.workStatus,
    stoppedAt: new Date(now).toISOString(),
    ...(input.launchContext ? { launchContext: input.launchContext } : {}),
    relanceCount: 0
  };
  writeFileSync(entryFile(root, input.instance), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  return entry;
}

export function readDrumbeatEntry(root: string, instance: string): H2ADrumbeatEntry | undefined {
  const file = entryFile(root, instance);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as H2ADrumbeatEntry;
  } catch {
    return undefined;
  }
}

export function listDrumbeat(root: string): H2ADrumbeatEntry[] {
  const dir = localStorePaths(root).drumbeat;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: H2ADrumbeatEntry[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as H2ADrumbeatEntry);
    } catch {
      // skip malformed
    }
  }
  return out;
}

/** Remove an entry — call when the agent is cleanly resumed or finished. */
export function clearDrumbeatEntry(root: string, instance: string): void {
  const file = entryFile(root, instance);
  try {
    unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Increment the relance counter after a relance was issued. */
export function markRelanced(
  root: string,
  instance: string,
  now: number = Date.now()
): H2ADrumbeatEntry | undefined {
  const existing = readDrumbeatEntry(root, instance);
  if (!existing) return undefined;
  const next: H2ADrumbeatEntry = {
    ...existing,
    relanceCount: existing.relanceCount + 1,
    lastRelanceAt: new Date(now).toISOString()
  };
  writeFileSync(entryFile(root, instance), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/**
 * D5: mark an entry terminal (a reflexive-watchdog escalate/reroute resolved it).
 * `scanDrumbeat` skips terminal entries, so the watchdog does not re-decide it
 * each beat — without the destructive delete that a later `recordStop` (which
 * resets `relanceCount`) would re-arm into a slow loop.
 */
export function markDrumbeatTerminal(
  root: string,
  instance: string,
  action: H2AReflexiveAction,
  now: number = Date.now()
): H2ADrumbeatEntry | undefined {
  const existing = readDrumbeatEntry(root, instance);
  if (!existing) return undefined;
  const next: H2ADrumbeatEntry = {
    ...existing,
    terminal: { action, at: new Date(now).toISOString() }
  };
  writeFileSync(entryFile(root, instance), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
