/**
 * Drumbeat daemon core (DEC-086, slice D2): the dumb, always-on anchor that
 * `/loop` provides only on Claude. It scans the registry and, for each stalled
 * agent, calls a **relauncher adapter** (concrete adapters — local-tmux,
 * remote, headless — are slice D3/D4). It performs no LLM work and never
 * relaunches by itself; it just detects + dispatches + caps the relances.
 */

import type { H2AReflexiveAction, H2AReflexiveDecision } from "@sentropic/h2a";

import { canonicalAddress } from "../local-files/index.js";
import { reachGuard } from "../local-files/paths.js";
import { listPresence } from "../local-files/presence.js";
import { createLocalStore } from "../local-files/store.js";
import { conductorFor } from "../governance/conductor.js";
import { scanDrumbeat, type H2ADrumbeatFinding, type ScanDrumbeatOptions } from "./scan.js";
import {
  markRelanced,
  clearDrumbeatEntry,
  markDrumbeatTerminal,
  type H2ADrumbeatEntry
} from "./registry.js";
import type { ReflexiveDecider } from "./deciders.js";
import { recordDrumbeatDecision } from "./decisions.js";

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
  /** D4: optional pre-scan hook, used by watch to consume remote resume inboxes. */
  beforeScan?: () => readonly string[] | Promise<readonly string[]>;
  /** Hook for entries that hit the relance cap → escalate to PRINCIPAL (D7). */
  onExhausted?: (entry: H2ADrumbeatEntry) => void | Promise<void>;
  now?: number;
  /** D5: reflexive watchdog. Consulted once `relanceCount >= deciderAfter`. */
  decider?: ReflexiveDecider;
  /** D5: minimum relanceCount before consulting the decider (default 1). */
  deciderAfter?: number;
  /** D5: apply the decision (true) or just log it and do the safe default (false). */
  enforce?: boolean;
  /** D5: label recorded in the decision log (default "logging"). */
  deciderLabel?: string;
  /** D5: effect hooks (cli.ts wires escalation), keeping watch.ts store-free. */
  onEscalate?: (finding: H2ADrumbeatFinding, decision: H2AReflexiveDecision) => void | Promise<void>;
  onReroute?: (finding: H2ADrumbeatFinding, decision: H2AReflexiveDecision) => void | Promise<void>;
  /**
   * WP-7: store root for the reach-guard.  When provided, each finding is
   * checked via `reachGuard` before reaching: phantom / ambiguous / malformed
   * targets are SKIPPED (never relanced).  When absent the guard is bypassed
   * and the tick behaves exactly as today — backward-compatible.
   */
  root?: string;
  /**
   * WP-7: optional log sink for reach-guard skip messages.  Defaults to a
   * no-op; pass a `(line: string) => void` to surface the skip reason.
   */
  log?: (line: string) => void;
  /**
   * Gov D2/D4: the instance id of the agent running this drumbeat.  When
   * absent, BOTH governance checks (D2 conductor-ownership, D4 cross-workspace
   * CoI advisory) are SKIPPED entirely — fully backward-compatible; all
   * existing callers that do not pass this option are unaffected.
   */
  selfInstance?: string;
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
  const preRelanced = await options.beforeScan?.();
  const { findings, exhausted } = scanDrumbeat(root, {
    maxRelances: options.maxRelances,
    skipInstances: [...(options.skipInstances ?? []), ...(preRelanced ?? [])]
  });

  // WP-7: Build reach-guard sets once per tick (avoid repeated I/O).
  // When `options.root` is absent the guard is skipped — backward-compatible.
  let guardRoot: string | undefined = options.root;
  let liveInstances: readonly string[] | undefined;
  let registeredInstances: readonly string[] | undefined;
  let allSessions: ReturnType<typeof listPresence> | undefined;
  if (guardRoot !== undefined) {
    allSessions = listPresence(guardRoot, options.now !== undefined ? { now: options.now } : {});
    liveInstances = allSessions.map((s) => s.instance);
    registeredInstances = createLocalStore({ root: guardRoot })
      .listInstances()
      .map((i) => i.instance);
  }

  // Gov D2/D4: resolve wSelf (self's workspace) once per tick if selfInstance known.
  // undefined = unknown/skip advisory.
  const selfInstance = options.selfInstance;
  let wSelf: string | undefined;
  if (selfInstance !== undefined && guardRoot !== undefined) {
    const selfSessions = (allSessions ?? []).filter(
      (s) => canonicalAddress(s.instance) === canonicalAddress(selfInstance)
    );
    if (selfSessions.length > 0 && selfSessions[0].workspace?.id !== undefined) {
      wSelf = selfSessions[0].workspace.id;
    } else {
      try {
        const reg = createLocalStore({ root: guardRoot }).findInstance(selfInstance);
        if (reg?.workspace?.id !== undefined) {
          wSelf = reg.workspace.id;
        }
      } catch {
        // if registry unreadable, wSelf stays undefined → D4 advisory skipped
      }
    }
  }

  const relanced: string[] = [];
  const k = options.deciderAfter ?? 1;
  for (const finding of findings) {
    // ── REACH-GUARD CHOKEPOINT ──────────────────────────────────────────────
    // Governance gates (D2 conductor-ownership, D4 CoI advisory) hook HERE so
    // every reach path inherits them.
    if (guardRoot !== undefined) {
      const guard = reachGuard({
        target: finding.instance,
        liveInstances: liveInstances!,
        registeredInstances: registeredInstances!
      });
      if (!guard.ok) {
        options.log?.(
          `drumbeat: skipping relance of ${finding.instance} — ${guard.reason}`
        );
        continue;
      }
    }

    // ── GOV D2: conductor owns relances (opt-in, default-allow) ────────────
    // Suppression only when ALL of:
    //   (a) selfInstance and options.root are known
    //   (b) wTarget (the finding's workspace) is resolvable
    //   (c) a live conductor is claimed for that workspace
    //   (d) self is NOT that conductor
    //   (e) relanceCount === 0 (fresh stall — failsafe: if relanceCount >= 1
    //       the conductor has already missed the window; peer steps in so
    //       a workspace is never frozen by a stuck conductor)
    // Also used by D4 CoI advisory below.
    let wTarget: string | undefined;
    if (selfInstance !== undefined && guardRoot !== undefined) {
      // Resolve finding's workspace from live sessions first, then registry.
      const targetSession = (allSessions ?? []).find(
        (s) => canonicalAddress(s.instance) === canonicalAddress(finding.instance)
      );
      if (targetSession?.workspace?.id !== undefined) {
        wTarget = targetSession.workspace.id;
      } else {
        try {
          const reg = createLocalStore({ root: guardRoot }).findInstance(finding.instance);
          if (reg?.workspace?.id !== undefined) {
            wTarget = reg.workspace.id;
          }
        } catch {
          // registry unreadable → wTarget stays undefined → ALLOW
        }
      }

      if (wTarget !== undefined) {
        const res = conductorFor({
          root: guardRoot,
          workspaceId: wTarget,
          ...(options.now !== undefined ? { now: options.now } : {})
        });
        if (
          res.conductor !== null &&
          canonicalAddress(res.conductor) !== canonicalAddress(selfInstance) &&
          finding.relanceCount === 0
        ) {
          options.log?.(
            `drumbeat: ${finding.instance} in ${wTarget} owned by conductor ${res.conductor}; deferring relance`
          );
          continue; // D2 suppression
        }
      }
    }
    // ── END GOV D2 ──────────────────────────────────────────────────────────

    // ── GOV D4: cross-workspace CoI advisory (warn only, never skip) ────────
    if (
      selfInstance !== undefined &&
      wSelf !== undefined &&
      wTarget !== undefined &&
      canonicalAddress(wSelf) !== canonicalAddress(wTarget)
    ) {
      options.log?.(
        `drumbeat: cross-workspace relance of ${finding.instance} (workspace ${wTarget}) by ${selfInstance} (workspace ${wSelf}) — no target-conductor mandate (advisory)`
      );
    }
    // ── END GOV D4 ──────────────────────────────────────────────────────────
    // ────────────────────────────────────────────────────────────────────────

    // Cost guard: relance cheaply until K relances, then consult the decider.
    if (!options.decider || finding.relanceCount < k) {
      if (await relauncher.relance(finding)) {
        markRelanced(root, finding.instance, options.now);
        relanced.push(finding.instance);
      }
      continue;
    }

    const decision = await options.decider.decide(finding);
    let applied: H2AReflexiveAction = decision.action;
    if (!options.enforce) {
      applied = "relance"; // advisory-first: log the verdict, do the safe default
    } else if (decision.action === "finish" && finding.workStatus !== "done") {
      applied = "escalate"; // `done` is the only safe-to-finish status (else never abandon)
    }

    switch (applied) {
      case "relance":
        if (await relauncher.relance(finding)) {
          markRelanced(root, finding.instance, options.now);
          relanced.push(finding.instance);
        }
        break;
      case "finish":
        clearDrumbeatEntry(root, finding.instance); // workStatus === "done": genuinely complete
        break;
      case "escalate":
        await options.onEscalate?.(finding, decision);
        markDrumbeatTerminal(root, finding.instance, "escalate", options.now);
        break;
      case "reroute":
        await options.onReroute?.(finding, decision);
        markDrumbeatTerminal(root, finding.instance, "reroute", options.now);
        break;
    }

    recordDrumbeatDecision(root, {
      instance: finding.instance,
      decided: decision.action,
      applied,
      ...(decision.reason ? { reason: decision.reason } : {}),
      decider: options.deciderLabel ?? "logging",
      enforced: options.enforce === true,
      at: new Date(options.now ?? Date.now()).toISOString()
    });
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
  onTick?: (result: DrumbeatTickResult) => void | Promise<void>;
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
    await options.onTick?.(result);
    if (options.signal?.aborted) break;
    await delay(intervalMs, options.signal);
  }
}
