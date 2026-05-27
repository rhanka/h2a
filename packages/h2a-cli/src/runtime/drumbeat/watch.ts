/**
 * Drumbeat daemon core (DEC-086, slice D2): the dumb, always-on anchor that
 * `/loop` provides only on Claude. It scans the registry and, for each stalled
 * agent, calls a **relauncher adapter** (concrete adapters — local-tmux,
 * remote, headless — are slice D3/D4). It performs no LLM work and never
 * relaunches by itself; it just detects + dispatches + caps the relances.
 */

import { scanDrumbeat, type H2ADrumbeatFinding, type ScanDrumbeatOptions } from "./scan.js";
import { markRelanced, type H2ADrumbeatEntry } from "./registry.js";

/** Adapter that actually re-invokes a stalled agent (slice D3/D4). */
export interface H2ARelauncher {
  /** Returns true if a relance was issued (counts against the cap). */
  relance(finding: H2ADrumbeatFinding): boolean | Promise<boolean>;
}

/** A relauncher that only logs — the D2 default until real adapters land. */
export function loggingRelauncher(write: (line: string) => void): H2ARelauncher {
  return {
    relance(finding) {
      write(
        `drumbeat: would relance ${finding.instance} (reason=${finding.reason}, tries=${finding.relanceCount})`
      );
      return true;
    }
  };
}

export interface DrumbeatTickOptions extends ScanDrumbeatOptions {
  /** Hook for entries that hit the relance cap → escalate to PRINCIPAL (D7). */
  onExhausted?: (entry: H2ADrumbeatEntry) => void | Promise<void>;
  now?: number;
}

export interface DrumbeatTickResult {
  readonly relanced: readonly string[];
  readonly exhausted: readonly string[];
}

/** One scan→dispatch pass (no timers) — the testable unit of the loop. */
export async function drumbeatTick(
  root: string,
  relauncher: H2ARelauncher,
  options: DrumbeatTickOptions = {}
): Promise<DrumbeatTickResult> {
  const { findings, exhausted } = scanDrumbeat(root, { maxRelances: options.maxRelances });
  const relanced: string[] = [];
  for (const finding of findings) {
    const issued = await relauncher.relance(finding);
    if (issued) {
      markRelanced(root, finding.instance, options.now);
      relanced.push(finding.instance);
    }
  }
  const escalated: string[] = [];
  for (const entry of exhausted) {
    await options.onExhausted?.(entry);
    escalated.push(entry.instance);
  }
  return { relanced, exhausted: escalated };
}

export interface DrumbeatWatchOptions extends DrumbeatTickOptions {
  /** Beat interval in ms. Default 30s. */
  intervalMs?: number;
  /** Stop the loop. */
  signal?: AbortSignal;
  onTick?: (result: DrumbeatTickResult) => void;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run the drumbeat loop until `signal` aborts. Each beat: scan → relance via
 * the adapter → cap. The anchor that codex/agy/gemini lack.
 */
export async function runDrumbeatWatch(
  root: string,
  relauncher: H2ARelauncher,
  options: DrumbeatWatchOptions = {}
): Promise<void> {
  const intervalMs = options.intervalMs ?? 30_000;
  while (!options.signal?.aborted) {
    const result = await drumbeatTick(root, relauncher, options);
    options.onTick?.(result);
    if (options.signal?.aborted) break;
    await delay(intervalMs, options.signal);
  }
}
