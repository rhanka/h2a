/**
 * Durable escalation registry (DEC-095, Drumbeat D7). When an agent exhausts its
 * relance budget (DEC-086 `scanDrumbeat` → `exhausted`), the daemon must stop
 * looping and **escalate to the PRINCIPAL** (DEC-084: the engagement owner, not
 * EXECUTIF) over the `alert` channel (DEC-040). The relance cap is the anti-loop
 * guard; this registry is the escalation that replaces further relances.
 *
 * Parallel to the drumbeat/blockage registries: `<root>/.h2a/escalation/<safe-instance>.json`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { localStorePaths, safePathSegment } from "../local-files/paths.js";

/**
 * Why the escalation fired. `relance-exhausted` (D7, relance budget spent);
 * `watchdog-escalate` / `reroute-suggested` (D5, the reflexive watchdog decided
 * a human must look, or that the work should be reassigned).
 */
export type H2AEscalationReason = "relance-exhausted" | "watchdog-escalate" | "reroute-suggested";

export interface H2AEscalationRecord {
  readonly instance: string;
  readonly reason: H2AEscalationReason;
  /** Relance count at the time the budget was exhausted. */
  readonly relanceCount: number;
  /** Escalation channel (DEC-040). Defaults to `alert`. */
  readonly channel: string;
  /** Symbolic target — the scope's competent authority. Defaults to `PRINCIPAL` (DEC-084). */
  readonly to: string;
  readonly at: string;
}

function entryFile(root: string, instance: string): string {
  return join(localStorePaths(root).escalation, `${safePathSegment(instance)}.json`);
}

export interface RecordEscalationInput {
  readonly instance: string;
  readonly reason: H2AEscalationReason;
  readonly relanceCount: number;
  readonly channel?: string;
  readonly to?: string;
}

/**
 * Record (upsert) an escalation. Idempotent per instance: a repeated escalation
 * for the same exhausted instance overwrites with the latest count/time rather
 * than piling up — the PRINCIPAL needs one open alert per agent, not a flood.
 */
export function recordEscalation(
  root: string,
  input: RecordEscalationInput,
  now: number = Date.now()
): H2AEscalationRecord {
  mkdirSync(localStorePaths(root).escalation, { recursive: true });
  const record: H2AEscalationRecord = {
    instance: input.instance,
    reason: input.reason,
    relanceCount: input.relanceCount,
    channel: input.channel ?? "alert",
    to: input.to ?? "PRINCIPAL",
    at: new Date(now).toISOString()
  };
  writeFileSync(entryFile(root, input.instance), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export function readEscalation(root: string, instance: string): H2AEscalationRecord | undefined {
  const file = entryFile(root, instance);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as H2AEscalationRecord;
  } catch {
    return undefined;
  }
}

export function listEscalations(root: string): H2AEscalationRecord[] {
  const dir = localStorePaths(root).escalation;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: H2AEscalationRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as H2AEscalationRecord);
    } catch {
      // skip malformed
    }
  }
  return out;
}

/** Clear an escalation — call when the agent is cleanly resumed/finished. */
export function clearEscalation(root: string, instance: string): void {
  try {
    unlinkSync(entryFile(root, instance));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
