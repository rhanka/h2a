/**
 * Drumbeat scan (DEC-086, slice D2). Reads the durable registry and decides,
 * per stopped agent, whether it is a relance candidate, has exhausted its
 * relance budget (→ escalate, D7), or finished (→ ignore/clear).
 */

import type { H2AWorkStatus } from "@sentropic/h2a";

import { listDrumbeat, type H2ADrumbeatEntry } from "./registry.js";

/** Default number of relances before escalating to the PRINCIPAL (DEC-084). */
export const H2A_DEFAULT_MAX_RELANCES = 3;

export type H2ADrumbeatReason = "stopped" | "out-of-tokens";

export interface H2ADrumbeatFinding {
  readonly instance: string;
  readonly reason: H2ADrumbeatReason;
  readonly workStatus: H2AWorkStatus;
  readonly launchContext?: H2ADrumbeatEntry["launchContext"];
  readonly relanceCount: number;
}

export interface H2ADrumbeatScanResult {
  /** Stopped agents that should be relanced. */
  readonly findings: readonly H2ADrumbeatFinding[];
  /** Entries that hit the relance cap — hand to escalation (D7). */
  readonly exhausted: readonly H2ADrumbeatEntry[];
}

export interface ScanDrumbeatOptions {
  readonly maxRelances?: number;
}

/**
 * Classify the registry: `done` entries are skipped (a clean finish);
 * entries at/over `maxRelances` are `exhausted` (escalate, don't loop);
 * everything else is a relance `finding` (reason `out-of-tokens` when that is
 * the recorded status, else `stopped`).
 */
export function scanDrumbeat(
  root: string,
  options: ScanDrumbeatOptions = {}
): H2ADrumbeatScanResult {
  const maxRelances = options.maxRelances ?? H2A_DEFAULT_MAX_RELANCES;
  const findings: H2ADrumbeatFinding[] = [];
  const exhausted: H2ADrumbeatEntry[] = [];
  for (const entry of listDrumbeat(root)) {
    if (entry.workStatus === "done") continue;
    if (entry.relanceCount >= maxRelances) {
      exhausted.push(entry);
      continue;
    }
    findings.push({
      instance: entry.instance,
      reason: entry.workStatus === "out-of-tokens" ? "out-of-tokens" : "stopped",
      workStatus: entry.workStatus,
      ...(entry.launchContext ? { launchContext: entry.launchContext } : {}),
      relanceCount: entry.relanceCount
    });
  }
  return { findings, exhausted };
}
