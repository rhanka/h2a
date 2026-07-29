/**
 * Initial-prompt delivery for managed INTERACTIVE sessions.
 *
 * Measured on the real hosts (codex-cli 0.145.0, Claude Code 2.1.220) on
 * 2026-07-29, through the real `h2a run` path:
 *
 *  - `tmux new-session -d` returns as soon as the PANE exists. 15ms later the
 *    pane is still EMPTY: the CLI has drawn nothing. A prompt pasted then is
 *    ECHOED BY THE RAW TERMINAL — it is visibly "in the pane" while no composer
 *    exists to hold it — and the TUI discards it when it takes over the screen.
 *    Both profiles lost their brief that way and sat on their placeholder with
 *    ~0s of CPU while `run` reported state:"started".
 *  - `paste-buffer` WITHOUT `-p` submits a multi-line brief line by line: line 1
 *    became its own request while line 2 stayed in the composer. With `-p` the
 *    whole block lands as one entry that a single Enter submits.
 *  - An Enter fired while the host was still rendering was swallowed, leaving
 *    the brief composed but unsent — and the startup CPU burn (+1950ms) looked
 *    exactly like work.
 *  - Host modals swallow the brief the same silent way. THREE showed up in one
 *    afternoon: directory trust, "Update available!", "Hooks need review".
 *
 * Hence the shape of this module: type ONCE, into a host that has drawn its UI
 * and gone quiet, then prove the text is there, then submit, then judge work
 * against the host's own idle rate. Nothing here reports success because a tmux
 * command exited 0 — that is what let a launch claim `started` while the agent
 * was inert for 33 minutes.
 */

/** A host modal that will never be answered inside a background lane. */
export type HostModal = {
  readonly reason: string;
  readonly hint: string;
};

/**
 * A numbered choice list waiting on a key press. GENERIC on purpose: three
 * different codex modals were measured in one afternoon, so enumerating known
 * wordings would only ever list the ones that already bit us. What they share is
 * the shape — `› 1.` choices plus an explicit "press enter to …".
 */
const MODAL_CHOICE = /(^|\n)\s*[›>]?\s*1\.\s+\S/;
const MODAL_CONFIRM = /press (?:enter|return) to (?:continue|confirm|select)/i;

const NAMED_MODALS: ReadonlyArray<{
  readonly match: RegExp;
  readonly modal: HostModal;
}> = [
  {
    // Recorded per repository root, so a workspace outside an approved repo
    // blocks here — and nobody will ever answer it in a background lane.
    match: /do you trust the contents of this directory/i,
    modal: {
      reason: "the host is waiting on its directory-trust prompt",
      hint: "approve this directory once in an interactive session (the host records trust per repository root), then relaunch",
    },
  },
  {
    match: /update available/i,
    modal: {
      reason: "the host is waiting on its update prompt",
      hint: "answer the host update prompt once in an interactive session (or update the CLI), then relaunch",
    },
  },
  {
    match: /hooks (?:need review|are new or changed)|hook is new or changed/i,
    modal: {
      reason: "the host is waiting on its hook-review prompt",
      hint: "review/trust the changed hooks once in an interactive session in this workspace, then relaunch",
    },
  },
];

/**
 * Is the pane sitting on a host modal that consumes the brief? Returns the
 * exact reason so the launch can FAIL LOUDLY instead of waiting forever.
 */
export function detectHostModal(capture: string): HostModal | undefined {
  // A modal is a choice list AWAITING a key press. Requiring both halves keeps
  // passive banners (an "Update available!" notice above a live composer) from
  // failing a perfectly healthy launch.
  if (!MODAL_CHOICE.test(capture) || !MODAL_CONFIRM.test(capture)) {
    return undefined;
  }
  for (const entry of NAMED_MODALS) {
    if (entry.match.test(capture)) return entry.modal;
  }
  return {
    reason: "the host is waiting on a modal choice prompt",
    hint: "attach to the session, answer the host prompt once, then relaunch the lane",
  };
}

/** Collapse every whitespace run so a soft-wrapped composer still matches. */
export function normalizePaneText(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * Fingerprints used to PROVE the pasted text reached the composer — one from
 * each end.
 *
 * A composer that overflows shows only part of the brief, and which part it
 * keeps is a host rendering choice (measured: Claude Code keeps the HEAD and
 * cuts the tail). Looking for either end means the proof does not depend on
 * that choice.
 */
export function promptProbes(prompt: string): ReadonlyArray<string> {
  const tokens = prompt.trim().split(/\s+/).filter((t) => t.length > 0);
  const pick = (ordered: ReadonlyArray<string>): string | undefined => {
    for (const token of ordered) {
      if (token.length >= 4) {
        return token.length > 20 ? token.slice(0, 20) : token;
      }
    }
    return undefined;
  };
  const probes = [pick(tokens), pick([...tokens].reverse())].filter(
    (p): p is string => p !== undefined,
  );
  if (probes.length > 0) return [...new Set(probes)];
  return [prompt.replace(/\s+/g, "").slice(-8)];
}

/** How many times does the fingerprint appear in a pane capture? */
export function countOccurrences(capture: string, probe: string): number {
  if (probe.length === 0) return 0;
  const haystack = normalizePaneText(capture);
  const needle = normalizePaneText(probe);
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/**
 * Has the host actually DRAWN its interface?
 *
 * 15ms after `new-session` the pane is still empty, and a paste there is merely
 * echoed by the raw terminal. Requiring real drawn content is what separates
 * "the composer holds my brief" from "the terminal echoed my keystrokes".
 */
export function paneHasDrawnUi(capture: string, minLines = 3): boolean {
  return (
    capture.split("\n").filter((line) => line.trim().length > 0).length >=
    minLines
  );
}

export type PromptDeliveryDeps = {
  /** Visible text of the pane, or undefined when tmux cannot be read. */
  readonly capturePane: (pane: string) => string | undefined;
  /** Best-effort composer wipe (never relied upon: delivery types once). */
  readonly clearComposer: (pane: string) => boolean;
  /** Paste text as ONE bracketed block (no per-line submission). */
  readonly pasteBlock: (pane: string, text: string) => boolean;
  /** Send the single Enter that submits the composed block. */
  readonly submit: (pane: string) => boolean;
  /** CPU time consumed by the pane's process tree, in ms. */
  readonly cpuMs: (pane: string) => number | undefined;
  readonly sleep: (ms: number) => void;
  readonly now: () => number;
};

export type PromptDeliveryOptions = {
  /** Budget for the host to become ready (default 90s). */
  readonly timeoutMs?: number;
  /** Delay between readiness observations (default 750ms). */
  readonly pollMs?: number;
  /** Window in which real work must show up after submitting (default 30s). */
  readonly activityMs?: number;
  /** CPU above the host's idle rate that counts as work (default 300ms). */
  readonly activityCpuMs?: number;
  /** Sampling window used to decide the host has gone quiet (default 2s). */
  readonly quietMs?: number;
  /** CPU under which the host counts as quiet, per window (default 40ms). */
  readonly quietCpuMs?: number;
  /** How long to wait for the composer to RENDER the paste (default 8s). */
  readonly landedMs?: number;
};

export type PromptDeliveryResult =
  | {
      readonly state: "working";
      readonly waitedMs: number;
      readonly cpuDeltaMs: number;
    }
  | {
      readonly state: "submitted-idle";
      readonly waitedMs: number;
      readonly cpuDeltaMs: number;
    }
  | {
      readonly state: "host-modal";
      readonly reason: string;
      readonly hint: string;
      readonly capture: string;
    }
  | {
      readonly state: "undelivered";
      readonly reason: string;
      readonly waitedMs: number;
      readonly capture: string;
    };

const DEFAULTS = {
  timeoutMs: 90_000,
  pollMs: 750,
  activityMs: 30_000,
  // A booting TUI burns ~2s of CPU rendering its splash; an idle one burns ~0
  // (measured: 0s over 28s on a lane parked on its placeholder).
  activityCpuMs: 300,
  quietMs: 2_000,
  quietCpuMs: 40,
  landedMs: 8_000,
} as const;

/**
 * Sleep without spinning. `Atomics.wait` on a private SharedArrayBuffer is the
 * repo's synchronous-wait primitive (same as the local-files lock), so delivery
 * stays synchronous instead of rippling async through the launch path.
 */
export function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  const view = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const remaining = end - Date.now();
    if (remaining <= 0) return;
    Atomics.wait(view, 0, 0, Math.min(remaining, 25));
  }
}

/** Last non-empty lines of a capture, for an actionable failure message. */
export function captureTail(capture: string, lines = 6): string {
  return capture
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-lines)
    .join("\n");
}

/**
 * Wait until the host has drawn its UI AND stopped burning CPU — booted, and
 * genuinely waiting for input. Returns the idle CPU RATE (ms of CPU per ms of
 * wall clock) measured on the quiet window, which calibrates what counts as
 * real work later.
 */
function waitUntilReady(
  pane: string,
  deps: PromptDeliveryDeps,
  options: {
    quietMs: number;
    quietCpuMs: number;
    timeoutMs: number;
    pollMs: number;
  },
):
  | { readonly ok: true; readonly idleRate: number }
  | { readonly ok: false; readonly unreadable: boolean } {
  const deadline = deps.now() + options.timeoutMs;
  let unreadable = 0;
  for (;;) {
    const capture = deps.capturePane(pane);
    if (capture === undefined) {
      unreadable += 1;
      if (unreadable >= 3) return { ok: false, unreadable: true };
    } else if (paneHasDrawnUi(capture)) {
      unreadable = 0;
      const before = deps.cpuMs(pane);
      if (before !== undefined) {
        const startedAt = deps.now();
        deps.sleep(options.quietMs);
        const after = deps.cpuMs(pane);
        const elapsed = Math.max(1, deps.now() - startedAt);
        if (after !== undefined && after - before <= options.quietCpuMs) {
          return { ok: true, idleRate: Math.max(0, after - before) / elapsed };
        }
      }
    }
    if (deps.now() >= deadline) return { ok: false, unreadable: false };
    deps.sleep(options.pollMs);
  }
}

/**
 * Deliver `prompt` to a live agent pane and REPORT WHAT WAS OBSERVED.
 *
 * Types the brief EXACTLY ONCE. Retrying a paste is what stacked twelve copies
 * of a brief into one composer when a wipe silently failed, so a brief that
 * cannot be proven present is a failure to report, never a paste to repeat.
 */
export function deliverInitialPrompt(
  pane: string,
  prompt: string,
  deps: PromptDeliveryDeps,
  options: PromptDeliveryOptions = {},
): PromptDeliveryResult {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const pollMs = options.pollMs ?? DEFAULTS.pollMs;
  const activityMs = options.activityMs ?? DEFAULTS.activityMs;
  const activityCpuMs = options.activityCpuMs ?? DEFAULTS.activityCpuMs;
  const quietMs = options.quietMs ?? DEFAULTS.quietMs;
  const quietCpuMs = options.quietCpuMs ?? DEFAULTS.quietCpuMs;
  const landedMs = options.landedMs ?? DEFAULTS.landedMs;
  const probes = promptProbes(prompt);
  const startedAt = deps.now();

  // 1. Only ever type into a host that has drawn its UI and gone quiet.
  const ready = waitUntilReady(pane, deps, {
    quietMs,
    quietCpuMs,
    timeoutMs,
    pollMs,
  });
  if (!ready.ok) {
    return {
      state: "undelivered",
      reason: ready.unreadable
        ? "the agent pane could not be read (tmux capture-pane failed)"
        : "the host never finished starting up (no drawn interface at rest), so the prompt was never typed",
      waitedMs: deps.now() - startedAt,
      capture: captureTail(deps.capturePane(pane) ?? ""),
    };
  }

  // 2. A modal will never be answered by a background lane.
  const before = deps.capturePane(pane) ?? "";
  const modal = detectHostModal(before);
  if (modal) {
    return {
      state: "host-modal",
      reason: modal.reason,
      hint: modal.hint,
      capture: captureTail(before),
    };
  }

  // 3. Type once, as one bracketed block.
  const baseline = probes.map((probe) => countOccurrences(before, probe));
  deps.clearComposer(pane);
  if (!deps.pasteBlock(pane, prompt)) {
    return {
      state: "undelivered",
      reason: "tmux refused to paste the prompt into the agent pane",
      waitedMs: deps.now() - startedAt,
      capture: captureTail(before),
    };
  }

  // 4. Prove it landed. The composer needs a moment to RENDER what it received:
  // reading the pane back instantly declared a perfectly good paste lost on
  // Claude Code. So poll — never paste again, only look again.
  let after = "";
  let landed = false;
  const landedDeadline = deps.now() + landedMs;
  for (;;) {
    after = deps.capturePane(pane) ?? after;
    // A modal raised by the paste hides the composer: name that case rather
    // than blaming a lost paste.
    const pasteModal = detectHostModal(after);
    if (pasteModal) {
      return {
        state: "host-modal",
        reason: pasteModal.reason,
        hint: pasteModal.hint,
        capture: captureTail(after),
      };
    }
    landed = probes.some(
      (probe, index) => countOccurrences(after, probe) > baseline[index]!,
    );
    if (landed || deps.now() >= landedDeadline) break;
    deps.sleep(pollMs);
  }
  if (!landed) {
    deps.clearComposer(pane); // leave nothing half-typed behind
    return {
      state: "undelivered",
      reason:
        "the brief never appeared in the composer, so it was not submitted (nothing was retyped: a second paste would stack a duplicate)",
      waitedMs: deps.now() - startedAt,
      capture: captureTail(after),
    };
  }

  // 5. One Enter submits the whole block.
  const cpuBefore = deps.cpuMs(pane) ?? 0;
  const submittedAt = deps.now();
  if (!deps.submit(pane)) {
    return {
      state: "undelivered",
      reason: "the prompt reached the composer but tmux could not submit it",
      waitedMs: deps.now() - startedAt,
      capture: captureTail(after),
    };
  }

  // 6. Judge work against THE HOST'S OWN idle rate, never a flat number: an
  // idling codex still burned 420ms over 30s, which a fixed threshold read as
  // "working" while nothing had been submitted at all.
  const activityDeadline = submittedAt + activityMs;
  for (;;) {
    deps.sleep(pollMs);
    const cpuDeltaMs = (deps.cpuMs(pane) ?? cpuBefore) - cpuBefore;
    const idleBudget = ready.idleRate * (deps.now() - submittedAt);
    if (cpuDeltaMs - idleBudget >= activityCpuMs) {
      return { state: "working", waitedMs: deps.now() - startedAt, cpuDeltaMs };
    }
    if (deps.now() >= activityDeadline) {
      return {
        state: "submitted-idle",
        waitedMs: deps.now() - startedAt,
        cpuDeltaMs,
      };
    }
  }
}
