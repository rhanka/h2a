import { describe, expect, it, vi } from "vitest";

import { CLAUDE_LONG_CONTEXT_CONFIRM_REASON } from "./prompt-delivery.js";
import {
  decideRelaunchSafety,
  isRelaunchKillable,
  planRelaunch,
  relaunchContinuationPrompt,
  resumeCommandFor,
  wakeRelaunchedSession,
} from "./relaunch.js";

describe("resumeCommandFor", () => {
  it("uses --resume for claude/agy and the resume subcommand for codex", () => {
    expect(resumeCommandFor("claude", "c1")).toBe("claude --resume c1");
    expect(resumeCommandFor("agy", "c1")).toBe("agy --resume c1");
    expect(resumeCommandFor("codex", "r1")).toBe("codex resume r1");
  });
  it("returns undefined for a profile with no resume form", () => {
    expect(resumeCommandFor("shell", "x")).toBeUndefined();
    expect(resumeCommandFor("not-a-profile", "x")).toBeUndefined();
  });
});

describe("relaunchContinuationPrompt", () => {
  it("uses a registered task when one exists and otherwise resumes conversation authority", () => {
    expect(relaunchContinuationPrompt("  finish WP5  ")).toContain("finish WP5");
    expect(relaunchContinuationPrompt()).toContain("standing objective");
  });
});

describe("wakeRelaunchedSession", () => {
  const working = {
    state: "working" as const,
    waitedMs: 1200,
    cpuDeltaMs: 900,
    evidence: "composer-text" as const,
  };
  const exactModal = {
    state: "host-modal" as const,
    reason: CLAUDE_LONG_CONTEXT_CONFIRM_REASON,
    hint: "exact prompt",
    capture:
      "This session is 19h 44m old and 450.3k tokens.\nResuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.\n❯ 1. Resume from summary (recommended)\n2. Resume full session as-is\n3. Don't ask me again\nEnter to confirm",
  };

  it("auto-passes the exact Claude confirmation once, then proves continuation work", () => {
    let now = 0;
    const deliverContinuation = vi
      .fn()
      .mockReturnValueOnce(exactModal)
      .mockReturnValueOnce(working);
    const submitConfirmation = vi.fn(() => true);
    const result = wakeRelaunchedSession("continue", {
      deliverContinuation,
      submitConfirmation,
      capturePane: () => "Claude Code\n❯ Ready",
      sleep: (ms) => {
        now += ms;
      },
      now: () => now,
    });

    expect(result.state).toBe("working");
    expect(result.confirmation).toBe("auto-passed");
    expect(submitConfirmation).toHaveBeenCalledTimes(1);
    expect(deliverContinuation).toHaveBeenCalledTimes(2);
  });

  it("never sends Enter for a different host modal", () => {
    const submitConfirmation = vi.fn(() => true);
    const result = wakeRelaunchedSession("continue", {
      deliverContinuation: () => ({
        state: "host-modal",
        reason: "the host is waiting on a modal choice prompt",
        hint: "ask a human",
        capture: "1. Delete everything\nEnter to confirm",
      }),
      submitConfirmation,
      capturePane: () => "",
      sleep: () => undefined,
      now: () => 0,
    });

    expect(result.state).toBe("failed");
    expect(submitConfirmation).not.toHaveBeenCalled();
  });

  it("reports failure when the objective was submitted but no work follows", () => {
    const result = wakeRelaunchedSession("continue", {
      deliverContinuation: () => ({
        state: "submitted-idle",
        waitedMs: 30_000,
        cpuDeltaMs: 12,
        evidence: "composer-text",
      }),
      submitConfirmation: () => true,
      capturePane: () => "❯",
      sleep: () => undefined,
      now: () => 0,
    });

    expect(result).toMatchObject({
      state: "failed",
      reason: "the continuation objective was submitted but the agent stayed idle",
    });
  });
});

describe("planRelaunch", () => {
  const deadClaude = (slug: string, convId?: string) => ({
    slug,
    name: `remote-${slug}`,
    profile: "claude",
    dead: true,
    activatable: false,
    indeterminate: false,
    activelyWorking: false,
    ...(convId ? { convId } : {}),
  });

  it("plans dead sessions with a known convId, each its own command", () => {
    const plan = planRelaunch([
      deadClaude("sentropic", "c-a"),
      deadClaude("sentropic#2", "c-b"),
      { ...deadClaude("dataviz", "r-1"), profile: "codex" },
    ]);
    expect(plan.actions.map((a) => a.cmd)).toEqual([
      "claude --resume c-a",
      "claude --resume c-b",
      "codex resume r-1",
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves live sessions alone", () => {
    const plan = planRelaunch([
      {
        ...deadClaude("live", "c-x"),
        dead: false,
        activatable: true,
      },
    ]);
    expect(plan.actions).toEqual([]);
    expect(plan.skipped[0]?.reason).toMatch(/activatable/);
  });

  it("never force-relaunches an actively working worker", () => {
    const plan = planRelaunch(
      [
        {
          ...deadClaude("working", "c-working"),
          dead: false,
          activatable: true,
          activelyWorking: true,
          livenessReason:
            "live working CLI — never killed (even with --force)",
        },
      ],
      { force: true },
    );

    expect(plan.actions).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("never killed");
  });

  it("treats an indeterminate CPU probe as actively working", () => {
    const plan = planRelaunch(
      [
        {
          ...deadClaude("unknown", "c-unknown"),
          dead: false,
          indeterminate: true,
          activelyWorking: true,
          livenessReason:
            "liveness indeterminate: CPU rate could not be computed",
        },
      ],
      { force: true },
    );

    expect(plan.actions).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("indeterminate");
  });

  it("classifies a live worker at 40 ms/s as activatable and never killable", () => {
    const parkedAt40 = decideRelaunchSafety({
        paneCommand: "bash",
        panePid: 10,
        firstWorkerPid: 20,
        secondWorkerPid: 20,
        firstCpuMs: 100,
        secondCpuMs: 110,
        elapsedMs: 250,
      });

    expect(parkedAt40).toMatchObject({
      dead: false,
      activatable: true,
      indeterminate: false,
      activelyWorking: false,
      rateMsPerSecond: 40,
    });
    expect(isRelaunchKillable(parkedAt40)).toBe(false);

    const plan = planRelaunch(
      [{ ...deadClaude("live-40", "c-live-40"), ...parkedAt40 }],
      { force: true },
    );
    const forcedActionCount = plan.actions.length;
    expect(forcedActionCount).toBe(0);
    expect(plan.skipped[0]?.reason).toContain("activatable");
  });

  it("keeps dead sessions killable and indeterminate liveness unkillable", () => {
    const dead = decideRelaunchSafety({
      paneCommand: "bash",
      panePid: 10,
      firstWorkerPid: 10,
      secondWorkerPid: 10,
      firstCpuMs: 100,
      secondCpuMs: 100,
      elapsedMs: 250,
    });
    expect(dead).toMatchObject({
      dead: true,
      activatable: false,
      indeterminate: false,
      activelyWorking: false,
    });
    expect(isRelaunchKillable(dead)).toBe(true);

    expect(
      decideRelaunchSafety({
        paneCommand: "bash",
        panePid: 10,
        firstWorkerPid: 20,
        secondWorkerPid: 20,
        firstCpuMs: 100,
        secondCpuMs: 120,
        elapsedMs: 250,
      }),
    ).toMatchObject({
      dead: false,
      activatable: true,
      indeterminate: false,
      activelyWorking: true,
      rateMsPerSecond: 80,
    });

    const indeterminate = decideRelaunchSafety({
        paneCommand: "bash",
        panePid: 10,
        firstWorkerPid: 20,
        secondWorkerPid: 20,
        firstCpuMs: undefined,
        secondCpuMs: 120,
        elapsedMs: 250,
      });
    expect(indeterminate).toMatchObject({
      dead: false,
      activatable: false,
      indeterminate: true,
      activelyWorking: true,
    });
    expect(isRelaunchKillable(indeterminate)).toBe(false);
  });

  it("skips sessions with no convId rather than guessing", () => {
    const plan = planRelaunch([deadClaude("opendb")]);
    expect(plan.actions).toEqual([]);
    expect(plan.skipped[0]?.reason).toMatch(/no convId/);
  });

  it("refuses to point two sessions at the SAME conversation", () => {
    const plan = planRelaunch([
      deadClaude("a", "dup"),
      deadClaude("b", "dup"),
    ]);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.slug).toBe("a");
    expect(plan.skipped[0]?.reason).toMatch(/collide/);
  });

  it("refuses a dual-prefix tmux collision before assigning either conversation", () => {
    const plan = planRelaunch([
      { ...deadClaude("proj", "canonical"), name: "h2a-proj" },
      { ...deadClaude("proj", "legacy"), name: "remote-proj" },
    ]);

    expect(plan.actions).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0]?.reason).toContain("h2a-proj");
    expect(plan.skipped[0]?.reason).toContain("remote-proj");
  });
});
