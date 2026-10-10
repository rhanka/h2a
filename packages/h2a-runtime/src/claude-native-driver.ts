/** Claude launch: one paste/Enter, a shared deadline, and correlated evidence only. */
import { existsSync, statSync } from "node:fs";
import type { LaunchGuard } from "./launch-guard.js";
import {
  detectCollapsedPaste, collapsedPasteMatches, countOccurrences, detectHostModal,
  paneHasBlockingActivity, paneIsReady, promptProbes,
  type PromptDeliveryDeps, type PromptDeliveryResult,
} from "./prompt-delivery.js";
import { ClaudeDebugReader, parseClaudeDebugEvents } from "./claude-debug-adapter.js";

export type ClaudeNativeDeliveryDeps = {
  capturePane: (name: string) => string | undefined | Promise<string | undefined>;
  clearComposer: (name: string) => boolean | Promise<boolean>;
  pasteBlock: (name: string, text: string) => boolean | Promise<boolean>;
  submit: (name: string) => boolean | Promise<boolean>;
  sleep: (ms: number) => void | Promise<void>;
  now: () => number;
};
export type ClaudeNativeDriverOptions = {
  launchGuard?: LaunchGuard | undefined;
  debugFile?: string | undefined;
  requiredMcps?: string[] | undefined;
  requiredMcpProof?: (() => boolean) | undefined;
  correlatedResponse?: (() => boolean) | undefined;
  correlatedPrompt?: (() => boolean) | undefined;
  diagnosticHealthy?: (() => boolean) | undefined;
  qualifiedDiagnostic?: boolean | undefined;
  requestedAt?: number | undefined;
  pacingMs?: number | undefined;
  readinessTimeoutMs?: number | undefined;
  observationTimeoutMs?: number | undefined;
  onPhase?: ((phase: string, at: number) => void) | undefined;
  publicationCheck?: ((check: () => string | undefined) => void) | undefined;
};

export async function deliverClaudeNativePrompt(name: string, prompt: string, deps: ClaudeNativeDeliveryDeps | PromptDeliveryDeps,
  options: ClaudeNativeDriverOptions = {}): Promise<PromptDeliveryResult> {
  const startedAt = options.requestedAt ?? deps.now();
  const deadline = startedAt + Math.min(15000, options.observationTimeoutMs ?? 15000);
  let submitted = false, lastScreen = "", nextPoll = 0;
  const failure = (reason: string): PromptDeliveryResult => submitted
    ? { state: "launch-unconfirmed", reason, waitedMs: deps.now() - startedAt, submitAttempted: true }
    : { state: "undelivered", reason, waitedMs: deps.now() - startedAt, capture: lastScreen };
  const capture = async () => {
    // The single schedule covers every native observation, with no catch-up burst.
    const wait = nextPoll - deps.now();
    if (wait > 0) await deps.sleep(Math.min(wait, Math.max(0, deadline - deps.now())));
    if (deps.now() >= deadline) throw new Error("launch observation deadline expired");
    nextPoll = deps.now() + 275;
    lastScreen = await deps.capturePane(name) ?? "";
    return lastScreen;
  };
  const ready = (screen: string) => !detectHostModal(screen) && !paneHasBlockingActivity(screen) && paneIsReady(screen, "claude");
  const required = options.requiredMcps ?? [];
  const debug = options.debugFile ? new ClaudeDebugReader(options.debugFile) : undefined;
  const connected = new Set<string>(), capabilities = new Set<string>();
  const mcpsReady = () => {
    if (options.diagnosticHealthy?.() === false) return false;
    if (debug) {
      const chunk = debug.read();
      if (chunk.error) return false;
      const analysis = parseClaudeDebugEvents(chunk.content);
      analysis.connectedMcps.forEach(m => connected.add(m));
      analysis.capableMcps.forEach(m => capabilities.add(m));
    }
    return required.every(m => connected.has(m) && capabilities.has(m)) &&
      (required.length === 0 || options.requiredMcpProof?.() === true);
  };
  try {
    for (;;) {
      const screen = await capture();
      const modal = detectHostModal(screen);
      if (modal) return { state: "host-modal", reason: modal.reason, hint: modal.hint, capture: screen };
      if (ready(screen)) options.onPhase?.("composerReadyMs", deps.now() - startedAt);
      if (ready(screen) && mcpsReady()) { options.onPhase?.("requiredMcpsReadyMs", deps.now() - startedAt); break; }
      if (deps.now() >= deadline) return failure("composer or required MCP evidence missing within the launch budget");
    }
    const pacing = options.pacingMs ?? 250;
    if (pacing > 0) await deps.sleep(Math.min(pacing, Math.max(0, deadline - deps.now())));
    const before = await capture();
    if (!ready(before) || !mcpsReady()) return failure("composer or MCP readiness changed before paste");
    const oldMarker = detectCollapsedPaste(before);
    const exact = prompt.replace(/\s+/g, "");
    const baseline = countOccurrences(before.replace(/\s+/g, ""), exact);
    if (!await deps.pasteBlock(name, prompt)) return failure("could not paste the brief");
    let evidence: "composer-text" | "collapsed-paste" = "composer-text";
    for (;;) {
      const after = await capture();
      if (!ready(after)) return failure("composer became blocked after paste");
      const marker = detectCollapsedPaste(after);
      if (marker) {
        const stale = oldMarker && marker.kind === oldMarker.kind && marker.value === oldMarker.value;
        if (!stale && collapsedPasteMatches(marker, prompt)) { evidence = "collapsed-paste"; break; }
        // Quantitative truncation/stale markers always take precedence over words.
      } else if (countOccurrences(after.replace(/\s+/g, ""), exact) > baseline) break;
    }
    if (!mcpsReady()) return failure("required MCP evidence lost before Enter");
    // Cursor starts at a complete-line boundary; pre-Enter events cannot confirm this turn.
    const dispatch = options.debugFile ? new ClaudeDebugReader(options.debugFile,
      existsSync(options.debugFile) ? statSync(options.debugFile).size : 0) : undefined;
    options.launchGuard?.markSubmitAttempted();
    options.onPhase?.("submitAttemptedMs", deps.now() - startedAt);
    submitted = true; // A failed write/timeout after this point is still potential submission.
    if (!await deps.submit(name)) return failure("Enter delivery could not be confirmed");
    let settled = false, turn = false, dispatched = false;
    const refusal = () => {
      if (options.diagnosticHealthy?.() === false) return "diagnostic collector lost integrity";
      // A dispatch in an early block must not hide a refusal queued later.
      // Drain bounded retained records before publishing; incomplete records
      // remain uncertainty rather than proof of a clean diagnostic boundary.
      for (;;) {
        if (deps.now() >= deadline) return "launch observation deadline expired";
        const chunk = dispatch?.read();
        if (chunk?.error) return chunk.error;
        const analysis = parseClaudeDebugEvents(chunk?.content ?? "");
        if (analysis.providerRefusal || analysis.hookVeto) return "provider refusal observed before launch publication";
        if (!chunk?.more) break;
        if (!chunk.content) return "Claude diagnostic ends with an incomplete record";
      }
      if (options.qualifiedDiagnostic === true && dispatched && options.correlatedPrompt?.() !== true)
        return "conversation or prompt correlation lost before launch publication";
      return undefined;
    };
    options.publicationCheck?.(refusal);
    for (;;) {
      if (options.diagnosticHealthy?.() === false) return failure("diagnostic collector lost integrity");
      const chunk = dispatch?.read();
      if (chunk?.error) return failure(chunk.error);
      if (chunk?.content) {
        const analysis = parseClaudeDebugEvents(chunk.content);
        if (analysis.providerRefusal) return { state: "provider-blocked", reason: "provider refused the submitted request",
          waitedMs: deps.now() - startedAt, evidence, capture: lastScreen };
        if (analysis.hookVeto) return { state: "provider-blocked", reason: "a blocking hook rejected the prompt",
          waitedMs: deps.now() - startedAt, evidence, capture: lastScreen };
        for (const event of analysis.events) {
          if (event === "hooks-settled") settled = true;
          else if (event === "turn-start") { if (!settled || turn) return failure("unexpected or concurrent turn"); turn = true; }
          else if (event === "main-dispatch") { if (!settled || !turn) return failure("dispatch without the qualified hook/turn sequence"); dispatched = true; }
        }
      }
      const quick = options.qualifiedDiagnostic === true && dispatched && options.correlatedPrompt?.() === true;
      if (options.correlatedResponse?.() === true || quick) {
        const proof = quick ? "host-request-dispatched" : "correlated-response";
        options.onPhase?.(proof === "host-request-dispatched" ? "dispatchObservedMs" : "firstResponseMs", deps.now() - startedAt);
        // Fenced capture checks incarnation/input epoch and visible refusal before publication.
        const screen = await capture();
        const lost = refusal();
        if (lost) return lost === "provider refusal observed before launch publication"
          ? { state: "provider-blocked", reason: lost, waitedMs: deps.now() - startedAt, evidence, capture: screen }
          : failure(lost);
        if (/usage limit reached|quota (?:exceeded|exhausted)|insufficient credits|authentication failed|invalid api key/i.test(screen))
          return { state: "provider-blocked", reason: "provider rejected the submitted prompt", waitedMs: deps.now() - startedAt, evidence, capture: screen };
        options.onPhase?.("lastRequiredProofMs", deps.now() - startedAt);
        return { state: "working", waitedMs: deps.now() - startedAt, cpuDeltaMs: 0, evidence, proof };
      }
      if (deps.now() >= deadline) return failure("dispatch or correlated response missing within the launch budget");
      // File observations do not spawn op.js and can be frequent without a native probe storm.
      await deps.sleep(Math.min(25, deadline - deps.now()));
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Another controller may already have submitted a task. Losing ownership
    // cannot establish non-submission, even before our own Enter was attempted.
    if (/input epoch|launch ownership|launch changed during observation/i.test(reason)) {
      submitted = true;
      try { options.launchGuard?.markSubmitAttempted(); } catch { /* Atomic epoch-fenced cleanup also preserves the session. */ }
    }
    return failure(reason);
  }
}
