import { describe, expect, it } from "vitest";

import {
  captureTail,
  collapsedPasteMatches,
  countOccurrences,
  deliverInitialPrompt,
  detectCollapsedPaste,
  detectHostModal,
  paneHasDrawnUi,
  promptProbes,
  type PromptDeliveryDeps,
} from "./prompt-delivery.js";

// VERBATIM captures taken from the real hosts on 2026-07-29 (codex-cli 0.145.0,
// Claude Code 2.1.220) while reproducing the lost-brief defect. Fixtures are
// measured, not invented: an invented modal is how a detector ends up matching
// nothing that actually happens.

/** A DRAWN composer at rest — the only state delivery is allowed to type into. */
const COMPOSER = `╭──────────────────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.145.0)                               │
│ model:     gpt-5.6-terra xhigh   fast   /model to change │
│ directory: ~/src/h2a                                     │
╰──────────────────────────────────────────────────────────╯
› Explain this codebase
  gpt-5.6-terra xhigh fast · ~/src/h2a`;

const TRUST_MODAL = `> You are in /home/antoinefa/.cache-tmp/claude-1000/scratchpad
  Note: You're in a subdirectory of a Git project. Trusting will apply to the repository root:
  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk
› 1. Yes, continue
  2. No, quit
  Press enter to continue`;

const UPDATE_MODAL = `  ✨ Update available! 0.145.0 -> 0.146.0
  Release notes: https://github.com/openai/codex/releases/latest
› 1. Update now (runs \`npm install -g @openai/codex\`)
  2. Skip
  3. Skip until next version
  Press enter to continue`;

const HOOKS_MODAL = `  Hooks need review
  1 hook is new or changed.
  Hooks can run outside the sandbox after you trust them.
› 1. Review hooks
  2. Trust all and continue
  3. Continue without trusting (hooks won't run)
  Press enter to confirm or esc to go back`;

/** Same "Update available!" wording as a passive banner over a live composer. */
const UPDATE_BANNER = `│ ✨ Update available! 0.145.0 -> 0.146.0         │
│ Run npm install -g @openai/codex to update.     │
│ >_ OpenAI Codex (v0.145.0)                      │
› Explain this codebase
  gpt-5.6-terra xhigh fast · ~/src/h2a`;

/**
 * Fake pane.
 *
 * CPU accrues with the CLOCK, not per observation — that is how /proc behaves,
 * and modelling it per call made an idle host look busier the more often it was
 * sampled, which silently changed what the calibration compared against.
 */
function fakePane(options: {
  /** Captures returning an EMPTY pane before the UI is drawn. */
  drawnAfterCalls?: number;
  /** CPU ms burned per second of wall clock while idle (host's own noise). */
  idleCpuPerSec?: number;
  /** CPU ms per second of wall clock once the prompt has been submitted. */
  workCpuPerSec?: number;
  /** Screen shown instead of a composer. */
  screen?: string;
  /** Screen that replaces the composer once the brief is pasted. */
  screenAfterPaste?: string;
  /** The host discards the paste (nothing lands in the composer). */
  pasteDiscarded?: boolean;
  /** Captures after the paste that still show an empty composer (render lag). */
  renderLagCaptures?: number;
  /** cpuMs() returns undefined from the Nth call onwards (unreadable tree). */
  cpuUnreadableFromCall?: number;
  /** CPU ms subtracted once the quiet window ends (a child left the tree). */
  cpuDropAfterQuiet?: number;
  pasteFails?: boolean;
  submitFails?: boolean;
  captureFails?: boolean;
}) {
  const calls = {
    captures: 0,
    clears: 0,
    pastes: [] as string[],
    submits: 0,
    cpuReads: 0,
  };
  let composer = "";
  let submittedAt: number | undefined;
  let clock = 0;
  let capturesSincePaste = 0;

  const deps: PromptDeliveryDeps = {
    capturePane: () => {
      calls.captures += 1;
      if (options.captureFails) return undefined;
      if (calls.captures <= (options.drawnAfterCalls ?? 0)) return "";
      if (composer !== "" && options.screenAfterPaste !== undefined) {
        return options.screenAfterPaste;
      }
      // The host received the text but has not repainted the composer yet.
      if (calls.pastes.length > 0) {
        capturesSincePaste += 1;
        if (capturesSincePaste <= (options.renderLagCaptures ?? 0)) {
          return options.screen ?? COMPOSER;
        }
      }
      return `${options.screen ?? COMPOSER}\n${composer}`;
    },
    clearComposer: () => {
      calls.clears += 1;
      composer = "";
      return true;
    },
    pasteBlock: (_pane, text) => {
      calls.pastes.push(text);
      if (options.pasteFails) return false;
      if (!options.pasteDiscarded) composer = text;
      return true;
    },
    submit: () => {
      calls.submits += 1;
      if (options.submitFails) return false;
      submittedAt = clock;
      return true;
    },
    cpuMs: () => {
      calls.cpuReads += 1;
      if (
        options.cpuUnreadableFromCall !== undefined &&
        calls.cpuReads >= options.cpuUnreadableFromCall
      ) {
        return undefined; // tree unreadable: unknown, NOT zero
      }
      const idle = ((options.idleCpuPerSec ?? 0) * clock) / 1000;
      const work =
        submittedAt === undefined
          ? 0
          : ((options.workCpuPerSec ?? 0) * (clock - submittedAt)) / 1000;
      // A live-descendant total is NOT monotonic: when a child exits, the total
      // falls. `10 +` stands for the long-lived process's own lifetime CPU.
      const drop =
        options.cpuDropAfterQuiet !== undefined && calls.cpuReads > 2
          ? options.cpuDropAfterQuiet
          : 0;
      return 10 + idle + work - drop;
    },
    sleep: (ms) => {
      clock += ms;
    },
    now: () => {
      clock += 1; // every observation advances the clock, so budgets terminate
      return clock;
    },
  };
  return { deps, calls };
}

describe("paneHasDrawnUi", () => {
  it("rejects the empty pane that exists before the TUI draws anything", () => {
    // Measured: 15ms after `new-session` the capture is empty, and a paste there
    // is only echoed by the raw terminal before being discarded.
    expect(paneHasDrawnUi("")).toBe(false);
    expect(paneHasDrawnUi("\n\n")).toBe(false);
  });

  it("accepts a drawn composer", () => {
    expect(paneHasDrawnUi(COMPOSER)).toBe(true);
  });
});

describe("promptProbes", () => {
  it("fingerprints BOTH ends, because which end an overflowing composer keeps is a host choice", () => {
    expect(promptProbes("read COMMON.md then start the lane on WP5-item")).toEqual(
      ["read", "WP5-item"],
    );
  });

  it("skips tokens too short to be a fingerprint", () => {
    expect(promptProbes("do the thing ok")).toEqual(["thing"]);
  });

  it("falls back to tail characters when every token is tiny", () => {
    expect(promptProbes("a b c")).toEqual(["abc"]);
  });
});

describe("detectCollapsedPaste / collapsedPasteMatches", () => {
  // VERBATIM: a 10977-character, 72-line brief pasted into each host. The
  // brief's own words appear NOWHERE — only the marker does. A fingerprint-only
  // proof would therefore reject every long brief, and lane briefs are long.
  const CODEX_COLLAPSED = "› [Pasted Content 10977 chars]\n  gpt-5.6-terra xhigh fast";
  const CLAUDE_COLLAPSED = "❯ [Pasted text #1 +71 lines]\n  paste again to expand";

  const brief = (() => {
    const lines = ["head"];
    for (let i = 0; i < 70; i += 1) lines.push(`filler ${i}`);
    lines.push("tail");
    return lines.join("\n");
  })();

  it("reads the char count codex reports", () => {
    expect(detectCollapsedPaste(CODEX_COLLAPSED)).toEqual({
      kind: "chars",
      value: 10977,
    });
  });

  it("reads the added-line count claude reports", () => {
    expect(detectCollapsedPaste(CLAUDE_COLLAPSED)).toEqual({
      kind: "lines",
      value: 71,
    });
  });

  it("is absent on an ordinary composer", () => {
    expect(detectCollapsedPaste(COMPOSER)).toBeUndefined();
  });

  it("accepts a line count that accounts for the brief", () => {
    // 72 lines sent, reported as "+71 lines".
    expect(collapsedPasteMatches({ kind: "lines", value: 71 }, brief)).toBe(true);
  });

  it("REJECTS a marker that accounts for less than what was sent", () => {
    // This is the truncation cond measured: the host held only part of the
    // brief. Accepting it would ship a silently amputated brief.
    expect(collapsedPasteMatches({ kind: "lines", value: 12 }, brief)).toBe(false);
    expect(collapsedPasteMatches({ kind: "chars", value: 1155 }, brief)).toBe(
      false,
    );
  });

  it("tolerates the byte-vs-codepoint difference on accented text", () => {
    const accented = "réveille la lane, vérifie l'état, puis arrête-toi";
    const bytes = Buffer.byteLength(accented, "utf8");
    const points = [...accented].length;
    expect(bytes).not.toBe(points); // the two really do differ here
    expect(collapsedPasteMatches({ kind: "chars", value: bytes }, accented)).toBe(
      true,
    );
    expect(
      collapsedPasteMatches({ kind: "chars", value: points }, accented),
    ).toBe(true);
  });
});

describe("countOccurrences", () => {
  it("matches across a soft-wrapped composer", () => {
    expect(countOccurrences("mark\ner-token here", "mark er-token")).toBe(1);
  });

  it("counts every occurrence, so a paste is proven by an INCREASE not by presence", () => {
    expect(countOccurrences("tok … tok", "tok")).toBe(2);
  });
});

describe("detectHostModal", () => {
  it("names the directory-trust prompt", () => {
    const modal = detectHostModal(TRUST_MODAL);
    expect(modal?.reason).toContain("directory-trust");
    expect(modal?.hint).toContain("relaunch");
  });

  it("names the update prompt", () => {
    expect(detectHostModal(UPDATE_MODAL)?.reason).toContain("update prompt");
  });

  it("names the hook-review prompt", () => {
    expect(detectHostModal(HOOKS_MODAL)?.reason).toContain("hook-review");
  });

  it("catches an UNKNOWN modal by shape, not by wording", () => {
    // Three different modals appeared in one afternoon; a wording list would
    // only ever cover the ones that already bit us.
    const modal = detectHostModal(
      "Something entirely new happened\n› 1. Accept\n  2. Refuse\n  Press enter to confirm",
    );
    expect(modal?.reason).toContain("modal choice prompt");
    expect(modal?.hint).toContain("answer the host prompt");
  });

  it("does not mistake the passive update BANNER for a blocking modal", () => {
    expect(detectHostModal(UPDATE_BANNER)).toBeUndefined();
  });

  it("stays quiet on an ordinary composer", () => {
    expect(detectHostModal(COMPOSER)).toBeUndefined();
  });
});

describe("deliverInitialPrompt", () => {
  it("waits for a drawn, settled host before typing, then submits once", () => {
    const { deps, calls } = fakePane({
      drawnAfterCalls: 4, // pane exists, nothing drawn yet
      workCpuPerSec: 1000,
    });

    const result = deliverInitialPrompt("%1", "start the lane on WP5", deps);

    expect(result.state).toBe("working");
    if (result.state !== "working") return;
    expect(result.cpuDeltaMs).toBeGreaterThanOrEqual(300);
    expect(calls.pastes).toHaveLength(1); // typed exactly once
    expect(calls.submits).toBe(1);
  });

  it("never types into a pane that never draws its UI", () => {
    // THE DEFECT: this is the window where the brief used to be pasted into a
    // raw terminal and silently discarded, while run reported state:"started".
    const { deps, calls } = fakePane({ drawnAfterCalls: Number.MAX_SAFE_INTEGER });

    const result = deliverInitialPrompt("%1", "start the lane", deps, {
      timeoutMs: 5_000,
      pollMs: 500,
    });

    expect(result.state).toBe("undelivered");
    if (result.state !== "undelivered") return;
    expect(result.reason).toContain("never finished starting up");
    expect(calls.pastes).toHaveLength(0);
    expect(calls.submits).toBe(0);
  });

  it("never types into a host that keeps burning CPU", () => {
    // MEASURED: an Enter sent 831ms after the pane existed was swallowed by a
    // still-rendering Claude Code, and its startup CPU (+1950ms) read as work.
    const { deps, calls } = fakePane({ idleCpuPerSec: 900 });

    const result = deliverInitialPrompt("%1", "brief", deps, {
      timeoutMs: 6_000,
      quietMs: 1_000,
      pollMs: 500,
    });

    expect(result.state).toBe("undelivered");
    if (result.state !== "undelivered") return;
    expect(result.reason).toContain("never finished starting up");
    expect(calls.pastes).toHaveLength(0);
    expect(calls.submits).toBe(0);
  });

  it("waits for the composer to RENDER the paste before judging it lost", () => {
    // MEASURED: reading the pane back instantly declared a perfectly good paste
    // lost on Claude Code — the composer had the text but had not repainted.
    const { deps, calls } = fakePane({
      renderLagCaptures: 3,
      workCpuPerSec: 1000,
    });

    const result = deliverInitialPrompt("%1", "the brief", deps);

    expect(result.state).toBe("working");
    expect(calls.pastes).toHaveLength(1); // waited by LOOKING again, not typing
    expect(calls.submits).toBe(1);
  });

  it("accepts a LONG brief the host collapsed into a marker", () => {
    // Both hosts collapse a long paste, so the brief's words are never visible.
    // Rejecting that would refuse exactly the briefs lanes actually use.
    const brief = Array.from({ length: 72 }, (_, i) => `line ${i}`).join("\n");
    const { deps, calls } = fakePane({
      screenAfterPaste: `${COMPOSER}\n❯ [Pasted text #1 +71 lines]`,
      workCpuPerSec: 1000,
    });

    const result = deliverInitialPrompt("%1", brief, deps);

    expect(result.state).toBe("working");
    if (result.state !== "working") return;
    expect(result.evidence).toBe("collapsed-paste");
    expect(calls.submits).toBe(1);
  });

  it("REFUSES a collapsed marker that accounts for less than the brief", () => {
    // cond measured a 5500-char brief landing as "[Pasted Content 1155 chars]":
    // the agent started on a TRUNCATED brief and nothing said so. A plausible,
    // amputated answer is worse than a refused launch.
    const brief = Array.from({ length: 72 }, (_, i) => `line ${i}`).join("\n");
    const { deps, calls } = fakePane({
      screenAfterPaste: `${COMPOSER}\n❯ [Pasted Content 1155 chars]`,
      workCpuPerSec: 1000,
    });

    const result = deliverInitialPrompt("%1", brief, deps, { landedMs: 2_000 });

    expect(result.state).toBe("undelivered");
    expect(calls.submits).toBe(0); // never submit a partial brief
  });

  it("refuses when the pre-submit CPU baseline is unreadable", () => {
    // REVIEW FINDING 1, confirmed: coercing an unreadable sample to zero turned
    // the process's whole lifetime CPU into a post-submit delta, reporting
    // "working" over a brief that was still sitting unsent.
    const { deps, calls } = fakePane({
      idleCpuPerSec: 0,
      workCpuPerSec: 0,
      cpuUnreadableFromCall: 3, // readable for readiness, unreadable at submit
    });

    const result = deliverInitialPrompt("%1", "the brief", deps, {
      quietMs: 1_000,
      timeoutMs: 8_000,
      pollMs: 500,
    });

    expect(result.state).not.toBe("working");
    if (result.state === "undelivered") {
      expect(result.reason).toMatch(/CPU could not be read|never finished/);
    }
    expect(calls.submits).toBe(0);
  });

  it("does not read a SHRINKING process tree as quiet, nor its leftover CPU as work", () => {
    // REVIEW FINDING 2, confirmed: only live descendants are counted, so the
    // total falls when a bootstrap child exits. A negative delta passed the quiet
    // test, clamped the idle rate to zero, and let remaining startup CPU pass the
    // activity gate — "working" with nothing submitted.
    const { deps } = fakePane({
      idleCpuPerSec: 400, // still busy booting
      cpuDropAfterQuiet: 1_800, // a child leaves the tree
      workCpuPerSec: 0, // and no real work ever happens
    });

    const result = deliverInitialPrompt("%1", "the brief", deps, {
      quietMs: 1_000,
      timeoutMs: 6_000,
      pollMs: 500,
    });

    expect(result.state).not.toBe("working");
  });

  it("calibrates a host that idles at a steady few percent of a core", () => {
    // REVIEW FINDING 3, confirmed: an absolute quiet threshold could never admit
    // a host burning 25ms/s, so it was refused after the whole budget without a
    // single paste. What matters is that the burn is LEVEL.
    const { deps, calls } = fakePane({
      idleCpuPerSec: 25,
      workCpuPerSec: 1_000,
    });

    const result = deliverInitialPrompt("%1", "the brief", deps, {
      quietMs: 1_000,
      quietCpuMs: 10, // deliberately below the host's own idle burn
      timeoutMs: 30_000,
      pollMs: 500,
    });

    expect(result.state).toBe("working");
    expect(calls.pastes).toHaveLength(1);
  });

  it("reports a discarded paste WITHOUT retyping it", () => {
    // Retrying is what stacked twelve copies of one brief into a composer when
    // the wipe silently failed (Ctrl-U only clears the current line).
    const { deps, calls } = fakePane({ pasteDiscarded: true });

    const result = deliverInitialPrompt("%1", "the brief", deps);

    expect(result.state).toBe("undelivered");
    if (result.state !== "undelivered") return;
    expect(result.reason).toContain("never appeared in the composer");
    expect(calls.pastes).toHaveLength(1); // ONE paste, never a second
    expect(calls.submits).toBe(0);
  });

  it("fails immediately on a host modal instead of burning the whole budget", () => {
    const { deps, calls } = fakePane({ screen: TRUST_MODAL });

    const result = deliverInitialPrompt("%1", "brief", deps, {
      timeoutMs: 90_000,
    });

    expect(result.state).toBe("host-modal");
    if (result.state !== "host-modal") return;
    expect(result.hint).toContain("approve this directory");
    expect(calls.pastes).toHaveLength(0); // never typed into a modal
  });

  it("catches a modal that appears AFTER the brief was pasted", () => {
    // MEASURED: codex raised "Hooks need review" after the paste; submitting
    // then answers the modal, not the brief.
    const { deps, calls } = fakePane({
      screenAfterPaste: HOOKS_MODAL,
      workCpuPerSec: 5000,
    });

    const result = deliverInitialPrompt("%1", "brief", deps);

    expect(result.state).toBe("host-modal");
    if (result.state !== "host-modal") return;
    expect(result.reason).toContain("hook-review");
    expect(calls.submits).toBe(0);
  });

  it("pastes a multi-line brief as ONE block and submits it once", () => {
    // Without bracketed paste, line 1 of a 2-line brief became its own request.
    const brief = "line one\nline two\nline three";
    const { deps, calls } = fakePane({ workCpuPerSec: 1000 });

    const result = deliverInitialPrompt("%1", brief, deps);

    expect(result.state).toBe("working");
    expect(calls.pastes).toEqual([brief]);
    expect(calls.submits).toBe(1);
  });

  it("reports submitted-idle when the brief lands but no work follows", () => {
    const { deps } = fakePane({ workCpuPerSec: 0 });

    const result = deliverInitialPrompt("%1", "brief", deps, {
      activityMs: 3_000,
      pollMs: 500,
    });

    expect(result.state).toBe("submitted-idle");
    if (result.state !== "submitted-idle") return;
    expect(result.cpuDeltaMs).toBe(0);
  });

  it("detects real work even when the host's own idle burn is not negligible", () => {
    // MEASURED FALSE NEGATIVE, on this branch's own review launch: the agent was
    // demonstrably working (12.2s of tree CPU, visibly reading the PR) but a
    // CUMULATIVE idle budget over 30s had grown larger than the work burst, so
    // delivery reported "submitted-idle" — which, in a real launch, KILLS a
    // perfectly good lane. Rates over one window, not totals.
    const { deps } = fakePane({
      idleCpuPerSec: 63, // the host is never truly at zero
      workCpuPerSec: 800, // and then it actually works
    });

    const result = deliverInitialPrompt("%1", "the brief", deps, {
      quietMs: 1_000,
      quietCpuMs: 10, // force the "stable burn" calibration path
      activityMs: 30_000,
      pollMs: 500,
    });

    expect(result.state).toBe("working");
  });

  it("does not read a host's OWN idle burn as work", () => {
    // MEASURED: an idling codex burned 420ms over 30s. A flat threshold called
    // that "working" while nothing had been submitted at all.
    const { deps } = fakePane({ idleCpuPerSec: 14, workCpuPerSec: 0 });

    const result = deliverInitialPrompt("%1", "brief", deps, {
      quietMs: 1_000,
      activityMs: 20_000,
      pollMs: 500,
    });

    expect(result.state).toBe("submitted-idle");
  });

  it("refuses when tmux cannot paste", () => {
    const { deps } = fakePane({ pasteFails: true });
    const result = deliverInitialPrompt("%1", "brief", deps);
    expect(result.state).toBe("undelivered");
    if (result.state !== "undelivered") return;
    expect(result.reason).toContain("refused to paste");
  });

  it("refuses when the text landed but tmux cannot submit it", () => {
    const { deps } = fakePane({ submitFails: true });
    const result = deliverInitialPrompt("%1", "brief", deps);
    expect(result.state).toBe("undelivered");
    if (result.state !== "undelivered") return;
    expect(result.reason).toContain("could not submit");
  });

  it("treats an unreadable pane as unknown, never as idle", () => {
    const { deps, calls } = fakePane({ captureFails: true });

    const result = deliverInitialPrompt("%1", "brief", deps);

    expect(result.state).toBe("undelivered");
    if (result.state !== "undelivered") return;
    expect(result.reason).toContain("could not be read");
    expect(calls.pastes).toHaveLength(0);
  });
});

describe("captureTail", () => {
  it("keeps the last non-empty lines for an actionable error message", () => {
    expect(captureTail("a\n\nb\n\n\nc\n", 2)).toBe("b\nc");
  });
});
