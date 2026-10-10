/**
 * Fast native driver for Claude interactive launch.
 * Implements the 9-step sequence from SPEC r2:
 * 1. Observation du composer Claude dans l'écran VT rendu (exclusion modals/compaction).
 * 2. Attente de la barrière des MCP obligatoires.
 * 3. Revalidation du composer et de l'incarnation.
 * 4. Un seul collage en bracketed paste.
 * 5. Contrôle de l'arrivée du prompt.
 * 6. Persistance durable monotone de submitAttempted avant Enter.
 * 7. Envoi d'un seul Enter de soumission.
 * 8. Attente d'une preuve corrélée rapide indépendante de la CPU.
 * 9. Publication du résultat.
 */

import { existsSync, statSync } from "node:fs";
import type { LaunchGuard } from "./launch-guard.js";
import {
  detectCollapsedPaste,
  collapsedPasteMatches,
  countOccurrences,
  detectHostModal,
  paneHasBlockingActivity,
  paneIsReady,
  promptProbes,
  type PromptDeliveryDeps,
  type PromptDeliveryResult,
} from "./prompt-delivery.js";
import {
  parseClaudeDebugEvents,
  readClaudeDebugIncremental,
} from "./claude-debug-adapter.js";

export type ClaudeNativeDriverOptions = {
  launchGuard?: LaunchGuard | undefined;
  debugFile?: string | undefined;
  requiredMcps?: string[] | undefined;
  pacingMs?: number | undefined;
  readinessTimeoutMs?: number | undefined;
  observationTimeoutMs?: number | undefined;
};

export function deliverClaudeNativePrompt(
  name: string,
  prompt: string,
  deps: PromptDeliveryDeps,
  options: ClaudeNativeDriverOptions = {},
): PromptDeliveryResult {
  const startedAt = deps.now();
  const readinessDeadline = startedAt + (options.readinessTimeoutMs ?? 30_000);
  const pacingMs = options.pacingMs ?? 150;
  const observationTimeoutMs = options.observationTimeoutMs ?? 15_000;

  // 1. Observation du composer Claude
  let composerCapture: string | undefined;
  for (;;) {
    const capture = deps.capturePane(name);
    if (capture !== undefined) {
      const modal = detectHostModal(capture);
      if (modal) {
        return {
          state: "host-modal",
          reason: modal.reason,
          hint: modal.hint,
          capture,
        };
      }
      if (!paneHasBlockingActivity(capture) && paneIsReady(capture, "claude")) {
        composerCapture = capture;
        break;
      }
    }
    if (deps.now() >= readinessDeadline) {
      return {
        state: "undelivered",
        reason: "the Claude composer was not ready within the deadline",
        waitedMs: deps.now() - startedAt,
        capture: capture ?? "",
      };
    }
    deps.sleep(50);
  }

  // 2. Attente des MCP obligatoires (barrière MCP avant Enter)
  const requiredMcps = options.requiredMcps ?? [];
  if (requiredMcps.length > 0 && options.debugFile) {
    const mcpDeadline = deps.now() + 20_000;
    let mcpOffset = 0;
    const connected = new Set<string>();
    while (deps.now() < mcpDeadline) {
      if (existsSync(options.debugFile)) {
        const { content, newOffset } = readClaudeDebugIncremental(
          options.debugFile,
          mcpOffset,
        );
        mcpOffset = newOffset;
        if (content) {
          const analysis = parseClaudeDebugEvents(content);
          for (const m of analysis.connectedMcps) {
            connected.add(m);
          }
        }
      }
      const allReady = requiredMcps.every((m) => connected.has(m));
      if (allReady) break;
      deps.sleep(50);
    }
  }

  // 3. Revalidation du composer et temporisation anti-swallowed Enter
  const currentCapture = deps.capturePane(name) ?? "";
  if (detectHostModal(currentCapture)) {
    const modal = detectHostModal(currentCapture)!;
    return {
      state: "host-modal",
      reason: modal.reason,
      hint: modal.hint,
      capture: currentCapture,
    };
  }
  if (pacingMs > 0) {
    deps.sleep(pacingMs);
  }

  // 4. Un seul collage en bracketed paste
  const beforePaste = deps.capturePane(name) ?? "";
  const probes = promptProbes(prompt);
  const baselineCounts = probes.map((p) => countOccurrences(beforePaste, p));

  if (!deps.pasteBlock(name, prompt)) {
    return {
      state: "undelivered",
      reason: "could not paste prompt into the Claude pane",
      waitedMs: deps.now() - startedAt,
      capture: beforePaste,
    };
  }

  // 5. Contrôle de l'arrivée du prompt dans le composer
  const landedDeadline = deps.now() + 6_000;
  let landed = false;
  let collapsed = false;
  let lastScreen = beforePaste;

  for (;;) {
    const after = deps.capturePane(name) ?? "";
    lastScreen = after;
    const marker = detectCollapsedPaste(after);
    if (marker && collapsedPasteMatches(marker, prompt)) {
      landed = true;
      collapsed = true;
      break;
    }
    const counts = probes.map((p) => countOccurrences(after, p));
    const landedProbes = counts.filter((c, i) => c > baselineCounts[i]!).length;
    if (landedProbes > 0) {
      landed = true;
      break;
    }
    if (deps.now() >= landedDeadline) break;
    deps.sleep(50);
  }

  if (!landed) {
    deps.clearComposer(name);
    return {
      state: "undelivered",
      reason: "the brief never appeared in the composer, so it was not submitted",
      waitedMs: deps.now() - startedAt,
      capture: lastScreen,
    };
  }

  // 6. Persistance durable monotone de submitAttempted avant Enter
  if (options.launchGuard) {
    options.launchGuard.markSubmitAttempted();
  }

  // Initial debug log offset before Enter
  let debugOffset = 0;
  if (options.debugFile && existsSync(options.debugFile)) {
    try {
      debugOffset = statSync(options.debugFile).size;
    } catch {}
  }

  // 7. Envoi d'un seul Enter de soumission
  const submittedAt = deps.now();
  if (!deps.submit(name)) {
    return {
      state: "undelivered",
      reason: "the prompt reached the composer but could not be submitted",
      waitedMs: deps.now() - startedAt,
      capture: lastScreen,
    };
  }

  // 8. Attente d'une preuve corrélée rapide (< 250ms à chaud, max 15s)
  const observationDeadline = submittedAt + observationTimeoutMs;
  const evidence = collapsed ? "collapsed-paste" : "composer-text";

  for (;;) {
    // 8a. Inspection incrémentale du debug log (host-request-dispatched)
    if (options.debugFile && existsSync(options.debugFile)) {
      const { content, newOffset } = readClaudeDebugIncremental(
        options.debugFile,
        debugOffset,
      );
      debugOffset = newOffset;
      if (content) {
        const analysis = parseClaudeDebugEvents(content);
        if (analysis.hookVeto) {
          return {
            state: "provider-blocked",
            reason: "a pre-submit hook rejected the prompt",
            waitedMs: deps.now() - startedAt,
            evidence,
            capture: deps.capturePane(name) ?? "",
          };
        }
        if (analysis.mainThreadDispatched) {
          return {
            state: "working",
            waitedMs: deps.now() - startedAt,
            cpuDeltaMs: 0,
            evidence,
          };
        }
      }
    }

    // 8b. Inspection VT de l'écran (réponse rapide, activité ou limite)
    const currentScreen = deps.capturePane(name) ?? "";
    const providerLimit =
      /usage limit reached|you(?:'|’)?ve hit[^\n]*(?:limit|quota)|quota (?:exceeded|exhausted)|rate limit (?:reached|exceeded)|insufficient (?:credits|quota)/i;
    if (providerLimit.test(currentScreen) && !providerLimit.test(beforePaste)) {
      return {
        state: "provider-blocked",
        reason: "the provider rejected the submitted prompt: usage/quota limit",
        waitedMs: deps.now() - startedAt,
        evidence,
        capture: currentScreen,
      };
    }

    const tuiActivity =
      (/esc to interrupt/i.test(currentScreen) && !/esc to interrupt/i.test(beforePaste)) ||
      (/LAB_READY/.test(currentScreen) && !/LAB_READY/.test(beforePaste));

    if (tuiActivity) {
      return {
        state: "working",
        waitedMs: deps.now() - startedAt,
        cpuDeltaMs: 0,
        evidence,
      };
    }

    if (deps.now() >= observationDeadline) {
      // 15s observation budget expired without proof:
      // Invariant L1: Monotonic submitAttempted -> launch-unconfirmed, DO NOT KILL!
      return {
        state: "launch-unconfirmed",
        reason: "the brief was submitted but dispatch could not be confirmed within the observation budget",
        waitedMs: deps.now() - startedAt,
        evidence,
        submitAttempted: true,
      };
    }

    deps.sleep(50);
  }
}
